-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains plpgsql functions between dollar quotes. A runner that splits on the
-- statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 410: COMPETEN HOLDINGS AI USAGE LEDGER, ALLOWANCES AND ATOMIC RESERVATIONS
--
-- COMPETEN-AI-FAIR-USE-01 (owner GO 2026-10-24: development and staging authorised, production on hold).
-- Range 410-412 and 419-424.
--
-- APPLY ON STAGING FIRST. ADDITIVE. Five new tables, their guards, five accounting functions, one capability
-- and its grant. No existing row, table, policy or function is changed. Re-running it is a no-op.
-- OPS-001 s8: proposed Medium (new functions that move money-like balances), with a rollback rehearsal.
-- Depends on 264 (hq_position, hq_capability) and profiles.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR, IN ONE SENTENCE.
--
-- It lets every Competen product account for AI in one provider-independent unit (the Competen AI Allowance
-- Unit, CAU), priced from versioned, effective-dated configuration, against a per-person, per-product,
-- per-period allowance that the DATABASE reserves and settles atomically -- so concurrent requests cannot
-- overspend, a retry cannot charge twice, and a request that fails before the provider bills costs nothing.
--
-- ----------------------------------------------------------------------------------------------------
-- THE PIECES.
--
--   ai_price          provider list price per million tokens (input, output) plus any per-request extra
--                     charge, in USD, for a model id prefix, effective from a time. Versioned by rows:
--                     a price change is a NEW row, and the old one only gains its effective_to. Never
--                     updated or deleted otherwise, so historical accounting cannot move.
--   ai_fx_rate        units of a currency per USD (for example UGX), effective-dated the same way.
--   ai_cau_rate       USD per CAU, effective-dated the same way. CAU is what allowances are measured in.
--   ai_allowance_account
--                     one row per (person, product, period). included_cau and reserve_cau are the period
--                     allowance and the essential-learning reserve. used and reserved are moved ONLY by the
--                     functions below. Checks make a negative balance unrepresentable.
--   ai_usage_ledger   one row per AI request, keyed by its request_id (UNIQUE: a retry finds its row). It IS
--                     the reservation: reserved, then settled (actual tokens, cost and CAU at the price row
--                     fixed when it was reserved) or released (nothing billable happened). It carries the
--                     provider, model, tokens, extra charges, estimated and settled CAU and cost, the price,
--                     FX and CAU rate rows, the policy version and the outcome. Append-only beyond that one
--                     transition.
--
-- THE FUNCTIONS. Each takes the account row FOR UPDATE, so two requests for one account are serialised by
-- the database -- never read-then-write in application code.
--
--   ai_reserve(...)   idempotent on request_id. Prices the maximum the request may consume from the price
--                     row in force now (maximum input and output tokens), refuses an unpriced model, checks
--                     the period is live, the pool (included or reserve) has room, the rolling-window cap and
--                     the per-activity count cap, then holds that maximum. Returns whether it was granted.
--   ai_settle(...)    only from reserved. Charges the ACTUAL tokens at the reserved price row. Records any
--                     overrun beyond the reservation honestly (a token estimate is an estimate), never
--                     inventing usage. A second settle is refused.
--   ai_release(...)   only from reserved. Returns the hold: for a request that failed before the provider
--                     billed. A provider that bills a failed request is settled, not released.
--   ai_release_stale(minutes)  returns holds left by a crashed request, marked for reconciliation.
--
-- RLS: on for all five tables, no policy. Read and written by the server only. A person cannot alter their
-- allowance through any client request: there is no path for a browser to write these rows.
--
-- AUTHORITY: hq.platform.ai.manage (manage prices, FX, CAU rates and AI policies) granted to the existing
-- platform_director position. Prices are configuration rows, never code.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique
-- index. notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/AI-FAIR-USE/ROLLBACK-410.sql drops the functions, the tables (ledger
--   first) and the grant and capability. Usage records made on staging are lost.
-- ====================================================================================================


-- ---- 1. versioned accounting rates ---------------------------------------------------------------------

create table if not exists ai_price (
  id                    uuid primary key default gen_random_uuid(),
  provider              text not null,
  model_prefix          text not null,
  input_per_mtok_usd    numeric(14, 6) not null,
  output_per_mtok_usd   numeric(14, 6) not null,
  extra_per_request_usd numeric(14, 6) not null default 0,
  effective_from        timestamptz not null default now(),
  effective_to          timestamptz,
  note                  text,
  created_by            uuid,
  created_at            timestamptz not null default now()
);
alter table ai_price drop constraint if exists ai_price_check;
alter table ai_price add constraint ai_price_check
  check (provider in ('anthropic', 'openai', 'gemini') and btrim(model_prefix) <> ''
     and input_per_mtok_usd >= 0 and output_per_mtok_usd >= 0 and extra_per_request_usd >= 0
     and (effective_to is null or effective_to > effective_from)
     and (note is null or char_length(note) <= 500));
create unique index if not exists ux_ai_price_effective on ai_price(provider, model_prefix, effective_from);
alter table ai_price enable row level security;

create table if not exists ai_fx_rate (
  id              uuid primary key default gen_random_uuid(),
  currency        text not null,
  per_usd         numeric(18, 6) not null,
  effective_from  timestamptz not null default now(),
  effective_to    timestamptz,
  note            text,
  created_by      uuid,
  created_at      timestamptz not null default now()
);
alter table ai_fx_rate drop constraint if exists ai_fx_rate_check;
alter table ai_fx_rate add constraint ai_fx_rate_check
  check (currency ~ '^[A-Z]{3}$' and per_usd > 0 and (effective_to is null or effective_to > effective_from)
     and (note is null or char_length(note) <= 500));
create unique index if not exists ux_ai_fx_rate_effective on ai_fx_rate(currency, effective_from);
alter table ai_fx_rate enable row level security;

create table if not exists ai_cau_rate (
  id              uuid primary key default gen_random_uuid(),
  usd_per_cau     numeric(14, 8) not null,
  effective_from  timestamptz not null default now(),
  effective_to    timestamptz,
  note            text,
  created_by      uuid,
  created_at      timestamptz not null default now()
);
alter table ai_cau_rate drop constraint if exists ai_cau_rate_check;
alter table ai_cau_rate add constraint ai_cau_rate_check
  check (usd_per_cau > 0 and (effective_to is null or effective_to > effective_from) and (note is null or char_length(note) <= 500));
create unique index if not exists ux_ai_cau_rate_effective on ai_cau_rate(effective_from);
alter table ai_cau_rate enable row level security;

-- A rate row is history. It may only gain its effective_to, once. Anything else is a new row.
create or replace function public.ai_rate_history_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'ai rates are history: a rate row cannot be deleted. End it and add a new one';
  end if;
  if old.effective_to is not null or new.effective_to is null
     or (to_jsonb(new) - 'effective_to') is distinct from (to_jsonb(old) - 'effective_to') then
    raise exception 'ai rates are history: only an open rate may be ended, once. Add a new row for a new rate';
  end if;
  return new;
end;
$$;

drop trigger if exists ai_price_history_guard on ai_price;
create trigger ai_price_history_guard before update or delete on ai_price for each row execute function public.ai_rate_history_guard();
drop trigger if exists ai_fx_rate_history_guard on ai_fx_rate;
create trigger ai_fx_rate_history_guard before update or delete on ai_fx_rate for each row execute function public.ai_rate_history_guard();
drop trigger if exists ai_cau_rate_history_guard on ai_cau_rate;
create trigger ai_cau_rate_history_guard before update or delete on ai_cau_rate for each row execute function public.ai_rate_history_guard();


-- ---- 2. allowance accounts ----------------------------------------------------------------------------

create table if not exists ai_allowance_account (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references profiles(id) on delete cascade,
  product               text not null,
  period_start          timestamptz not null,
  period_end            timestamptz not null,
  included_cau          numeric(14, 4) not null,
  reserve_cau           numeric(14, 4) not null default 0,
  used_cau              numeric(14, 4) not null default 0,
  reserved_cau          numeric(14, 4) not null default 0,
  reserve_used_cau      numeric(14, 4) not null default 0,
  reserve_reserved_cau  numeric(14, 4) not null default 0,
  policy_version        text not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
alter table ai_allowance_account drop constraint if exists ai_allowance_account_check;
alter table ai_allowance_account add constraint ai_allowance_account_check
  check (product in ('scholar', 'professional') and period_end > period_start
     and included_cau >= 0 and reserve_cau >= 0
     and used_cau >= 0 and reserved_cau >= 0 and reserve_used_cau >= 0 and reserve_reserved_cau >= 0
     and char_length(policy_version) between 1 and 120);
create unique index if not exists ux_ai_allowance_account_period on ai_allowance_account(user_id, product, period_start);
alter table ai_allowance_account enable row level security;


-- ---- 3. the usage ledger, which is also the reservation ---------------------------------------------

create table if not exists ai_usage_ledger (
  id                uuid primary key default gen_random_uuid(),
  request_id        text not null,
  account_id        uuid not null references ai_allowance_account(id) on delete cascade,
  user_id           uuid not null,
  product           text not null,
  activity          text not null,
  pool              text not null,
  status            text not null default 'reserved',
  provider          text not null,
  model             text not null,
  price_id          uuid not null references ai_price(id),
  cau_rate_id       uuid not null references ai_cau_rate(id),
  policy_version    text not null,
  max_input_tokens  int not null,
  max_output_tokens int not null,
  max_cau           numeric(14, 6) not null,
  input_tokens      int,
  output_tokens     int,
  extra_charge_usd  numeric(14, 6),
  cost_usd          numeric(14, 6),
  settled_cau       numeric(14, 6),
  overrun_cau       numeric(14, 6),
  outcome           text,
  created_at        timestamptz not null default now(),
  settled_at        timestamptz
);
alter table ai_usage_ledger drop constraint if exists ai_usage_ledger_check;
alter table ai_usage_ledger add constraint ai_usage_ledger_check
  check (char_length(request_id) between 8 and 200 and pool in ('included', 'reserve')
     and status in ('reserved', 'settled', 'released')
     and max_input_tokens >= 0 and max_output_tokens > 0 and max_cau > 0
     and (status = 'reserved') = (settled_at is null)
     and (status <> 'settled' or (input_tokens >= 0 and output_tokens >= 0 and cost_usd >= 0 and settled_cau >= 0 and overrun_cau >= 0))
     and (status <> 'released' or (coalesce(settled_cau, 0) = 0 and coalesce(cost_usd, 0) = 0))
     and (outcome is null or outcome in ('ok', 'refusal', 'error', 'timeout', 'not_configured', 'expired')));
create unique index if not exists ux_ai_usage_ledger_request on ai_usage_ledger(request_id);
create index if not exists idx_ai_usage_ledger_account_time on ai_usage_ledger(account_id, created_at desc);
alter table ai_usage_ledger enable row level security;

-- Append-only beyond reserved -> settled or released, and only through the functions below (which set the
-- transaction-local flag). A cascade from the account still deletes.
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
    raise exception 'ai_usage_ledger: a usage record changes only through ai_settle or ai_release';
  end if;
  if old.status <> 'reserved' then
    raise exception 'ai_usage_ledger: request % is already %', old.request_id, old.status;
  end if;
  if new.request_id is distinct from old.request_id or new.account_id is distinct from old.account_id or new.price_id is distinct from old.price_id
     or new.max_cau is distinct from old.max_cau or new.pool is distinct from old.pool or new.cau_rate_id is distinct from old.cau_rate_id then
    raise exception 'ai_usage_ledger: what was reserved cannot be rewritten';
  end if;
  return new;
end;
$$;
drop trigger if exists ai_usage_ledger_guard on ai_usage_ledger;
create trigger ai_usage_ledger_guard before update or delete on ai_usage_ledger for each row execute function public.ai_usage_ledger_guard();

-- Balances move only through the functions below, never by a direct write.
create or replace function public.ai_allowance_account_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'INSERT' then
    if new.used_cau <> 0 or new.reserved_cau <> 0 or new.reserve_used_cau <> 0 or new.reserve_reserved_cau <> 0 then
      raise exception 'ai_allowance_account: an account opens with nothing used or reserved';
    end if;
    return new;
  end if;
  if coalesce(current_setting('competen.ai_settlement', true), '') <> 'on'
     and (new.used_cau is distinct from old.used_cau or new.reserved_cau is distinct from old.reserved_cau
       or new.reserve_used_cau is distinct from old.reserve_used_cau or new.reserve_reserved_cau is distinct from old.reserve_reserved_cau) then
    raise exception 'ai_allowance_account: balances change only through ai_reserve, ai_settle and ai_release';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists ai_allowance_account_guard on ai_allowance_account;
create trigger ai_allowance_account_guard before insert or update on ai_allowance_account for each row execute function public.ai_allowance_account_guard();


-- ---- 4. the accounting functions ----------------------------------------------------------------------

-- The price row for a model at a time: the longest matching prefix in force.
create or replace function public.ai_price_at(p_provider text, p_model text, p_at timestamptz)
returns ai_price
language sql
stable
set search_path = public, pg_catalog
as $$
  select * from ai_price
   where provider = p_provider and p_model like model_prefix || '%'
     and effective_from <= p_at and (effective_to is null or effective_to > p_at)
   order by char_length(model_prefix) desc, effective_from desc
   limit 1
$$;

create or replace function public.ai_reserve(
  p_request_id text, p_account uuid, p_activity text, p_pool text, p_provider text, p_model text,
  p_max_input_tokens int, p_max_output_tokens int, p_policy_version text,
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
  cr ai_cau_rate%rowtype;
  v_max numeric;
  v_window numeric;
  v_count int;
begin
  select * into existing from ai_usage_ledger l where l.request_id = p_request_id;
  if found then
    return query select existing.id, existing.status <> 'released', 'retry: ' || existing.status, existing.max_cau;
    return;
  end if;
  select * into a from ai_allowance_account where id = p_account for update;
  if not found then return query select null::uuid, false, 'no_account', null::numeric; return; end if;
  -- The lock is held: a concurrent duplicate may have inserted while this one waited.
  select * into existing from ai_usage_ledger l where l.request_id = p_request_id;
  if found then
    return query select existing.id, existing.status <> 'released', 'retry: ' || existing.status, existing.max_cau;
    return;
  end if;
  if now() < a.period_start or now() >= a.period_end then
    return query select null::uuid, false, 'period_not_live', null::numeric; return;
  end if;
  select * into pr from ai_price_at(p_provider, p_model, now());
  if pr.id is null then return query select null::uuid, false, 'model_not_priced', null::numeric; return; end if;
  select * into cr from ai_cau_rate where effective_from <= now() and (effective_to is null or effective_to > now()) order by effective_from desc limit 1;
  if not found then return query select null::uuid, false, 'no_cau_rate', null::numeric; return; end if;
  v_max := round(((p_max_input_tokens::numeric * pr.input_per_mtok_usd + p_max_output_tokens::numeric * pr.output_per_mtok_usd) / 1000000
    + pr.extra_per_request_usd) / cr.usd_per_cau, 6);
  if v_max <= 0 then v_max := 0.000001; end if;
  if p_window_minutes is not null and p_window_cap_cau is not null then
    select coalesce(sum(case when l.status = 'settled' then l.settled_cau when l.status = 'reserved' then l.max_cau else 0 end), 0) into v_window
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
  insert into ai_usage_ledger (request_id, account_id, user_id, product, activity, pool, provider, model, price_id, cau_rate_id,
      policy_version, max_input_tokens, max_output_tokens, max_cau)
    values (p_request_id, a.id, a.user_id, a.product, p_activity, p_pool, p_provider, p_model, pr.id, cr.id,
      p_policy_version, p_max_input_tokens, p_max_output_tokens, v_max)
    returning id into v_id;
  perform set_config('competen.ai_settlement', 'off', true);
  return query select v_id, true, 'reserved', v_max;
end;
$$;

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
  cr ai_cau_rate%rowtype;
  v_cost numeric;
  v_cau numeric;
begin
  select * into l from ai_usage_ledger where request_id = p_request_id;
  if not found then raise exception 'ai_settle: unknown request %', p_request_id; end if;
  perform 1 from ai_allowance_account where id = l.account_id for update;
  select * into l from ai_usage_ledger where request_id = p_request_id for update;
  if l.status <> 'reserved' then raise exception 'ai_settle: request % is already %', p_request_id, l.status; end if;
  if p_input_tokens < 0 or p_output_tokens < 0 or coalesce(p_extra_usd, 0) < 0 then raise exception 'ai_settle: negative usage'; end if;
  -- At the price fixed when it was reserved, so a later price change cannot rewrite this request.
  select * into pr from ai_price where id = l.price_id;
  select * into cr from ai_cau_rate where id = l.cau_rate_id;
  v_cost := round((p_input_tokens::numeric * pr.input_per_mtok_usd + p_output_tokens::numeric * pr.output_per_mtok_usd) / 1000000
    + pr.extra_per_request_usd + coalesce(p_extra_usd, 0), 6);
  v_cau := round(v_cost / cr.usd_per_cau, 6);
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
  if l.status <> 'reserved' then raise exception 'ai_release: request % is already %', p_request_id, l.status; end if;
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

-- Holds left by a request that never came back. Released and marked expired for reconciliation.
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
    perform ai_release(r.request_id, 'expired');
    n := n + 1;
  end loop;
  return n;
end;
$$;


-- Only the server may call them. Supabase grants execute to everyone by default, and a browser holding the
-- public key could otherwise call them (RLS would still hide every row, but nothing should depend on that).
revoke all on function public.ai_reserve(text, uuid, text, text, text, text, int, int, text, int, numeric, int) from public, anon, authenticated;
revoke all on function public.ai_settle(text, text, int, int, numeric, text) from public, anon, authenticated;
revoke all on function public.ai_release(text, text) from public, anon, authenticated;
revoke all on function public.ai_release_stale(int) from public, anon, authenticated;
revoke all on function public.ai_price_at(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.ai_reserve(text, uuid, text, text, text, text, int, int, text, int, numeric, int) to service_role;
grant execute on function public.ai_settle(text, text, int, int, numeric, text) to service_role;
grant execute on function public.ai_release(text, text) to service_role;
grant execute on function public.ai_release_stale(int) to service_role;
grant execute on function public.ai_price_at(text, text, timestamptz) to service_role;


-- ---- 5. authority -------------------------------------------------------------------------------------

insert into hq_capability (code, space, label, description) values
  ('hq.platform.ai.manage', 'platform', 'AI usage governance',
   'Manage AI prices, exchange rates, allowance-unit rates and product AI usage policies')
on conflict (code) do nothing;

insert into hq_position_capability (position_code, capability_code, source)
select p.code, c.code, 'position_default'
from (values ('platform_director')) as p(code)
cross join (values ('hq.platform.ai.manage')) as c(code)
where exists (select 1 from hq_position x where x.code = p.code)
  and not exists (
    select 1 from hq_position_capability x
    where x.position_code = p.code and x.capability_code = c.code and x.effective_to is null
  );


-- Verification: five tables with RLS on and no policy, the functions, and no rows.
select c.relname, c.relrowsecurity, (select count(*) from pg_policies p where p.tablename = c.relname) as policies
  from pg_class c
 where c.relname in ('ai_price', 'ai_fx_rate', 'ai_cau_rate', 'ai_allowance_account', 'ai_usage_ledger')
 order by c.relname;

select proname from pg_proc where proname in ('ai_reserve', 'ai_settle', 'ai_release', 'ai_release_stale', 'ai_price_at') order by proname;

notify pgrst, 'reload schema';
