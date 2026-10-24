-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It recreates plpgsql functions between dollar quotes.
-- ====================================================================================================
-- ROLLBACK 411 (STAGING ONLY). Returns the AI fair-use schema to exactly what 410 left: the 410 accounting
-- functions and ledger guard, the 410 ledger check and status set, and no ai_cau_basis, ai_model_eligibility or
-- 411 columns. It refuses if any ledger row uses an 411 status or basis, because then the 410 shape cannot hold
-- that row. Valid for the rehearsal, before any 411 reservation exists. The 410 function bodies below are copied
-- byte for byte from 410-ai-usage-ledger-and-allowances.sql so the fingerprint returns to PRE.
do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'ai_usage_ledger' and column_name = 'fx_rate_id') then
    if exists (select 1 from ai_usage_ledger where status = 'unreconciled' or fx_rate_id is not null or cau_rate_id is null) then
      raise exception 'ROLLBACK-411 refused: ledger rows already use 411 statuses or the UGX basis';
    end if;
  end if;
end $$;

drop function if exists public.ai_mark_unreconciled(text, text);
drop function if exists public.ai_reserve(text, uuid, text, text, text, text, int, int, text, text, numeric, boolean, numeric, int, numeric, int);
drop index if exists idx_ai_usage_ledger_user_status;
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
alter table ai_usage_ledger alter column cau_rate_id set not null;
alter table ai_usage_ledger drop column if exists fx_rate_id;
alter table ai_usage_ledger drop column if exists cau_basis_id;
alter table ai_usage_ledger drop column if exists reserve_buffer_pct;
alter table ai_usage_ledger drop column if exists provider_cost_currency;
alter table ai_usage_ledger drop column if exists unreconciled_at;
drop table if exists ai_model_eligibility;
drop table if exists ai_cau_basis;
alter table ai_price drop constraint if exists ai_price_source_check;
alter table ai_price drop column if exists source_kind;
alter table ai_price drop column if exists source_ref;
alter table ai_price drop column if exists price_version;

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

notify pgrst, 'reload schema';
