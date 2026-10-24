-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains plpgsql and sql functions between dollar quotes. A runner that splits on the
-- statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 412: AI FAIR USE -- CLINICAL RISK TIERS AND THE REFERENCE-RATE SOURCE
--
-- COMPETEN IND-007 owner decisions D1 and D4 (2026-10-24). Fixes forward from 411, which is frozen.
--
-- APPLY ON STAGING FIRST. ADDITIVE OR WIDENING. New nullable columns on three 411 tables, one new helper function,
-- and ai_reserve and the ledger guard replaced. No existing row is changed. Re-running it is a no-op.
-- OPS-001 s8: proposed Medium (a replaced function that moves balances), with a rollback rehearsal.
-- Depends on 410 and 411.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR, IN ONE SENTENCE.
--
-- It makes the clinical risk of each AI request a recorded fact -- standard educational, clinical educational or
-- high-risk clinical, classified by the engine from the activity and its subject, never the activity name alone
-- -- and lets a model serve a tier only where a recorded evaluation decision made it eligible for that tier,
-- and it records where each reference rate came from and when it was published.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT CHANGES.
--
--   ai_usage_ledger       + risk_tier (the tier the request was classified at) and risk_rule (the configured rule
--                         that decided it). Both are fixed at reservation and never change (the ledger guard).
--   ai_model_eligibility  + max_risk_tier: the highest tier a model is eligible for on that activity. An eligible
--                         row must name it. A 411 row that names none counts as clinical educational, never high.
--   ai_fx_rate            + published_on (the publication date of the official rate), source_ref (where it was
--                         read) and update_kind (monthly, exceptional or placeholder). Owner D4.
--   ai_risk_rank(text)    NEW. 1, 2, 3 for the three tiers. Anything else ranks as high risk (fails closed).
--   ai_reserve            REPLACED. p_clinically_sensitive becomes p_risk_tier and p_risk_rule. A null or unknown
--                         tier is high_risk_clinical. Above standard educational, the model must hold an eligible
--                         row for the tier or higher, or the request is refused (not_eligible). The 411 signature is
--                         dropped.
--
-- RLS: unchanged (no new table). Execute on ai_reserve and ai_risk_rank: the service role only.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique
-- index. notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/AI-FAIR-USE/ROLLBACK-412.sql restores the 411 functions byte for byte and drops
--   the new columns. Valid only while no row uses a 412 column (it refuses otherwise).
-- ====================================================================================================


-- ---- 1. the risk tier on the ledger, and the tier an eligibility decision covers ---------------------

alter table ai_usage_ledger add column if not exists risk_tier text;
alter table ai_usage_ledger add column if not exists risk_rule text;
alter table ai_usage_ledger drop constraint if exists ai_usage_ledger_risk_check;
alter table ai_usage_ledger add constraint ai_usage_ledger_risk_check
  check ((risk_tier is null or risk_tier in ('standard_educational', 'clinical_educational', 'high_risk_clinical'))
     and (risk_rule is null or char_length(risk_rule) <= 120));

alter table ai_model_eligibility add column if not exists max_risk_tier text;
alter table ai_model_eligibility drop constraint if exists ai_model_eligibility_tier_check;
alter table ai_model_eligibility add constraint ai_model_eligibility_tier_check
  check ((max_risk_tier is null or max_risk_tier in ('standard_educational', 'clinical_educational', 'high_risk_clinical'))
     and (not eligible or max_risk_tier is not null));


-- ---- 2. where a reference rate came from -------------------------------------------------------------

alter table ai_fx_rate add column if not exists published_on date;
alter table ai_fx_rate add column if not exists source_ref text;
alter table ai_fx_rate add column if not exists update_kind text;
alter table ai_fx_rate drop constraint if exists ai_fx_rate_source_check;
alter table ai_fx_rate add constraint ai_fx_rate_source_check
  check ((update_kind is null or update_kind in ('monthly', 'exceptional', 'placeholder'))
     and (source_ref is null or char_length(source_ref) <= 500)
     and (update_kind is null or update_kind = 'placeholder' or (published_on is not null and source_ref is not null and char_length(btrim(source_ref)) >= 10)));


-- ---- 3. the tiers, ranked -------------------------------------------------------------------------

create or replace function public.ai_risk_rank(p_tier text)
returns int
language sql
immutable
set search_path = public, pg_catalog
as $$
  select case p_tier when 'standard_educational' then 1 when 'clinical_educational' then 2 else 3 end
$$;


-- ---- 4. the ledger guard: the tier and its rule are fixed at reservation ------------------------------

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


-- ---- 5. ai_reserve, replaced ------------------------------------------------------------------------

drop function if exists public.ai_reserve(text, uuid, text, text, text, text, int, int, text, text, numeric, boolean, numeric, int, numeric, int);

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
revoke all on function public.ai_risk_rank(text) from public, anon, authenticated;
grant execute on function public.ai_reserve(text, uuid, text, text, text, text, int, int, text, text, numeric, text, text, numeric, int, numeric, int) to service_role;
grant execute on function public.ai_risk_rank(text) to service_role;


-- Verification: the new columns, and ai_reserve with its 17 arguments.
select table_name, column_name from information_schema.columns
 where table_schema = 'public' and ((table_name = 'ai_usage_ledger' and column_name in ('risk_tier', 'risk_rule'))
    or (table_name = 'ai_model_eligibility' and column_name = 'max_risk_tier')
    or (table_name = 'ai_fx_rate' and column_name in ('published_on', 'source_ref', 'update_kind'))) order by 1, 2;

select proname, pronargs from pg_proc where proname in ('ai_reserve', 'ai_risk_rank') order by proname;

notify pgrst, 'reload schema';
