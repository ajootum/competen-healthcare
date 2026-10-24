-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It recreates plpgsql functions between dollar quotes.
-- ====================================================================================================
-- ROLLBACK 421 (STAGING ONLY). Returns the AI ledger to exactly what 412 and 420 left: 412's ai_reserve and ledger
-- guard (copied byte for byte from 412-ai-risk-tiers-and-rate-source.sql), user_id required again, and no ai_budget
-- or ownership columns. It refuses once a budget, a budget account or a non-individual ledger row exists.
do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'ai_budget') then
    if exists (select 1 from ai_budget) or exists (select 1 from ai_allowance_account where owner_type <> 'individual' or user_id is null)
       or exists (select 1 from ai_usage_ledger where owner_type <> 'individual' or user_id is null or initiated_by_service is not null or record_type is not null or record_ref is not null) then
      raise exception 'ROLLBACK-421 refused: budgets or ownership data already exist';
    end if;
  end if;
end $$;

drop function if exists public.ai_reserve(text, uuid, text, text, text, text, int, int, text, text, numeric, text, text, numeric, uuid, text, text, text, int, numeric, int);
alter table ai_usage_ledger drop constraint if exists ai_usage_ledger_owner_check;
drop index if exists idx_ai_usage_ledger_budget_status;
alter table ai_usage_ledger drop column if exists owner_type;
alter table ai_usage_ledger drop column if exists budget_id;
alter table ai_usage_ledger drop column if exists initiated_by_service;
alter table ai_usage_ledger drop column if exists record_type;
alter table ai_usage_ledger drop column if exists record_ref;
alter table ai_usage_ledger alter column user_id set not null;
alter table ai_allowance_account drop constraint if exists ai_allowance_account_owner_check;
drop index if exists ux_ai_allowance_account_budget_period;
alter table ai_allowance_account drop column if exists owner_type;
alter table ai_allowance_account drop column if exists budget_id;
alter table ai_allowance_account alter column user_id set not null;
drop table if exists ai_budget;
drop function if exists public.ai_budget_guard();

create or replace function public.ai_usage_ledger_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'ai_usage_ledger is append-only: a usage record cannot be deleted';
  end if;
  if coalesce(current_setting('competen.ai_settlement', true), '') <> 'on' then
    raise exception 'ai_usage_ledger: a usage record changes only through ai_settle, ai_release or ai_mark_unreconciled';
  end if;
  if old.status not in ('reserved', 'unreconciled') or (old.status = 'unreconciled' and new.status = 'reserved')
     or (old.status = 'unreconciled' and new.status = 'unreconciled' and new is distinct from old) then
    raise exception 'ai_usage_ledger: request % is already %', old.request_id, old.status;
  end if;
  if new.request_id is distinct from old.request_id or new.account_id is distinct from old.account_id or new.price_id is distinct from old.price_id
     or new.max_cau is distinct from old.max_cau or new.pool is distinct from old.pool or new.cau_rate_id is distinct from old.cau_rate_id
     or new.fx_rate_id is distinct from old.fx_rate_id or new.cau_basis_id is distinct from old.cau_basis_id
     or new.reserve_buffer_pct is distinct from old.reserve_buffer_pct or new.policy_version is distinct from old.policy_version
     or new.user_id is distinct from old.user_id or new.product is distinct from old.product or new.activity is distinct from old.activity
     or new.provider is distinct from old.provider or new.max_input_tokens is distinct from old.max_input_tokens
     or new.max_output_tokens is distinct from old.max_output_tokens or new.created_at is distinct from old.created_at
     or new.risk_tier is distinct from old.risk_tier or new.risk_rule is distinct from old.risk_rule then
    raise exception 'ai_usage_ledger: what was reserved cannot be rewritten';
  end if;
  return new;
end;
$$;

create or replace function public.ai_reserve(
  p_request_id text, p_account uuid, p_activity text, p_pool text, p_provider text, p_model text,
  p_max_input_tokens int, p_max_output_tokens int, p_policy_version text,
  p_currency text, p_buffer_pct numeric, p_risk_tier text, p_risk_rule text, p_unreconciled_cap_cau numeric,
  p_window_minutes int default null, p_window_cap_cau numeric default null, p_activity_cap int default null)
returns table (ledger_id uuid, granted boolean, reason text, max_cau numeric)
language plpgsql
set search_path = public, pg_catalog
as $$
#variable_conflict use_column
declare
  v_id uuid;
  a ai_allowance_account%rowtype;
  existing ai_usage_ledger%rowtype;
  pr ai_price%rowtype;
  fx ai_fx_rate%rowtype;
  cb ai_cau_basis%rowtype;
  v_usd numeric;
  v_max numeric;
  v_window numeric;
  v_count int;
  v_open numeric;
  v_tier text;
  v_rank int;
begin
  select * into existing from ai_usage_ledger l where l.request_id = p_request_id;
  if found then
    return query select existing.id, existing.status not in ('released'), 'retry: ' || existing.status, existing.max_cau;
    return;
  end if;
  select * into a from ai_allowance_account where id = p_account for update;
  if not found then return query select null::uuid, false, 'no_account', null::numeric; return; end if;
  select * into existing from ai_usage_ledger l where l.request_id = p_request_id;
  if found then
    return query select existing.id, existing.status not in ('released'), 'retry: ' || existing.status, existing.max_cau;
    return;
  end if;
  if now() < a.period_start or now() >= a.period_end then
    return query select null::uuid, false, 'period_not_live', null::numeric; return;
  end if;
  select * into pr from ai_price_at(p_provider, p_model, now());
  if pr.id is null then return query select null::uuid, false, 'model_not_priced', null::numeric; return; end if;
  -- The risk tier the engine classified from the activity AND its subject (owner D1). Unknown or unrecognised is
  -- high risk. Anything above standard educational runs only on a model a recorded evaluation decision made
  -- eligible for that tier or higher. An eligibility row that names no tier (411) never covers high risk.
  v_tier := case when p_risk_tier in ('standard_educational', 'clinical_educational', 'high_risk_clinical') then p_risk_tier else 'high_risk_clinical' end;
  v_rank := ai_risk_rank(v_tier);
  if v_rank > 1 and not exists (
    select 1 from ai_model_eligibility e
     where e.product = a.product and e.activity = p_activity and e.provider = p_provider and p_model like e.model_prefix || '%'
       and e.eligible and ai_risk_rank(coalesce(e.max_risk_tier, 'clinical_educational')) >= v_rank
       and e.effective_from <= now() and (e.effective_to is null or e.effective_to > now())) then
    return query select null::uuid, false, 'not_eligible', null::numeric; return;
  end if;
  select * into fx from ai_fx_rate where currency = p_currency and effective_from <= now() and (effective_to is null or effective_to > now()) order by effective_from desc limit 1;
  if not found then return query select null::uuid, false, 'no_reference_rate', null::numeric; return; end if;
  select * into cb from ai_cau_basis where currency = p_currency and effective_from <= now() and (effective_to is null or effective_to > now()) order by effective_from desc limit 1;
  if not found then return query select null::uuid, false, 'no_cau_basis', null::numeric; return; end if;
  if p_buffer_pct is null or p_buffer_pct < 0 or p_buffer_pct > 100 then return query select null::uuid, false, 'bad_buffer', null::numeric; return; end if;
  v_usd := (p_max_input_tokens::numeric * pr.input_per_mtok_usd + p_max_output_tokens::numeric * pr.output_per_mtok_usd) / 1000000 + pr.extra_per_request_usd;
  -- The buffer widens the HOLD only. Settlement uses the reference rate itself.
  v_max := round(v_usd * fx.per_usd * (1 + p_buffer_pct / 100) / cb.currency_per_cau, 6);
  if v_max <= 0 then v_max := 0.000001; end if;
  -- Outstanding unreconciled holds of this person, across products, counting this one should it become unreconciled,
  -- may not pass the ceiling. A null ceiling refuses.
  select coalesce(sum(l.max_cau), 0) into v_open from ai_usage_ledger l where l.user_id = a.user_id and l.status = 'unreconciled';
  if p_unreconciled_cap_cau is null or v_open + v_max > p_unreconciled_cap_cau then
    return query select null::uuid, false, 'unreconciled_ceiling', v_max; return;
  end if;
  if p_window_minutes is not null and p_window_cap_cau is not null then
    select coalesce(sum(case when l.status = 'settled' then l.settled_cau when l.status in ('reserved', 'unreconciled') then l.max_cau else 0 end), 0) into v_window
      from ai_usage_ledger l where l.account_id = a.id and l.created_at > now() - make_interval(mins => p_window_minutes);
    if v_window + v_max > p_window_cap_cau then return query select null::uuid, false, 'window_cap', v_max; return; end if;
  end if;
  if p_activity_cap is not null then
    select count(*) into v_count from ai_usage_ledger l where l.account_id = a.id and l.activity = p_activity and l.status <> 'released';
    if v_count >= p_activity_cap then return query select null::uuid, false, 'activity_cap', v_max; return; end if;
  end if;
  if p_pool = 'included' then
    if a.used_cau + a.reserved_cau + v_max > a.included_cau then return query select null::uuid, false, 'included_exhausted', v_max; return; end if;
  elsif p_pool = 'reserve' then
    if a.reserve_used_cau + a.reserve_reserved_cau + v_max > a.reserve_cau then return query select null::uuid, false, 'reserve_exhausted', v_max; return; end if;
  else
    return query select null::uuid, false, 'unknown_pool', v_max; return;
  end if;
  perform set_config('competen.ai_settlement', 'on', true);
  if p_pool = 'included' then
    update ai_allowance_account set reserved_cau = reserved_cau + v_max where id = a.id;
  else
    update ai_allowance_account set reserve_reserved_cau = reserve_reserved_cau + v_max where id = a.id;
  end if;
  insert into ai_usage_ledger (request_id, account_id, user_id, product, activity, pool, provider, model, price_id, fx_rate_id, cau_basis_id,
      reserve_buffer_pct, policy_version, max_input_tokens, max_output_tokens, max_cau, risk_tier, risk_rule)
    values (p_request_id, a.id, a.user_id, a.product, p_activity, p_pool, p_provider, p_model, pr.id, fx.id, cb.id,
      p_buffer_pct, p_policy_version, p_max_input_tokens, p_max_output_tokens, v_max, v_tier, left(p_risk_rule, 120))
    returning id into v_id;
  perform set_config('competen.ai_settlement', 'off', true);
  return query select v_id, true, 'reserved', v_max;
end;
$$;

revoke all on function public.ai_reserve(text, uuid, text, text, text, text, int, int, text, text, numeric, text, text, numeric, int, numeric, int) from public, anon, authenticated;
grant execute on function public.ai_reserve(text, uuid, text, text, text, text, int, int, text, text, numeric, text, text, numeric, int, numeric, int) to service_role;

notify pgrst, 'reload schema';
