-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains plpgsql function bodies between dollar quotes. A runner that splits
-- on the statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 860: HQ SCHOLAR PREVIEW (open the real Competen Scholar as a designated demonstration learner)
--
-- Owner design "HQ Direct Scholar Access and Product Preview" (2 Nov 2026). A person who holds the new
-- right opens the REAL Competen Scholar on a separate preview host, signed in as a designated
-- demonstration learner (a profile classified demo by migration 650). The preview host has its own
-- host-only session cookies, so the own session of the HQ user on the main host is never touched.
--
-- DEPENDS ON 001 (profiles), 040 + 178 (audit_log), 264 (hq_capability, hq_position, hq_position_capability),
-- 281 (hq_position.product_line_code), 370 + 376 (individual_product_administrator), 500 (hq_actor_is_owner and
-- the grant guard), 610 and 640 (position pattern), 650 (hq_account_classification). All in production.
-- Additive. Re-running it is a no-op. It deletes and alters nothing that exists.
--
-- WHAT IT ADDS
--   hq_capability                 hq.individual.scholar.preview, granted to individual_product_administrator.
--   hq_position                   individual_product_reviewer (product line individual), nobody appointed.
--                                 It holds hq.platform.home.view and the preview capability, nothing else.
--   individual_scholar_preview_learner   the designated demonstration learners. One per mode.
--                                 mode read_only is the default preview. mode testing is a sandbox learner whose
--                                 records and AI use are real but belong to the sandbox account.
--   individual_scholar_preview_session   one row per preview. A single-use ticket (2 minutes) is exchanged for a
--                                 session token (60 minutes, from the moment it is exchanged).
--   five functions, service role only, all on the DATABASE clock, each audited.
--
-- WHAT IT DOES NOT DO. It grants no access to any real learner. It writes no entitlement, membership or
-- Scholar record. It never lets an actor preview as themselves (check actor_id <> learner_id). A learner can
-- only be designated by a platform owner, and only when migration 650 classifies the account demo.
-- individual_scholar_preview_designate is a NEW READER of hq_account_classification (650). Migration 650 said
-- only three functions read that table, so this is the fourth and is deliberate.
--
-- RLS is on for both tables with no policy. Nothing is granted to anon or authenticated.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments or string literals. APPLY WHOLE banner above.
-- No partial unique index. notify pgrst last.
--
-- ROLLBACK (staging): RELEASE-2026-10-25/PENDING-37/ROLLBACK-860.sql
-- ====================================================================================================


-- ---- 1. the capability, the grant, the reviewer position -----------------------------------------------
-- Capability, position and grant ship together (311, 367, 370, 376): a capability without the grant that
-- makes it reachable locks everybody out while every harness stays green.

insert into hq_capability (code, space, label, description) values
  ('hq.individual.scholar.preview', 'platform', 'Scholar product preview',
   'Open the real Competen Scholar as the designated demonstration learner on the preview host, read-only by default')
on conflict (code) do nothing;

insert into hq_position (code, space, name, description) values
  ('individual_product_reviewer', 'platform', 'Individual Product Reviewer',
   'Views the real Competen Scholar as a designated demonstration learner, to review the product. No access to any real learner and no other HQ right.')
on conflict (code) do nothing;

update hq_position
   set product_line_code = 'individual'
 where code = 'individual_product_reviewer'
   and product_line_code is distinct from 'individual';

insert into hq_position_capability (position_code, capability_code, source)
select p.code, c.code, 'position_default'
from (values ('individual_product_administrator'), ('individual_product_reviewer')) as p(code)
cross join (values ('hq.individual.scholar.preview')) as c(code)
where exists (select 1 from hq_position x where x.code = p.code)
  and exists (select 1 from hq_capability y where y.code = c.code)
  and not exists (
    select 1 from hq_position_capability x
    where x.position_code = p.code and x.capability_code = c.code and x.effective_to is null
  );

insert into hq_position_capability (position_code, capability_code, source)
select 'individual_product_reviewer', 'hq.platform.home.view', 'position_default'
where exists (select 1 from hq_position x where x.code = 'individual_product_reviewer')
  and exists (select 1 from hq_capability y where y.code = 'hq.platform.home.view')
  and not exists (
    select 1 from hq_position_capability x
    where x.position_code = 'individual_product_reviewer' and x.capability_code = 'hq.platform.home.view' and x.effective_to is null
  );


-- ---- 2. the designated demonstration learners ----------------------------------------------------------

create table if not exists individual_scholar_preview_learner (
  user_id        uuid primary key references profiles(id) on delete cascade,
  mode           text not null,
  reason         text not null,
  designated_by  uuid references profiles(id) on delete set null,
  designated_at  timestamptz not null default now()
);

alter table individual_scholar_preview_learner drop constraint if exists individual_scholar_preview_learner_mode_check;
alter table individual_scholar_preview_learner add constraint individual_scholar_preview_learner_mode_check
  check (mode in ('read_only', 'testing'));
alter table individual_scholar_preview_learner drop constraint if exists individual_scholar_preview_learner_reason_check;
alter table individual_scholar_preview_learner add constraint individual_scholar_preview_learner_reason_check
  check (length(btrim(reason)) between 3 and 500);
alter table individual_scholar_preview_learner drop constraint if exists individual_scholar_preview_learner_mode_key;
alter table individual_scholar_preview_learner add constraint individual_scholar_preview_learner_mode_key unique (mode);
alter table individual_scholar_preview_learner drop constraint if exists individual_scholar_preview_learner_user_mode_key;
alter table individual_scholar_preview_learner add constraint individual_scholar_preview_learner_user_mode_key unique (user_id, mode);

alter table individual_scholar_preview_learner enable row level security;
revoke all on table individual_scholar_preview_learner from anon, authenticated;


-- ---- 3. the preview sessions ----------------------------------------------------------------------------
-- (learner_id, mode) is a composite foreign key: a session can only name a learner under the mode that
-- learner was designated for, so a testing session on the read-only learner cannot be represented.

create table if not exists individual_scholar_preview_session (
  id                uuid primary key default gen_random_uuid(),
  actor_id          uuid not null references profiles(id) on delete cascade,
  learner_id        uuid not null,
  mode              text not null,
  ticket            uuid not null default gen_random_uuid(),
  ticket_expires_at timestamptz not null default now() + interval '2 minutes',
  consumed_at       timestamptz,
  token             uuid,
  expires_at        timestamptz not null default now() + interval '60 minutes',
  ended_at          timestamptz,
  end_reason        text,
  return_origin     text not null,
  created_at        timestamptz not null default now()
);

alter table individual_scholar_preview_session drop constraint if exists individual_scholar_preview_session_learner_fk;
alter table individual_scholar_preview_session add constraint individual_scholar_preview_session_learner_fk
  foreign key (learner_id, mode) references individual_scholar_preview_learner (user_id, mode) on delete cascade;
alter table individual_scholar_preview_session drop constraint if exists individual_scholar_preview_session_ticket_key;
alter table individual_scholar_preview_session add constraint individual_scholar_preview_session_ticket_key unique (ticket);
alter table individual_scholar_preview_session drop constraint if exists individual_scholar_preview_session_token_key;
alter table individual_scholar_preview_session add constraint individual_scholar_preview_session_token_key unique (token);
alter table individual_scholar_preview_session drop constraint if exists individual_scholar_preview_session_actor_check;
alter table individual_scholar_preview_session add constraint individual_scholar_preview_session_actor_check
  check (actor_id <> learner_id);
alter table individual_scholar_preview_session drop constraint if exists individual_scholar_preview_session_mode_check;
alter table individual_scholar_preview_session add constraint individual_scholar_preview_session_mode_check
  check (mode in ('read_only', 'testing'));
alter table individual_scholar_preview_session drop constraint if exists individual_scholar_preview_session_origin_check;
alter table individual_scholar_preview_session add constraint individual_scholar_preview_session_origin_check
  check (return_origin ~ '^https?://[a-z0-9.-]+(:[0-9]+)?$');

create index if not exists individual_scholar_preview_session_actor_idx
  on individual_scholar_preview_session (actor_id, created_at desc);

alter table individual_scholar_preview_session enable row level security;
revoke all on table individual_scholar_preview_session from anon, authenticated;


-- ---- 4. designate a learner (owner only) -----------------------------------------------------------------

create or replace function individual_scholar_preview_designate(p_actor uuid, p_user uuid, p_mode text, p_reason text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_other uuid;
begin
  if p_actor is null or not hq_actor_is_owner(p_actor) then
    raise exception 'scholar_preview owner_required: designating a demonstration learner requires platform ownership';
  end if;
  if p_mode is null or p_mode not in ('read_only', 'testing') then
    raise exception 'scholar_preview invalid: unknown preview mode';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 or length(btrim(p_reason)) > 500 then
    raise exception 'scholar_preview invalid: a reason of 3 to 500 characters is required';
  end if;
  if p_user is null or not exists (select 1 from profiles p where p.id = p_user) then
    raise exception 'scholar_preview not_found: the account does not exist';
  end if;
  -- A new reader of the 650 classification: only an account an owner has classified demo can be designated.
  if not exists (select 1 from hq_account_classification c where c.profile_id = p_user and c.account_type = 'demo') then
    raise exception 'scholar_preview not_demo: only an account classified demo can be a demonstration learner';
  end if;
  if p_user = p_actor then
    raise exception 'scholar_preview invalid: an account cannot be its own demonstration learner';
  end if;

  select l.user_id into v_other from individual_scholar_preview_learner l where l.mode = p_mode and l.user_id <> p_user;
  if found then
    raise exception 'scholar_preview conflict: another account is already designated for this mode';
  end if;
  if exists (select 1 from individual_scholar_preview_learner l where l.user_id = p_user and l.mode <> p_mode) then
    raise exception 'scholar_preview conflict: this account is already designated for the other mode';
  end if;

  insert into individual_scholar_preview_learner (user_id, mode, reason, designated_by, designated_at)
  values (p_user, p_mode, btrim(p_reason), p_actor, now())
  on conflict (user_id) do update
    set reason = excluded.reason, designated_by = excluded.designated_by, designated_at = excluded.designated_at;

  insert into audit_log (actor_id, action, entity_type, entity_id, new_value)
  values (p_actor, 'scholar_preview_designated', 'individual_scholar_preview_learner', p_user,
          jsonb_build_object('mode', p_mode, 'reason', btrim(p_reason)));
end;
$$;


-- ---- 5. open a preview: a ticket for the designated learner of a mode -------------------------------------
-- The right to call this is checked by the route (hqApiGate). The function refuses when nobody is designated.

create or replace function individual_scholar_preview_open(p_actor uuid, p_mode text, p_return_origin text)
returns table (ticket uuid, ticket_expires_at timestamptz, session_id uuid)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_learner uuid;
  v_row individual_scholar_preview_session%rowtype;
begin
  if p_actor is null or not exists (select 1 from profiles p where p.id = p_actor) then
    raise exception 'scholar_preview invalid: unknown actor';
  end if;
  if p_mode is null or p_mode not in ('read_only', 'testing') then
    raise exception 'scholar_preview invalid: unknown preview mode';
  end if;
  select l.user_id into v_learner from individual_scholar_preview_learner l where l.mode = p_mode;
  if v_learner is null then
    raise exception 'scholar_preview no_learner: no demonstration learner is designated for this mode';
  end if;
  if v_learner = p_actor then
    raise exception 'scholar_preview invalid: an account cannot preview as itself';
  end if;

  insert into individual_scholar_preview_session (actor_id, learner_id, mode, return_origin)
  values (p_actor, v_learner, p_mode, p_return_origin)
  returning * into v_row;

  insert into audit_log (actor_id, action, entity_type, entity_id, new_value)
  values (p_actor, 'scholar_preview_opened', 'individual_scholar_preview_session', v_row.id,
          jsonb_build_object('mode', p_mode, 'learner_id', v_learner));

  return query select v_row.ticket, v_row.ticket_expires_at, v_row.id;
end;
$$;


-- ---- 6. exchange the ticket for a session: atomic, single use ----------------------------------------------
-- Returns no row when the ticket is unknown, already used, expired or its session ended. The 60 minute
-- window starts here, on the database clock.

create or replace function individual_scholar_preview_consume(p_ticket uuid)
returns table (token uuid, learner_id uuid, mode text, expires_at timestamptz, session_id uuid, actor_id uuid)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row individual_scholar_preview_session%rowtype;
begin
  update individual_scholar_preview_session s
     set consumed_at = now(),
         token = gen_random_uuid(),
         expires_at = now() + interval '60 minutes'
   where s.ticket = p_ticket
     and s.consumed_at is null
     and s.ended_at is null
     and s.ticket_expires_at > now()
  returning s.* into v_row;
  if not found then
    return;
  end if;

  insert into audit_log (actor_id, action, entity_type, entity_id, new_value)
  values (v_row.actor_id, 'scholar_preview_entered', 'individual_scholar_preview_session', v_row.id,
          jsonb_build_object('mode', v_row.mode, 'learner_id', v_row.learner_id, 'expires_at', v_row.expires_at));

  return query select v_row.token, v_row.learner_id, v_row.mode, v_row.expires_at, v_row.id, v_row.actor_id;
end;
$$;


-- ---- 7. is this session live now: not ended, not expired, token consumed ------------------------------------

create or replace function individual_scholar_preview_live(p_token uuid)
returns table (learner_id uuid, mode text, expires_at timestamptz, actor_id uuid, return_origin text, session_id uuid)
language sql
stable
security invoker
set search_path = public
as $$
  select s.learner_id, s.mode, s.expires_at, s.actor_id, s.return_origin, s.id
    from individual_scholar_preview_session s
   where p_token is not null
     and s.token = p_token
     and s.consumed_at is not null
     and s.ended_at is null
     and s.expires_at > now()
$$;


-- ---- 8. end a session (idempotent) ------------------------------------------------------------------------------

create or replace function individual_scholar_preview_end(p_token uuid, p_reason text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row individual_scholar_preview_session%rowtype;
begin
  update individual_scholar_preview_session s
     set ended_at = now(), end_reason = left(coalesce(nullif(btrim(p_reason), ''), 'ended'), 200)
   where p_token is not null and s.token = p_token and s.ended_at is null
  returning s.* into v_row;
  if not found then
    return;
  end if;
  insert into audit_log (actor_id, action, entity_type, entity_id, new_value)
  values (v_row.actor_id, 'scholar_preview_ended', 'individual_scholar_preview_session', v_row.id,
          jsonb_build_object('mode', v_row.mode, 'reason', v_row.end_reason));
end;
$$;


-- ---- 9. service role only --------------------------------------------------------------------------------------

revoke all on function individual_scholar_preview_designate(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function individual_scholar_preview_open(uuid, text, text) from public, anon, authenticated;
revoke all on function individual_scholar_preview_consume(uuid) from public, anon, authenticated;
revoke all on function individual_scholar_preview_live(uuid) from public, anon, authenticated;
revoke all on function individual_scholar_preview_end(uuid, text) from public, anon, authenticated;
grant execute on function individual_scholar_preview_designate(uuid, uuid, text, text) to service_role;
grant execute on function individual_scholar_preview_open(uuid, text, text) to service_role;
grant execute on function individual_scholar_preview_consume(uuid) to service_role;
grant execute on function individual_scholar_preview_live(uuid) to service_role;
grant execute on function individual_scholar_preview_end(uuid, text) to service_role;


-- Verification: the capability and its two grants, both tables with RLS on.
select position_code, capability_code, effective_to
  from hq_position_capability
 where capability_code = 'hq.individual.scholar.preview'
 order by position_code;

select c.relname, c.relrowsecurity
  from pg_class c
 where c.relname in ('individual_scholar_preview_learner', 'individual_scholar_preview_session')
 order by c.relname;

notify pgrst, 'reload schema';
