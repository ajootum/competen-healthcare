-- ====================================================================================================
-- MIGRATION 903: LIFEOS TENANT DOMAINS
--
-- APPLY THIS FILE WHOLE. It contains a plpgsql function body, and a runner that splits on semicolons would cut it in half.
--
-- LIFEOS-API-001 delivery step 7. ADR-018.
--
-- APPLY ON STAGING FIRST. It adds one lifeos_ table and replaces lifeos_mutate. It writes no row and serves nothing:
-- a host is only honoured once it is verified, and only with LIFEOS_TENANT_HOSTS=1 on the server.
--
-- DEPENDS ON: 901-lifeos-core.sql.
-- ----------------------------------------------------------------------------------------------------
-- lifeos_mutate changes in one way. Its list of writable tables becomes a list of what is NOT writable, so a new
-- lifeos_ table does not need a new copy of this function. It still writes only lifeos_ base tables, and it still
-- refuses the audit log, the classification log, the gate, the terms and its own bookkeeping.
-- A hostname is unique across all tenants, so one domain can never answer for two organisations.
-- ====================================================================================================

create table if not exists lifeos_tenant_domain (
  id uuid primary key default gen_random_uuid(),
  schema_version integer not null default 1,
  tenant_id uuid not null references lifeos_tenant (id),
  owner_individual_id uuid references lifeos_individual (id),
  hostname text not null unique check (hostname = lower(hostname) and length(hostname) between 4 and 253),
  verification_token text not null check (length(verification_token) between 16 and 200),
  verified_at timestamptz,
  access_scope text not null default 'private' check (access_scope in ('private', 'workspace')),
  status text not null default 'pending' check (status in ('pending', 'verified', 'suspended', 'removed')),
  provenance_source text not null check (provenance_source in ('user', 'ai_suggestion', 'integration', 'import', 'system')),
  provenance_ref text,
  version integer not null default 1,
  created_by uuid not null references lifeos_individual (id),
  updated_by uuid not null references lifeos_individual (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint lifeos_tenant_domain_verified_shape check ((status = 'verified') = (verified_at is not null) or status in ('suspended', 'removed'))
);

create index if not exists lifeos_tenant_domain_tenant on lifeos_tenant_domain (tenant_id, status);

create or replace trigger lifeos_stamp_tenant_domain before insert or update on lifeos_tenant_domain for each row execute function lifeos_stamp('tenant_id', 'hostname', 'verification_token');
create or replace trigger lifeos_audit_tenant_domain after insert or update on lifeos_tenant_domain for each row execute function lifeos_audit('tenant_domain');

alter table lifeos_tenant_domain enable row level security;
revoke all on lifeos_tenant_domain from anon, authenticated;

create or replace function lifeos_mutate(
  p_actor uuid,
  p_actor_kind text,
  p_idempotency_key text,
  p_request_hash text,
  p_trace_id text,
  p_ops jsonb
) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare
  not_writable text[] := array[
    'lifeos_audit_event', 'lifeos_quadrant_classification', 'lifeos_flag', 'lifeos_idempotency', 'lifeos_rate_window', 'lifeos_terms'
  ];
  has_workspace boolean;
  protected_on_update text[] := array['id', 'workspace_id', 'created_at', 'created_by', 'version', 'updated_at', 'schema_version'];
  existing lifeos_idempotency%rowtype;
  op jsonb;
  t text;
  kind text;
  vals jsonb;
  keys text[];
  valid text[];
  cols text;
  sql_text text;
  row_out jsonb;
  rows_out jsonb := '[]'::jsonb;
  refs jsonb := '[]'::jsonb;
  op_id uuid;
  op_ws uuid;
  op_ver integer;
begin
  if p_actor_kind not in ('user', 'ai', 'integration', 'system') then
    raise exception 'lifeos: bad actor kind' using errcode = 'LO400';
  end if;
  if jsonb_typeof(p_ops) <> 'array' or jsonb_array_length(p_ops) = 0 then
    raise exception 'lifeos: ops must be a non-empty array' using errcode = 'LO400';
  end if;
  perform set_config('lifeos.actor_kind', p_actor_kind, true);
  perform set_config('lifeos.trace_id', coalesce(p_trace_id, ''), true);

  if p_idempotency_key is not null then
    if p_actor is null or p_request_hash is null then
      raise exception 'lifeos: an idempotent write needs an actor and a request hash' using errcode = 'LO400';
    end if;
    insert into lifeos_idempotency (actor_individual_id, idempotency_key, request_hash)
      values (p_actor, p_idempotency_key, p_request_hash)
      on conflict (actor_individual_id, idempotency_key) do nothing;
    if not found then
      select * into existing from lifeos_idempotency
        where actor_individual_id = p_actor and idempotency_key = p_idempotency_key for update;
      if existing.expires_at > now() then
        if existing.request_hash <> p_request_hash then
          raise exception 'lifeos: idempotency key reused with a different request' using errcode = 'LO410';
        end if;
        return jsonb_build_object('replayed', true, 'refs', coalesce(existing.result, '[]'::jsonb), 'rows', '[]'::jsonb);
      end if;
      update lifeos_idempotency
        set request_hash = p_request_hash, result = null, created_at = now(), expires_at = now() + interval '24 hours'
        where actor_individual_id = p_actor and idempotency_key = p_idempotency_key;
    end if;
  end if;

  for op in select value from jsonb_array_elements(p_ops) loop
    t := op ->> 't';
    kind := op ->> 'op';
    vals := coalesce(op -> 'values', '{}'::jsonb);
    if t is null or t !~ '^lifeos_[a-z_]+$' or t = any (not_writable)
      or not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name::text = t and table_type = 'BASE TABLE') then
      raise exception 'lifeos: table not writable' using errcode = 'LO400';
    end if;
    select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name::text = t and column_name = 'workspace_id') into has_workspace;
    if kind = 'insert' then
      if p_actor is not null then
        vals := vals || jsonb_build_object('created_by', p_actor, 'updated_by', p_actor);
      end if;
    elsif kind = 'update' then
      if p_actor is not null then
        vals := vals || jsonb_build_object('updated_by', p_actor);
      end if;
    else
      raise exception 'lifeos: unknown op' using errcode = 'LO400';
    end if;

    select array_agg(k) into keys from jsonb_object_keys(vals) as k;
    select array_agg(column_name::text) into valid from information_schema.columns
      where table_schema = 'public' and table_name::text = t and is_generated = 'NEVER' and is_identity = 'NO'
        and column_name::text = any (keys)
        and (kind = 'insert' or not (column_name::text = any (protected_on_update)));
    if coalesce(array_length(valid, 1), 0) <> coalesce(array_length(keys, 1), 0) then
      raise exception 'lifeos: a column is unknown or protected on %', t using errcode = 'LO400';
    end if;
    select string_agg(quote_ident(c), ', ') into cols from unnest(valid) as c;

    if kind = 'insert' then
      sql_text := format(
        'insert into %1$I (%2$s) select %2$s from jsonb_populate_record(null::%1$I, $1) returning to_jsonb(%1$I.*)', t, cols
      );
      execute sql_text into row_out using vals;
    else
      op_id := (op ->> 'id')::uuid;
      op_ws := (op ->> 'workspace_id')::uuid;
      op_ver := (op ->> 'expected_version')::integer;
      if op_id is null then
        raise exception 'lifeos: an update needs an id' using errcode = 'LO400';
      end if;
      if not has_workspace then
        sql_text := format(
          'update %1$I set (%2$s) = (select %2$s from jsonb_populate_record(null::%1$I, $1)) where id = $2 and ($4::integer is null or version = $4) returning to_jsonb(%1$I.*)',
          t, cols
        );
      else
        if op_ws is null then
          raise exception 'lifeos: an update on % needs a workspace', t using errcode = 'LO400';
        end if;
        sql_text := format(
          'update %1$I set (%2$s) = (select %2$s from jsonb_populate_record(null::%1$I, $1)) where id = $2 and workspace_id = $3 and ($4::integer is null or version = $4) returning to_jsonb(%1$I.*)',
          t, cols
        );
      end if;
      row_out := null;
      execute sql_text into row_out using vals, op_id, op_ws, op_ver;
      if row_out is null then
        if op_ver is not null then
          execute format('select to_jsonb(%1$I.*) from %1$I where id = $1', t) into row_out using op_id;
          if row_out is not null then
            raise exception 'lifeos: the record has changed since it was read' using errcode = 'LO409';
          end if;
        end if;
        raise exception 'lifeos: no such record' using errcode = 'LO404';
      end if;
    end if;
    rows_out := rows_out || jsonb_build_array(row_out);
    refs := refs || jsonb_build_array(jsonb_build_object('t', t, 'id', row_out ->> 'id'));
  end loop;

  if p_idempotency_key is not null then
    update lifeos_idempotency set result = refs
      where actor_individual_id = p_actor and idempotency_key = p_idempotency_key;
  end if;
  return jsonb_build_object('replayed', false, 'refs', refs, 'rows', rows_out);
end;
$$;

revoke all on function lifeos_mutate(uuid, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function lifeos_mutate(uuid, text, text, text, text, jsonb) to service_role;

notify pgrst, 'reload schema';
