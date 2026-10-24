-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains plpgsql functions between dollar quotes. A runner that splits on the
-- statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 411: AI FAIR USE -- RECONCILIATION, THE UGX ALLOWANCE BASIS, PRICE SOURCES AND MODEL ELIGIBILITY
--
-- COMPETEN-AI-FAIR-USE-01, owner GO "Proceed to Completion" and owner decisions D1-D5 (2026-10-24). Fixes
-- forward from 410, which is frozen. Coordinator range 410-412.
--
-- APPLY ON STAGING FIRST. ADDITIVE OR WIDENING. Two new tables, new nullable columns on 410 tables, a widened
-- ledger status, and replaced 410 accounting functions. No existing row is changed. Re-running it is a no-op.
-- OPS-001 s8: proposed Medium (replaced functions that move balances), with a rollback rehearsal.
-- Depends on 410.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR, IN ONE SENTENCE.
--
-- It makes an unknown provider charge wait for reconciliation instead of being guessed, measures allowances in
-- UGX through the Bank of Uganda reference rate (1 CAU = UGX 1, owner D4) with the reservation buffer kept apart
-- from the settled cost, records where every price came from, and lets a clinically sensitive activity run only
-- on a model that governed evaluation has made eligible for it (owner D1).
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT CHANGES.
--
--   ai_price              + source_kind (list or negotiated), source_ref (where the price was published or
--                         agreed), price_version. Still history rows.
--   ai_cau_basis          NEW. What one CAU is worth in a currency (owner D4: 1 CAU = UGX 1), effective-dated
--                         history like the other rates. 410's ai_cau_rate (USD per CAU) stays readable for the
--                         rows it already priced and is no longer used for new reservations.
--   ai_model_eligibility  NEW. Whether a provider model may serve one activity of one product, set only through
--                         governed configuration, with the evaluation evidence it rests on. History rows. A
--                         clinically sensitive activity is reserved only on a model with an eligible row in
--                         force -- never because a model is expensive or called "reasoning".
--   ai_usage_ledger       + fx_rate_id and cau_basis_id (the reference rate and basis fixed at reservation),
--                         reserve_buffer_pct (applied to the HOLD only), provider_cost_currency, unreconciled_at.
--                         status gains 'unreconciled'. cau_rate_id becomes optional (one of the two bases).
--
--   THE TWO RECORDS (owner, financial integrity). On every settled row:
--     provider expenditure   input and output tokens, extra charges, cost_usd -- at the price row fixed at
--                            reservation. Nothing about a person's allowance enters it.
--     allowance consumption  settled_cau = cost_usd x the reference rate fixed at reservation / CAU basis, under
--                            the policy version recorded at reservation. The buffer never enters it.
--   Neither is ever rewritten: the ledger guard refuses any change once a row is settled or released.
--
--   UNKNOWN CHARGES. ai_mark_unreconciled keeps the hold against the allowance (it stays in reserved_cau, in the
--   ORIGINAL account and period) and marks the row. ai_settle reconciles it from real provider usage later,
--   into that original account. ai_release frees it only on proof of no billing. ai_reserve refuses a new
--   request once a person's outstanding unreconciled holds, with the new hold, would pass the policy ceiling, so unresolved
--   requests cannot create unlimited exposure. ai_release_stale no longer releases a stale hold: it marks it
--   unreconciled, because no billing is not known.
--
-- RLS: on for the two new tables, no policy. Execute on the functions: the service role only.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique
-- index. notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/AI-FAIR-USE/ROLLBACK-411.sql restores the 410 functions and status set,
--   and drops the new tables and columns. Only valid while no row uses an 411 status or basis (staging).
-- ====================================================================================================


-- ---- 1. price sources ---------------------------------------------------------------------------------

alter table ai_price add column if not exists source_kind text not null default 'list';
alter table ai_price add column if not exists source_ref text;
alter table ai_price add column if not exists price_version text;
alter table ai_price drop constraint if exists ai_price_source_check;
alter table ai_price add constraint ai_price_source_check
  check (source_kind in ('list', 'negotiated') and (source_ref is null or char_length(source_ref) <= 500)
     and (price_version is null or char_length(price_version) <= 80));


-- ---- 2. the allowance basis: what one CAU is worth --------------------------------------------------

create table if not exists ai_cau_basis (
  id                uuid primary key default gen_random_uuid(),
  currency          text not null,
  currency_per_cau  numeric(14, 6) not null,
  effective_from    timestamptz not null default now(),
  effective_to      timestamptz,
  note              text,
  created_by        uuid,
  created_at        timestamptz not null default now()
);
alter table ai_cau_basis drop constraint if exists ai_cau_basis_check;
alter table ai_cau_basis add constraint ai_cau_basis_check
  check (currency ~ '^[A-Z]{3}$' and currency_per_cau > 0 and (effective_to is null or effective_to > effective_from)
     and (note is null or char_length(note) <= 500));
create unique index if not exists ux_ai_cau_basis_effective on ai_cau_basis(currency, effective_from);
alter table ai_cau_basis enable row level security;
drop trigger if exists ai_cau_basis_history_guard on ai_cau_basis;
create trigger ai_cau_basis_history_guard before update or delete on ai_cau_basis for each row execute function public.ai_rate_history_guard();


-- ---- 3. model eligibility, by evidence -------------------------------------------------------------

create table if not exists ai_model_eligibility (
  id              uuid primary key default gen_random_uuid(),
  product         text not null,
  activity        text not null,
  provider        text not null,
  model_prefix    text not null,
  eligible        boolean not null,
  evidence_ref    text,
  note            text,
  effective_from  timestamptz not null default now(),
  effective_to    timestamptz,
  decided_by      uuid,
  created_at      timestamptz not null default now()
);
alter table ai_model_eligibility drop constraint if exists ai_model_eligibility_check;
alter table ai_model_eligibility add constraint ai_model_eligibility_check
  check (product in ('scholar', 'professional') and activity ~ '^[a-z][a-z0-9_]{1,40}$'
     and provider in ('anthropic', 'openai', 'gemini') and btrim(model_prefix) <> ''
     and (not eligible or (evidence_ref is not null and char_length(btrim(evidence_ref)) >= 5))
     and (evidence_ref is null or char_length(evidence_ref) <= 500) and (note is null or char_length(note) <= 500)
     and (effective_to is null or effective_to > effective_from));
create unique index if not exists ux_ai_model_eligibility_effective
  on ai_model_eligibility(product, activity, provider, model_prefix, effective_from);
alter table ai_model_eligibility enable row level security;
drop trigger if exists ai_model_eligibility_history_guard on ai_model_eligibility;
create trigger ai_model_eligibility_history_guard before update or delete on ai_model_eligibility for each row execute function public.ai_rate_history_guard();


-- ---- 4. the ledger: the reference rate, the basis, the buffer, and unreconciled ---------------------

alter table ai_usage_ledger add column if not exists fx_rate_id uuid references ai_fx_rate(id);
alter table ai_usage_ledger add column if not exists cau_basis_id uuid references ai_cau_basis(id);
alter table ai_usage_ledger add column if not exists reserve_buffer_pct numeric(6, 2);
alter table ai_usage_ledger add column if not exists provider_cost_currency text not null default 'USD';
alter table ai_usage_ledger add column if not exists unreconciled_at timestamptz;
alter table ai_usage_ledger alter column cau_rate_id drop not null;

alter table ai_usage_ledger drop constraint if exists ai_usage_ledger_check;
alter table ai_usage_ledger add constraint ai_usage_ledger_check
  check (char_length(request_id) between 8 and 200 and pool in ('included', 'reserve')
     and status in ('reserved', 'unreconciled', 'settled', 'released')
     and max_input_tokens >= 0 and max_output_tokens > 0 and max_cau > 0
     and (status in ('reserved', 'unreconciled')) = (settled_at is null)
     and (status <> 'unreconciled' or unreconciled_at is not null)
     and (status <> 'settled' or (input_tokens >= 0 and output_tokens >= 0 and cost_usd >= 0 and settled_cau >= 0 and overrun_cau >= 0))
     and (status <> 'released' or (coalesce(settled_cau, 0) = 0 and coalesce(cost_usd, 0) = 0))
     and (outcome is null or outcome in ('ok', 'refusal', 'error', 'timeout', 'not_configured', 'expired'))
     and (cau_rate_id is not null or (fx_rate_id is not null and cau_basis_id is not null))
     and (reserve_buffer_pct is null or (reserve_buffer_pct >= 0 and reserve_buffer_pct <= 100)));
create index if not exists idx_ai_usage_ledger_user_status on ai_usage_ledger(user_id, status);

-- The ledger guard, widened: reserved may become unreconciled, settled or released, and unreconciled may become
-- settled (reconciled from real usage) or released (on proof of no billing). Nothing else, and never again.
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
     or new.max_output_tokens is distinct from old.max_output_tokens or new.created_at is distinct from old.created_at then
    raise exception 'ai_usage_ledger: what was reserved cannot be rewritten';
  end if;
  return new;
end;
$$;


-- ---- 5. the accounting functions, replaced -----------------------------------------------------------

drop function if exists public.ai_reserve(text, uuid, text, text, text, text, int, int, text, int, numeric, int);

create or replace function public.ai_reserve(
  p_request_id text, p_account uuid, p_activity text, p_pool text, p_provider text, p_model text,
  p_max_input_tokens int, p_max_output_tokens int, p_policy_version text,
  p_currency text, p_buffer_pct numeric, p_clinically_sensitive boolean, p_unreconciled_cap_cau numeric,
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
  -- A clinically sensitive activity runs only on a model governed evaluation made eligible for it.
  if coalesce(p_clinically_sensitive, true) and not exists (
    select 1 from ai_model_eligibility e
     where e.product = a.product and e.activity = p_activity and e.provider = p_provider and p_model like e.model_prefix || '%'
       and e.eligible and e.effective_from <= now() and (e.effective_to is null or e.effective_to > now())) then
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
      reserve_buffer_pct, policy_version, max_input_tokens, max_output_tokens, max_cau)
    values (p_request_id, a.id, a.user_id, a.product, p_activity, p_pool, p_provider, p_model, pr.id, fx.id, cb.id,
      p_buffer_pct, p_policy_version, p_max_input_tokens, p_max_output_tokens, v_max)
    returning id into v_id;
  perform set_config('competen.ai_settlement', 'off', true);
  return query select v_id, true, 'reserved', v_max;
end;
$$;

-- Settle a reserved request, or RECONCILE an unreconciled one, from the usage the provider reported. Always into
-- the ORIGINAL account (the period it was reserved in), at the price, reference rate and basis fixed then.
create or replace function public.ai_settle(
  p_request_id text, p_model text, p_input_tokens int, p_output_tokens int, p_extra_usd numeric, p_outcome text)
returns table (settled_cau numeric, overrun_cau numeric, cost_usd numeric)
language plpgsql
set search_path = public, pg_catalog
as $$
#variable_conflict use_column
declare
  l ai_usage_ledger%rowtype;
  pr ai_price%rowtype;
  v_cost numeric;
  v_cau numeric;
  v_rate numeric;
  v_basis numeric;
begin
  select * into l from ai_usage_ledger where request_id = p_request_id;
  if not found then raise exception 'ai_settle: unknown request %', p_request_id; end if;
  perform 1 from ai_allowance_account where id = l.account_id for update;
  select * into l from ai_usage_ledger where request_id = p_request_id for update;
  if l.status not in ('reserved', 'unreconciled') then raise exception 'ai_settle: request % is already %', p_request_id, l.status; end if;
  if p_input_tokens is null or p_output_tokens is null or p_input_tokens < 0 or p_output_tokens < 0 or coalesce(p_extra_usd, 0) < 0 then
    raise exception 'ai_settle: provider usage is required and cannot be negative';
  end if;
  select * into pr from ai_price where id = l.price_id;
  -- Provider expenditure: the provider charge in USD at the price fixed at reservation.
  v_cost := round((p_input_tokens::numeric * pr.input_per_mtok_usd + p_output_tokens::numeric * pr.output_per_mtok_usd) / 1000000
    + pr.extra_per_request_usd + coalesce(p_extra_usd, 0), 6);
  -- Allowance consumption: that cost in CAU at the reference rate fixed at reservation, without the buffer.
  if l.fx_rate_id is not null then
    select per_usd into v_rate from ai_fx_rate where id = l.fx_rate_id;
    select currency_per_cau into v_basis from ai_cau_basis where id = l.cau_basis_id;
    v_cau := round(v_cost * v_rate / v_basis, 6);
  else
    select usd_per_cau into v_basis from ai_cau_rate where id = l.cau_rate_id;
    v_cau := round(v_cost / v_basis, 6);
  end if;
  perform set_config('competen.ai_settlement', 'on', true);
  if l.pool = 'included' then
    update ai_allowance_account set reserved_cau = greatest(reserved_cau - l.max_cau, 0), used_cau = used_cau + v_cau where id = l.account_id;
  else
    update ai_allowance_account set reserve_reserved_cau = greatest(reserve_reserved_cau - l.max_cau, 0), reserve_used_cau = reserve_used_cau + v_cau where id = l.account_id;
  end if;
  update ai_usage_ledger set status = 'settled', model = coalesce(p_model, model), input_tokens = p_input_tokens, output_tokens = p_output_tokens,
      extra_charge_usd = coalesce(p_extra_usd, 0), cost_usd = v_cost, settled_cau = v_cau, overrun_cau = greatest(v_cau - l.max_cau, 0),
      outcome = coalesce(p_outcome, 'ok'), settled_at = now()
    where id = l.id;
  perform set_config('competen.ai_settlement', 'off', true);
  return query select v_cau, greatest(v_cau - l.max_cau, 0), v_cost;
end;
$$;

-- Release a hold: a reserved request that failed before billing, or an unreconciled one on proof of no billing.
create or replace function public.ai_release(p_request_id text, p_outcome text)
returns boolean
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  l ai_usage_ledger%rowtype;
begin
  select * into l from ai_usage_ledger where request_id = p_request_id;
  if not found then return false; end if;
  perform 1 from ai_allowance_account where id = l.account_id for update;
  select * into l from ai_usage_ledger where request_id = p_request_id for update;
  if l.status not in ('reserved', 'unreconciled') then raise exception 'ai_release: request % is already %', p_request_id, l.status; end if;
  perform set_config('competen.ai_settlement', 'on', true);
  if l.pool = 'included' then
    update ai_allowance_account set reserved_cau = greatest(reserved_cau - l.max_cau, 0) where id = l.account_id;
  else
    update ai_allowance_account set reserve_reserved_cau = greatest(reserve_reserved_cau - l.max_cau, 0) where id = l.account_id;
  end if;
  update ai_usage_ledger set status = 'released', settled_cau = 0, cost_usd = 0, outcome = coalesce(p_outcome, 'error'), settled_at = now() where id = l.id;
  perform set_config('competen.ai_settlement', 'off', true);
  return true;
end;
$$;

-- An unknown charge: keep the hold where it is, in the original period, and wait for real usage.
create or replace function public.ai_mark_unreconciled(p_request_id text, p_outcome text)
returns boolean
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  l ai_usage_ledger%rowtype;
begin
  select * into l from ai_usage_ledger where request_id = p_request_id;
  if not found then return false; end if;
  perform 1 from ai_allowance_account where id = l.account_id for update;
  select * into l from ai_usage_ledger where request_id = p_request_id for update;
  if l.status <> 'reserved' then raise exception 'ai_mark_unreconciled: request % is already %', p_request_id, l.status; end if;
  perform set_config('competen.ai_settlement', 'on', true);
  update ai_usage_ledger set status = 'unreconciled', unreconciled_at = now(), outcome = coalesce(p_outcome, 'timeout') where id = l.id;
  perform set_config('competen.ai_settlement', 'off', true);
  return true;
end;
$$;

-- A hold left by a request that never came back is an UNKNOWN charge, not a free one: mark it unreconciled.
create or replace function public.ai_release_stale(p_older_than_minutes int)
returns int
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  r record;
  n int := 0;
begin
  for r in select request_id from ai_usage_ledger where status = 'reserved' and created_at < now() - make_interval(mins => greatest(p_older_than_minutes, 5)) loop
    perform ai_mark_unreconciled(r.request_id, 'expired');
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke all on function public.ai_reserve(text, uuid, text, text, text, text, int, int, text, text, numeric, boolean, numeric, int, numeric, int) from public, anon, authenticated;
revoke all on function public.ai_settle(text, text, int, int, numeric, text) from public, anon, authenticated;
revoke all on function public.ai_release(text, text) from public, anon, authenticated;
revoke all on function public.ai_mark_unreconciled(text, text) from public, anon, authenticated;
revoke all on function public.ai_release_stale(int) from public, anon, authenticated;
grant execute on function public.ai_reserve(text, uuid, text, text, text, text, int, int, text, text, numeric, boolean, numeric, int, numeric, int) to service_role;
grant execute on function public.ai_settle(text, text, int, int, numeric, text) to service_role;
grant execute on function public.ai_release(text, text) to service_role;
grant execute on function public.ai_mark_unreconciled(text, text) to service_role;
grant execute on function public.ai_release_stale(int) to service_role;


-- Verification: the two new tables with RLS on and no policy, the functions, and no rows in them.
select c.relname, c.relrowsecurity, (select count(*) from pg_policies p where p.tablename = c.relname) as policies
  from pg_class c where c.relname in ('ai_cau_basis', 'ai_model_eligibility') order by c.relname;

select proname, pronargs from pg_proc where proname in ('ai_reserve', 'ai_settle', 'ai_release', 'ai_mark_unreconciled', 'ai_release_stale') order by proname;

notify pgrst, 'reload schema';
