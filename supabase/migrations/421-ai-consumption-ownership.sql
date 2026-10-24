-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains plpgsql functions between dollar quotes. A runner that splits on the
-- statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 421: AI CONSUMPTION OWNERSHIP -- INDIVIDUAL, PLATFORM AND INSTITUTION BUDGETS ON ONE LEDGER
--
-- COMPETEN-HOLDINGS-AI-CONSUMPTION-01 (owner GO, 2026-10-24) sections 3 to 6. Fixes forward from 410, 411, 412 and
-- 420, which are frozen. Coordinator range 421-424.
--
-- APPLY ON STAGING FIRST. ADDITIVE OR WIDENING. One new table, new columns on two 410 tables (every existing row
-- defaults to individual and keeps its values), ai_allowance_account.user_id and ai_usage_ledger.user_id become
-- nullable under checks, and ai_reserve and the ledger guard are replaced. Re-running it is a no-op.
-- OPS-001 s8: proposed Medium (a replaced function that moves balances), with a rollback rehearsal.
-- Depends on 410, 411, 412 and 420.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR, IN ONE SENTENCE.
--
-- It lets the one Holdings AI ledger charge three kinds of budget owner -- a person (Individual), Competen Holdings or
-- a product entity (Platform), and an authorised institution (Institution) -- with the same atomic reservation,
-- idempotency, reconciliation and immutable records, so that an individual's learning is never charged for
-- platform content development and a budget can only be charged by the workflow that owns it.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT CHANGES.
--
--   ai_budget               NEW. A Platform or Institution budget: its code, owner type, the product entity it
--                           funds, its status (active, suspended, closed) and, for an institution, the institution
--                           and the funding arrangement it rests on. An institution budget CANNOT exist without both.
--                           Its ceilings and limits are no-code policy (CONFIG-002), not columns.
--   ai_allowance_account    + owner_type (individual, platform, institution) and budget_id. An individual account
--                           belongs to a person and no budget, a budget account to a budget and no person.
--   ai_usage_ledger         + owner_type and budget_id (copied from the account at reservation), initiated_by_service
--                           (an authorised service, where no person initiated), record_type and record_ref (the
--                           learning or content-development record the request served). user_id is now the
--                           INITIATING person, the account holder for individual rows. Every field is frozen at
--                           reservation by the ledger guard.
--   ai_reserve              REPLACED. It takes the initiating actor or service and the record. A person's account is
--                           charged only for that person (owner_mismatch). A budget is charged only while active
--                           (budget_suspended), and only for a named user or service (no_initiator). The
--                           unreconciled ceiling is counted per person for individual accounts and per budget for
--                           budget accounts. Everything else is 412's, unchanged. The 412 signature is dropped.
--
-- RLS: on for ai_budget, no policy. Execute: the service role only.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique
-- index. notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/AI-CONSUMPTION/ROLLBACK-421.sql restores 412's ai_reserve and guard byte for byte,
--   and drops the new table and columns. It refuses once any budget account or non-individual ledger row exists.
-- ====================================================================================================


-- ---- 1. budgets ----------------------------------------------------------------------------------------

create table if not exists ai_budget (
  id               uuid primary key default gen_random_uuid(),
  code             text not null,
  owner_type       text not null,
  label            text not null,
  product          text not null,
  institution_ref  uuid,
  funding_ref      text,
  status           text not null default 'active',
  note             text,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table ai_budget drop constraint if exists ai_budget_check;
alter table ai_budget add constraint ai_budget_check
  check (code ~ '^[a-z][a-z0-9_.-]{2,60}$' and owner_type in ('platform', 'institution') and char_length(btrim(label)) between 2 and 200
     and product in ('scholar', 'professional') and status in ('active', 'suspended', 'closed')
     and (owner_type <> 'institution' or (institution_ref is not null and funding_ref is not null and char_length(btrim(funding_ref)) >= 5))
     and (owner_type <> 'platform' or (institution_ref is null and funding_ref is null))
     and (note is null or char_length(note) <= 1000));
create unique index if not exists ux_ai_budget_code on ai_budget(code);
alter table ai_budget enable row level security;

-- A budget's identity cannot be rewritten. Its status may change (suspend, resume, close), and closing is final.
create or replace function public.ai_budget_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'ai_budget: a budget is not deleted. Close it, and its accounts and ledger stay as the record';
  end if;
  if new.code is distinct from old.code or new.owner_type is distinct from old.owner_type or new.product is distinct from old.product
     or new.institution_ref is distinct from old.institution_ref or new.funding_ref is distinct from old.funding_ref or new.created_at is distinct from old.created_at then
    raise exception 'ai_budget: a budget''s owner, product and funding cannot be rewritten. Close it and create another';
  end if;
  if old.status = 'closed' and new.status <> 'closed' then
    raise exception 'ai_budget: a closed budget stays closed';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists ai_budget_guard on ai_budget;
create trigger ai_budget_guard before update or delete on ai_budget for each row execute function public.ai_budget_guard();


-- ---- 2. accounts: a person's, or a budget's ---------------------------------------------------------

alter table ai_allowance_account add column if not exists owner_type text not null default 'individual';
alter table ai_allowance_account add column if not exists budget_id uuid references ai_budget(id);
alter table ai_allowance_account alter column user_id drop not null;
alter table ai_allowance_account drop constraint if exists ai_allowance_account_owner_check;
alter table ai_allowance_account add constraint ai_allowance_account_owner_check
  check (owner_type in ('individual', 'platform', 'institution')
     and (owner_type <> 'individual' or (user_id is not null and budget_id is null))
     and (owner_type = 'individual' or (budget_id is not null and user_id is null)));
create unique index if not exists ux_ai_allowance_account_budget_period on ai_allowance_account(budget_id, period_start);


-- ---- 3. the ledger: who pays, who initiated, and what for ------------------------------------------

alter table ai_usage_ledger add column if not exists owner_type text not null default 'individual';
alter table ai_usage_ledger add column if not exists budget_id uuid references ai_budget(id);
alter table ai_usage_ledger add column if not exists initiated_by_service text;
alter table ai_usage_ledger add column if not exists record_type text;
alter table ai_usage_ledger add column if not exists record_ref text;
alter table ai_usage_ledger alter column user_id drop not null;
alter table ai_usage_ledger drop constraint if exists ai_usage_ledger_owner_check;
alter table ai_usage_ledger add constraint ai_usage_ledger_owner_check
  check (owner_type in ('individual', 'platform', 'institution')
     and (owner_type <> 'individual' or (user_id is not null and budget_id is null and initiated_by_service is null))
     and (owner_type = 'individual' or budget_id is not null)
     and (user_id is not null or initiated_by_service is not null)
     and (initiated_by_service is null or initiated_by_service ~ '^[a-z][a-z0-9_.:-]{2,80}$')
     and (record_type is null or record_type ~ '^[a-z][a-z0-9_]{1,40}$') and (record_ref is null or char_length(record_ref) <= 200));
create index if not exists idx_ai_usage_ledger_budget_status on ai_usage_ledger(budget_id, status);


-- ---- 4. the ledger guard: ownership is fixed at reservation ------------------------------------------

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
     or new.risk_tier is distinct from old.risk_tier or new.risk_rule is distinct from old.risk_rule
     or new.owner_type is distinct from old.owner_type or new.budget_id is distinct from old.budget_id
     or new.initiated_by_service is distinct from old.initiated_by_service or new.record_type is distinct from old.record_type
     or new.record_ref is distinct from old.record_ref then
    raise exception 'ai_usage_ledger: what was reserved cannot be rewritten';
  end if;
  return new;
end;
$$;


-- ---- 5. ai_reserve, replaced -----------------------------------------------------------------------

drop function if exists public.ai_reserve(text, uuid, text, text, text, text, int, int, text, text, numeric, text, text, numeric, int, numeric, int);

create or replace function public.ai_reserve(
  p_request_id text, p_account uuid, p_activity text, p_pool text, p_provider text, p_model text,
  p_max_input_tokens int, p_max_output_tokens int, p_policy_version text,
  p_currency text, p_buffer_pct numeric, p_risk_tier text, p_risk_rule text, p_unreconciled_cap_cau numeric,
  p_actor uuid, p_service text, p_record_type text, p_record_ref text,
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
  b ai_budget%rowtype;
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
  -- Who pays (COMPETEN-HOLDINGS-AI-CONSUMPTION-01). A person's account is charged only for that person's own request.
  -- A Platform or Institution budget is charged only while it is active, for a named user or service.
  if a.owner_type = 'individual' then
    if p_actor is null or p_actor is distinct from a.user_id or p_service is not null then
      return query select null::uuid, false, 'owner_mismatch', null::numeric; return;
    end if;
  else
    select * into b from ai_budget where id = a.budget_id;
    if not found or b.status <> 'active' then return query select null::uuid, false, 'budget_suspended', null::numeric; return; end if;
    if p_actor is null and (p_service is null or btrim(p_service) = '') then
      return query select null::uuid, false, 'no_initiator', null::numeric; return;
    end if;
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
  -- Outstanding unreconciled holds, counting this one should it become unreconciled, may not pass the ceiling: a
  -- person's across their own accounts, a budget's across its own. A null ceiling refuses.
  if a.owner_type = 'individual' then
    select coalesce(sum(l.max_cau), 0) into v_open from ai_usage_ledger l where l.owner_type = 'individual' and l.user_id = a.user_id and l.status = 'unreconciled';
  else
    select coalesce(sum(l.max_cau), 0) into v_open from ai_usage_ledger l where l.budget_id = a.budget_id and l.status = 'unreconciled';
  end if;
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
      reserve_buffer_pct, policy_version, max_input_tokens, max_output_tokens, max_cau, risk_tier, risk_rule,
      owner_type, budget_id, initiated_by_service, record_type, record_ref)
    values (p_request_id, a.id, case when a.owner_type = 'individual' then a.user_id else p_actor end, a.product, p_activity, p_pool, p_provider, p_model, pr.id, fx.id, cb.id,
      p_buffer_pct, p_policy_version, p_max_input_tokens, p_max_output_tokens, v_max, v_tier, left(p_risk_rule, 120),
      a.owner_type, a.budget_id, nullif(btrim(coalesce(p_service, '')), ''), p_record_type, p_record_ref)
    returning id into v_id;
  perform set_config('competen.ai_settlement', 'off', true);
  return query select v_id, true, 'reserved', v_max;
end;
$$;

revoke all on function public.ai_reserve(text, uuid, text, text, text, text, int, int, text, text, numeric, text, text, numeric, uuid, text, text, text, int, numeric, int) from public, anon, authenticated;
grant execute on function public.ai_reserve(text, uuid, text, text, text, text, int, int, text, text, numeric, text, text, numeric, uuid, text, text, text, int, numeric, int) to service_role;


-- Verification: the new table, the new columns, and ai_reserve with its 21 arguments.
select c.relname, c.relrowsecurity, (select count(*) from pg_policies p where p.tablename = c.relname) as policies from pg_class c where c.relname = 'ai_budget';
select proname, pronargs from pg_proc where proname = 'ai_reserve';

notify pgrst, 'reload schema';
