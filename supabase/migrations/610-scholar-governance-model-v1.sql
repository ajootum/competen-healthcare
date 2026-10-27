-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It defines plpgsql functions and a trigger between dollar quotes. A runner that
-- splits on the statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 610: COMPETEN SCHOLAR GOVERNANCE MODEL V1 WITH ADDENDUM V1.1 (COMPETEN-SCHOLAR-GOV-IMPLEMENT-01)
--
-- Owner GO, 27 Oct 2026: implement Scholar Governance Model V1 using existing Competen Holdings
-- infrastructure, with Addendum V1.1 of the same day (Holdings Technology Services beside the three levels,
-- the Scholar Technology Liaison inside Product and Technology, joint specialist clearance, reporting kept
-- apart from specialist oversight, an explicit status register). Unappointed authority stays inactive.
-- Staging first. Production needs its own owner GO.
--
-- DEPENDS ON 040 (audit_log), 264 (hq_position, hq_capability, hq_position_capability, ogs_offices,
-- ogs_office_appointments), 281 (plat_product_line), 370/376 (individual_product_administrator), 395
-- (clinical_content_reviewer), 500 (hq_actor_is_owner) and 580 (hq_capability_exclusions, last definition).
-- APPLY AFTER 580. Additive. Re-running it is a no-op. Nothing existing is changed.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT IT IS. A governance REGISTRY: the three levels, their seats, the delegations between them, the
-- Holdings Technology Services functions, the existing workflows and joint clearances each seat is linked to,
-- the status register, and the
-- appointment and conflict-of-interest records for those seats.
--
-- WHAT IT IS NOT. An authority store. Platform authority stays exactly where it is: an HQ appointment to an
-- hq_position (ogs_office_appointments in an hq_ office) and the grants of that position. Nothing in the HQ guard
-- reads these tables, and NO BODY, SEAT OR APPOINTMENT TABLE HAS A CAPABILITY COLUMN, so a seat cannot grant
-- anything by construction. authority_position_code on a seat is a LINK to the existing position that holds
-- the platform right the work of the seat needs. It is used to show that right and to apply the separation of
-- duties pairs. Filling the seat does not appoint anyone to the position, and holding the position does not
-- fill the seat.
--
-- WHY NOT ogs_offices FOR THE BOARD AND COMMITTEE. An ogs_offices row typed hq_ is read by the HQ guard
-- (context.ts resolveHqPositions), so an appointment into it whose role names a position WOULD grant that
-- position. An untyped row is read by the tenant OGS screens. Neither is safe for a body whose membership
-- must grant nothing, and OGS has no seat concept. The appointment shape (status, term, basis) is copied
-- from ogs_office_appointments.
--
-- SEPARATION OF DUTIES. A trigger on hq_gov_seat_appointment, for every writer, refuses a live appointment
-- when the person would then combine, across their live seats AND their active HQ appointments, two
-- capabilities that hq_capability_exclusions() (580) forbids together, when a seat-level independence pair
-- is crossed, when an exclusive seat (the independent director) is combined with any other seat, or when one
-- person would hold two board seats.
--
-- WHAT IS SEEDED. The structure, every seat VACANT, seven relationships of which six are PENDING (inactive)
-- and one is the documented INTERIM Holdings authority, links to existing routes, the joint clearances and a
-- status register in which nothing is verified. NOBODY IS APPOINTED.
-- No hq_position, grant, framework, AI setting or flag is touched.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique
-- index. notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/SCHOLAR-GOV-IMPLEMENT-01/ROLLBACK-610.sql
-- ====================================================================================================

-- 1. Bodies: the levels of the model and who sits above whom.
create table if not exists hq_gov_body (
  code                text primary key,
  level               smallint,
  kind                text not null,
  name                text not null,
  description         text,
  product_line_code   text references plat_product_line(code),
  parent_body_code    text references hq_gov_body(code),
  constitution_status text not null default 'pending_constitution',
  constitution_note   text,
  interim_authority   text,
  document_status     text not null default 'none',
  document_ref        text,
  sort                integer not null default 100,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now()
);
alter table hq_gov_body drop constraint if exists hq_gov_body_level_check;
-- V1.1: a shared Holdings service sits BESIDE the three Scholar levels, never as a fourth. It has no level.
alter table hq_gov_body add constraint hq_gov_body_level_check
  check ((kind = 'service' and level is null) or (kind <> 'service' and level is not null and level in (1, 2, 3)));
alter table hq_gov_body drop constraint if exists hq_gov_body_kind_check;
alter table hq_gov_body add constraint hq_gov_body_kind_check
  check (kind in ('holding_company', 'board', 'committee', 'product_lead', 'service'));
alter table hq_gov_body drop constraint if exists hq_gov_body_name_check;
alter table hq_gov_body add constraint hq_gov_body_name_check check (btrim(name) <> '');
alter table hq_gov_body drop constraint if exists hq_gov_body_constitution_check;
alter table hq_gov_body add constraint hq_gov_body_constitution_check
  check (constitution_status in ('established', 'configured', 'pending_incorporation', 'pending_constitution'));
-- A governing document is none, draft or approved. Approved needs a reference, so it cannot be claimed bare.
alter table hq_gov_body drop constraint if exists hq_gov_body_document_check;
alter table hq_gov_body add constraint hq_gov_body_document_check
  check (document_status in ('none', 'draft', 'approved')
         and (document_status <> 'approved' or btrim(coalesce(document_ref, '')) <> ''));
alter table hq_gov_body enable row level security;
drop policy if exists hq_gov_body_read on hq_gov_body;
create policy hq_gov_body_read on hq_gov_body for select to authenticated using (true);

-- 2. Seats. One holder each. No capability column, on purpose.
create table if not exists hq_gov_seat (
  code                    text primary key,
  body_code               text not null references hq_gov_body(code),
  name                    text not null,
  description             text,
  seat_kind               text not null,
  nomination_source       text,
  provider                text,
  accountability          text,
  authority_position_code text references hq_position(code),
  exclusive               boolean not null default false,
  sort                    integer not null default 100,
  is_active               boolean not null default true,
  created_at              timestamptz not null default now()
);
alter table hq_gov_seat drop constraint if exists hq_gov_seat_kind_check;
alter table hq_gov_seat add constraint hq_gov_seat_kind_check
  check (seat_kind in ('director', 'committee_function', 'lead', 'portfolio', 'it_function'));
alter table hq_gov_seat drop constraint if exists hq_gov_seat_name_check;
alter table hq_gov_seat add constraint hq_gov_seat_name_check check (btrim(name) <> '');
alter table hq_gov_seat drop constraint if exists hq_gov_seat_nomination_check;
alter table hq_gov_seat add constraint hq_gov_seat_nomination_check
  check (nomination_source is null or nomination_source in ('holdings', 'founding_partner', 'independent'));
alter table hq_gov_seat drop constraint if exists hq_gov_seat_provider_check;
alter table hq_gov_seat add constraint hq_gov_seat_provider_check
  check (provider is null or provider in ('holdings', 'scholar'));
-- A board or shareholder seat is never linked to a platform position.
alter table hq_gov_seat drop constraint if exists hq_gov_seat_director_no_position;
alter table hq_gov_seat add constraint hq_gov_seat_director_no_position
  check (seat_kind <> 'director' or authority_position_code is null);
create index if not exists idx_hq_gov_seat_body on hq_gov_seat (body_code);
alter table hq_gov_seat enable row level security;
drop policy if exists hq_gov_seat_read on hq_gov_seat;
create policy hq_gov_seat_read on hq_gov_seat for select to authenticated using (true);

-- 3. Seat-level independence pairs, beside the capability pairs of 580. Data, so more can be added.
create table if not exists hq_gov_seat_exclusion (
  seat_a     text not null references hq_gov_seat(code),
  seat_b     text not null references hq_gov_seat(code),
  reason     text not null,
  created_at timestamptz not null default now(),
  primary key (seat_a, seat_b)
);
alter table hq_gov_seat_exclusion drop constraint if exists hq_gov_seat_exclusion_distinct;
alter table hq_gov_seat_exclusion add constraint hq_gov_seat_exclusion_distinct check (seat_a <> seat_b);
alter table hq_gov_seat_exclusion enable row level security;
drop policy if exists hq_gov_seat_exclusion_read on hq_gov_seat_exclusion;
create policy hq_gov_seat_exclusion_read on hq_gov_seat_exclusion for select to authenticated using (true);

-- 4. Appointment records. Personal data: no read policy, the service role reads it for HQ screens.
create table if not exists hq_gov_seat_appointment (
  id             uuid primary key default gen_random_uuid(),
  seat_code      text not null references hq_gov_seat(code),
  person_id      uuid references profiles(id) on delete set null,
  holder_name    text,
  status         text not null default 'nominated',
  basis          text,
  effective_from date not null default current_date,
  effective_to   date,
  recorded_by    uuid references profiles(id) on delete set null,
  ended_by       uuid references profiles(id) on delete set null,
  end_reason     text,
  created_at     timestamptz not null default now()
);
alter table hq_gov_seat_appointment drop constraint if exists hq_gov_appt_status_check;
alter table hq_gov_seat_appointment add constraint hq_gov_appt_status_check
  check (status in ('nominated', 'interim', 'active', 'ended'));
alter table hq_gov_seat_appointment drop constraint if exists hq_gov_appt_holder_check;
alter table hq_gov_seat_appointment add constraint hq_gov_appt_holder_check
  check (person_id is not null or btrim(coalesce(holder_name, '')) <> '');
-- An interim or active appointment names the lawful instrument that made it.
alter table hq_gov_seat_appointment drop constraint if exists hq_gov_appt_basis_check;
alter table hq_gov_seat_appointment add constraint hq_gov_appt_basis_check
  check (status not in ('interim', 'active') or length(btrim(coalesce(basis, ''))) >= 5);
alter table hq_gov_seat_appointment drop constraint if exists hq_gov_appt_end_check;
alter table hq_gov_seat_appointment add constraint hq_gov_appt_end_check
  check (status <> 'ended' or (effective_to is not null and btrim(coalesce(end_reason, '')) <> ''));
create index if not exists idx_hq_gov_appt_seat on hq_gov_seat_appointment (seat_code);
create index if not exists idx_hq_gov_appt_person on hq_gov_seat_appointment (person_id);
alter table hq_gov_seat_appointment enable row level security;

-- 5. Conflict-of-interest declarations, one or more per appointment. Append-only.
create table if not exists hq_gov_interest_declaration (
  id             uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references hq_gov_seat_appointment(id) on delete cascade,
  interest       text not null,
  mitigation     text,
  declared_at    timestamptz not null default now(),
  recorded_by    uuid references profiles(id) on delete set null
);
alter table hq_gov_interest_declaration drop constraint if exists hq_gov_interest_text_check;
alter table hq_gov_interest_declaration add constraint hq_gov_interest_text_check check (btrim(interest) <> '');
create index if not exists idx_hq_gov_interest_appt on hq_gov_interest_declaration (appointment_id);
alter table hq_gov_interest_declaration enable row level security;

-- 6. Delegations and relationships between bodies. Pending and withdrawn delegate nothing.
--    V1.1: the relation says WHAT the line is. Corporate reporting (the solid line) is kept apart from
--    specialist oversight and the joint-review bridge, so the Committee is never drawn as the line manager
--    of the Product Lead.
create table if not exists hq_gov_delegation (
  code           text primary key,
  from_body_code text not null references hq_gov_body(code),
  to_body_code   text not null references hq_gov_body(code),
  relation       text not null,
  scope          text not null,
  status         text not null default 'pending',
  basis          text,
  decided_by     uuid references profiles(id) on delete set null,
  decided_at     timestamptz,
  sort           integer not null default 100,
  created_at     timestamptz not null default now()
);
alter table hq_gov_delegation drop constraint if exists hq_gov_delegation_status_check;
alter table hq_gov_delegation add constraint hq_gov_delegation_status_check
  check (status in ('pending', 'interim', 'approved', 'withdrawn'));
alter table hq_gov_delegation drop constraint if exists hq_gov_delegation_basis_check;
alter table hq_gov_delegation add constraint hq_gov_delegation_basis_check
  check (status not in ('interim', 'approved') or length(btrim(coalesce(basis, ''))) >= 5);
alter table hq_gov_delegation drop constraint if exists hq_gov_delegation_scope_check;
alter table hq_gov_delegation add constraint hq_gov_delegation_scope_check check (btrim(scope) <> '');
alter table hq_gov_delegation drop constraint if exists hq_gov_delegation_relation_check;
alter table hq_gov_delegation add constraint hq_gov_delegation_relation_check
  check (relation in ('interim_authority', 'corporate_reporting', 'mandate', 'specialist_oversight', 'joint_review', 'service'));
alter table hq_gov_delegation enable row level security;
drop policy if exists hq_gov_delegation_read on hq_gov_delegation;
create policy hq_gov_delegation_read on hq_gov_delegation for select to authenticated using (true);

-- 7. Links from a seat to the EXISTING workflow its work runs through, the AI escalation steps, and (V1.1)
--    the joint specialist clearances. A clearance with no workflow in the product carries no route and says
--    so in its note. It is never given an invented one. Every other link names a route and a capability.
create table if not exists hq_gov_link (
  code             text primary key,
  seat_code        text not null references hq_gov_seat(code),
  kind             text not null,
  clearance_domain text,
  step             smallint,
  label            text not null,
  route            text,
  capability_code  text references hq_capability(code),
  note             text,
  sort             integer not null default 100,
  created_at       timestamptz not null default now()
);
alter table hq_gov_link drop constraint if exists hq_gov_link_kind_check;
alter table hq_gov_link add constraint hq_gov_link_kind_check
  check (kind in ('approval_workflow', 'framework_governance', 'ai_escalation', 'administration', 'joint_clearance'));
alter table hq_gov_link drop constraint if exists hq_gov_link_domain_check;
alter table hq_gov_link add constraint hq_gov_link_domain_check
  check ((kind = 'joint_clearance' and clearance_domain in ('scholar', 'holdings')) or (kind <> 'joint_clearance' and clearance_domain is null));
alter table hq_gov_link drop constraint if exists hq_gov_link_route_check;
alter table hq_gov_link add constraint hq_gov_link_route_check
  check ((route is null and capability_code is null and kind = 'joint_clearance' and btrim(coalesce(note, '')) <> '')
         or (route like '/super-admin/%' and capability_code is not null));
alter table hq_gov_link drop constraint if exists hq_gov_link_label_check;
alter table hq_gov_link add constraint hq_gov_link_label_check check (btrim(label) <> '');
alter table hq_gov_link enable row level security;
drop policy if exists hq_gov_link_read on hq_gov_link;
create policy hq_gov_link_read on hq_gov_link for select to authenticated using (true);

-- 7b. V1.1 status register: the facts the model must never present as operational without evidence (the
--     Platform Governance Council mandate, the recovery capability, the deferred paid backup). Verified needs
--     written evidence and a named decider. Vacant seats and unapproved delegations are read from their own
--     tables, so they are not repeated here.
create table if not exists hq_gov_status_item (
  code          text primary key,
  subject       text not null,
  status        text not null,
  evidence      text,
  residual_risk text,
  decided_by    uuid references profiles(id) on delete set null,
  decided_at    timestamptz,
  sort          integer not null default 100,
  created_at    timestamptz not null default now()
);
alter table hq_gov_status_item drop constraint if exists hq_gov_status_item_status_check;
alter table hq_gov_status_item add constraint hq_gov_status_item_status_check
  check (status in ('proposed', 'pending', 'unverified', 'deferred', 'verified'));
alter table hq_gov_status_item drop constraint if exists hq_gov_status_item_verified_check;
alter table hq_gov_status_item add constraint hq_gov_status_item_verified_check
  check (status <> 'verified' or (length(btrim(coalesce(evidence, ''))) >= 10 and decided_by is not null));
alter table hq_gov_status_item drop constraint if exists hq_gov_status_item_subject_check;
alter table hq_gov_status_item add constraint hq_gov_status_item_subject_check check (btrim(subject) <> '');
alter table hq_gov_status_item enable row level security;
drop policy if exists hq_gov_status_item_read on hq_gov_status_item;
create policy hq_gov_status_item_read on hq_gov_status_item for select to authenticated using (true);

-- 8. The appointment guard, for every writer.
create or replace function hq_gov_seat_appointment_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_seat hq_gov_seat%rowtype;
  v_body hq_gov_body%rowtype;
  v_conflict text;
begin
  -- A cascade (a profile removed, ON DELETE SET NULL) is not an edit by a writer.
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    raise exception 'hq_gov history: a seat appointment is never deleted, it is ended';
  end if;

  if tg_op = 'UPDATE' then
    if old.status = 'ended' then
      raise exception 'hq_gov history: an ended appointment cannot be changed';
    end if;
    if new.seat_code is distinct from old.seat_code or new.person_id is distinct from old.person_id
       or new.holder_name is distinct from old.holder_name or new.created_at is distinct from old.created_at
       or new.recorded_by is distinct from old.recorded_by then
      raise exception 'hq_gov history: the seat, holder and recorder of an appointment never change';
    end if;
  end if;

  if new.status = 'ended' then
    return new;
  end if;

  select * into v_seat from hq_gov_seat where code = new.seat_code;
  if not found or not v_seat.is_active then
    raise exception 'hq_gov not_found: the seat % does not exist or is inactive', new.seat_code;
  end if;
  select * into v_body from hq_gov_body where code = v_seat.body_code;

  -- A board seat is filled only by lawful appointment to an incorporated company. Interim authority is
  -- Holdings as a body, never a person in a director seat.
  if v_seat.seat_kind = 'director' then
    if new.status = 'interim' then
      raise exception 'hq_gov invalid: a board seat has no interim holder. Interim authority is Competen Holdings';
    end if;
    if new.status = 'active' and v_body.constitution_status <> 'established' then
      raise exception 'hq_gov invalid: % is not incorporated, so a director cannot be appointed yet. Record a nomination', v_body.name;
    end if;
  end if;

  if exists (select 1 from hq_gov_seat_appointment a
              where a.seat_code = new.seat_code and a.status <> 'ended' and a.id <> new.id) then
    raise exception 'hq_gov exists: % already has a live record. End it first', v_seat.name;
  end if;

  if new.person_id is null then
    return new;
  end if;

  -- One board seat per person.
  if v_seat.seat_kind = 'director' and exists (
       select 1 from hq_gov_seat_appointment a join hq_gov_seat s on s.code = a.seat_code
        where a.person_id = new.person_id and a.status <> 'ended' and a.id <> new.id and s.seat_kind = 'director') then
    raise exception 'hq_gov separation_of_duties: one person cannot hold two board seats';
  end if;

  -- An exclusive seat sits beside no other seat, in either direction.
  if exists (
       select 1 from hq_gov_seat_appointment a join hq_gov_seat s on s.code = a.seat_code
        where a.person_id = new.person_id and a.status <> 'ended' and a.id <> new.id
          and (s.exclusive or v_seat.exclusive)) then
    raise exception 'hq_gov separation_of_duties: an independent seat cannot be combined with any other seat';
  end if;

  -- Seat-level independence pairs.
  select x.reason into v_conflict
    from hq_gov_seat_appointment a
    join hq_gov_seat_exclusion x
      on (x.seat_a = a.seat_code and x.seat_b = new.seat_code) or (x.seat_b = a.seat_code and x.seat_a = new.seat_code)
   where a.person_id = new.person_id and a.status <> 'ended' and a.id <> new.id
   limit 1;
  if v_conflict is not null then
    raise exception 'hq_gov separation_of_duties: %', v_conflict;
  end if;

  -- The 580 capability pairs, across the positions linked to the live seats of this person and the positions
  -- they hold by an active HQ appointment.
  with held_positions as (
    select s.authority_position_code as position_code
      from hq_gov_seat_appointment a join hq_gov_seat s on s.code = a.seat_code
     where a.person_id = new.person_id and a.status <> 'ended' and a.id <> new.id
       and s.authority_position_code is not null
    union
    select ap.role
      from ogs_office_appointments ap join ogs_offices o on o.id = ap.office_id
     where ap.person_id = new.person_id and ap.status = 'active' and o.office_type like 'hq\_%'
       and o.is_active is not false and coalesce(o.status, '') not in ('dissolved', 'archived')
  ),
  held_caps as (
    select g.capability_code from hq_position_capability g join held_positions h on h.position_code = g.position_code
     where g.effective_to is null or g.effective_to > now()
  ),
  new_caps as (
    select g.capability_code from hq_position_capability g
     where g.position_code = v_seat.authority_position_code and (g.effective_to is null or g.effective_to > now())
  )
  select e.reason into v_conflict
    from hq_capability_exclusions() e
    join new_caps n on n.capability_code in (e.capability_a, e.capability_b)
    join held_caps h on h.capability_code in (e.capability_a, e.capability_b) and h.capability_code <> n.capability_code
   limit 1;
  if v_conflict is not null then
    raise exception 'hq_gov separation_of_duties: %', v_conflict;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_hq_gov_seat_appointment_guard on hq_gov_seat_appointment;
create trigger trg_hq_gov_seat_appointment_guard
  before insert or update or delete on hq_gov_seat_appointment
  for each row execute function hq_gov_seat_appointment_guard();

-- 9. Declarations and delegations keep their history.
create or replace function hq_gov_append_only_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;
  raise exception 'hq_gov history: % rows are append-only', tg_table_name;
end;
$$;

drop trigger if exists trg_hq_gov_interest_append_only on hq_gov_interest_declaration;
create trigger trg_hq_gov_interest_append_only
  before update or delete on hq_gov_interest_declaration
  for each row execute function hq_gov_append_only_guard();

create or replace function hq_gov_delegation_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_from hq_gov_body%rowtype;
begin
  if tg_op = 'DELETE' then
    raise exception 'hq_gov history: a delegation is never deleted, it is withdrawn';
  end if;
  if tg_op = 'UPDATE' and (new.code is distinct from old.code or new.from_body_code is distinct from old.from_body_code
                           or new.to_body_code is distinct from old.to_body_code or new.scope is distinct from old.scope
                           or new.relation is distinct from old.relation) then
    raise exception 'hq_gov history: the bodies and scope of a delegation never change';
  end if;
  if tg_op = 'UPDATE' and old.status = 'withdrawn' then
    raise exception 'hq_gov history: a withdrawn delegation cannot be reopened';
  end if;
  -- Only an established body can delegate. A board that is not incorporated delegates nothing.
  if new.status in ('interim', 'approved') then
    select * into v_from from hq_gov_body where code = new.from_body_code;
    if v_from.constitution_status <> 'established' then
      raise exception 'hq_gov invalid: % is not established, so it cannot delegate yet', v_from.name;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_hq_gov_delegation_guard on hq_gov_delegation;
create trigger trg_hq_gov_delegation_guard
  before insert or update or delete on hq_gov_delegation
  for each row execute function hq_gov_delegation_guard();

-- 10. The owner-only, audited writers. Audit row first, then the change, in one transaction (the 500 shape).
create or replace function hq_gov_admin_require(p_actor uuid, p_reason text)
returns void
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if p_actor is null or not hq_actor_is_owner(p_actor) then
    raise exception 'hq_gov owner_required: recording Scholar governance records requires platform ownership';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 5 then
    raise exception 'hq_gov invalid: a reason of at least 5 characters is required';
  end if;
end;
$$;

-- Record a nomination, an interim holder or an appointment. A live nomination of the same holder is moved
-- forward rather than duplicated. An interim or active record needs its basis and a declaration of interests.
create or replace function hq_gov_admin_appoint(
  p_actor uuid, p_actor_name text, p_trace text,
  p_seat text, p_person uuid, p_holder_name text, p_status text, p_basis text, p_interests text, p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_name text := nullif(btrim(coalesce(p_holder_name, '')), '');
  v_basis text := nullif(btrim(coalesce(p_basis, '')), '');
  v_interests text := nullif(btrim(coalesce(p_interests, '')), '');
  v_existing hq_gov_seat_appointment%rowtype;
  v_id uuid;
  v_row jsonb;
begin
  perform hq_gov_admin_require(p_actor, p_reason);
  if p_status is null or p_status not in ('nominated', 'interim', 'active') then
    raise exception 'hq_gov invalid: the status must be nominated, interim or active';
  end if;
  if p_person is null and v_name is null then
    raise exception 'hq_gov invalid: name the holder, by profile or by name';
  end if;
  if p_person is not null and p_person = p_actor then
    raise exception 'hq_gov separation_of_duties: you cannot record your own appointment. Another owner records it';
  end if;
  if p_person is not null and not exists (select 1 from profiles where id = p_person) then
    raise exception 'hq_gov not_found: no profile has that id';
  end if;
  -- The name is kept with the record, so the history still says who held the seat if the profile goes.
  if p_person is not null and v_name is null then
    select coalesce(nullif(btrim(full_name), ''), 'Profile ' || p_person::text) into v_name from profiles where id = p_person;
  end if;
  if p_status in ('interim', 'active') and (v_basis is null or length(v_basis) < 5) then
    raise exception 'hq_gov invalid: an interim or active appointment names its lawful basis (resolution, instrument or decision reference)';
  end if;
  if p_status in ('interim', 'active') and v_interests is null then
    raise exception 'hq_gov invalid: a declaration of interests is required. Write None declared if there are none';
  end if;

  select * into v_existing from hq_gov_seat_appointment
   where seat_code = p_seat and status = 'nominated'
     and ((p_person is not null and person_id = p_person) or (p_person is null and person_id is null and holder_name = v_name))
   limit 1;

  v_row := jsonb_build_object('seat', p_seat, 'person_id', p_person, 'holder_name', v_name, 'status', p_status,
                              'basis', v_basis, 'from_nomination', v_existing.id is not null, 'reason', btrim(p_reason));
  insert into audit_log (actor_id, actor_name, action, entity_type, entity_name, new_value, trace_id)
  values (p_actor, p_actor_name, 'hq_gov_appoint', 'hq_gov_seat', p_seat, v_row, p_trace);

  if v_existing.id is not null then
    update hq_gov_seat_appointment set status = p_status, basis = v_basis, effective_from = current_date
     where id = v_existing.id;
    v_id := v_existing.id;
  else
    insert into hq_gov_seat_appointment (seat_code, person_id, holder_name, status, basis, recorded_by)
    values (p_seat, p_person, v_name, p_status, v_basis, p_actor)
    returning id into v_id;
  end if;

  if v_interests is not null then
    insert into hq_gov_interest_declaration (appointment_id, interest, recorded_by) values (v_id, v_interests, p_actor);
  end if;
  return v_row || jsonb_build_object('appointment_id', v_id);
end;
$$;

create or replace function hq_gov_admin_end(
  p_actor uuid, p_actor_name text, p_trace text, p_appointment uuid, p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_a hq_gov_seat_appointment%rowtype;
  v_row jsonb;
begin
  perform hq_gov_admin_require(p_actor, p_reason);
  select * into v_a from hq_gov_seat_appointment where id = p_appointment;
  if not found then
    raise exception 'hq_gov not_found: no such appointment';
  end if;
  if v_a.status = 'ended' then
    raise exception 'hq_gov unchanged: the appointment has already ended';
  end if;
  v_row := jsonb_build_object('appointment_id', v_a.id, 'seat', v_a.seat_code, 'from', v_a.status, 'reason', btrim(p_reason));
  insert into audit_log (actor_id, actor_name, action, entity_type, entity_id, entity_name, old_value, new_value, trace_id)
  values (p_actor, p_actor_name, 'hq_gov_end', 'hq_gov_seat', v_a.id, v_a.seat_code,
          jsonb_build_object('status', v_a.status), v_row, p_trace);
  update hq_gov_seat_appointment
     set status = 'ended', effective_to = greatest(current_date, effective_from), ended_by = p_actor, end_reason = btrim(p_reason)
   where id = v_a.id;
  return v_row;
end;
$$;

create or replace function hq_gov_admin_declare_interest(
  p_actor uuid, p_actor_name text, p_trace text, p_appointment uuid, p_interest text, p_mitigation text, p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_a hq_gov_seat_appointment%rowtype;
  v_row jsonb;
begin
  perform hq_gov_admin_require(p_actor, p_reason);
  if btrim(coalesce(p_interest, '')) = '' then
    raise exception 'hq_gov invalid: the interest is required';
  end if;
  select * into v_a from hq_gov_seat_appointment where id = p_appointment;
  if not found then
    raise exception 'hq_gov not_found: no such appointment';
  end if;
  v_row := jsonb_build_object('appointment_id', v_a.id, 'seat', v_a.seat_code, 'interest', btrim(p_interest),
                              'mitigation', nullif(btrim(coalesce(p_mitigation, '')), ''), 'reason', btrim(p_reason));
  insert into audit_log (actor_id, actor_name, action, entity_type, entity_id, entity_name, new_value, trace_id)
  values (p_actor, p_actor_name, 'hq_gov_declare_interest', 'hq_gov_seat', v_a.id, v_a.seat_code, v_row, p_trace);
  insert into hq_gov_interest_declaration (appointment_id, interest, mitigation, recorded_by)
  values (v_a.id, btrim(p_interest), nullif(btrim(coalesce(p_mitigation, '')), ''), p_actor);
  return v_row;
end;
$$;

create or replace function hq_gov_admin_set_delegation(
  p_actor uuid, p_actor_name text, p_trace text, p_code text, p_status text, p_basis text, p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_d hq_gov_delegation%rowtype;
  v_row jsonb;
begin
  perform hq_gov_admin_require(p_actor, p_reason);
  if p_status is null or p_status not in ('pending', 'interim', 'approved', 'withdrawn') then
    raise exception 'hq_gov invalid: the status must be pending, interim, approved or withdrawn';
  end if;
  select * into v_d from hq_gov_delegation where code = p_code;
  if not found then
    raise exception 'hq_gov not_found: no such delegation';
  end if;
  if v_d.status = p_status then
    raise exception 'hq_gov unchanged: the delegation is already %', p_status;
  end if;
  if p_status in ('interim', 'approved') and length(btrim(coalesce(p_basis, ''))) < 5 then
    raise exception 'hq_gov invalid: an interim or approved delegation names its basis (resolution, instrument or decision reference)';
  end if;
  v_row := jsonb_build_object('delegation', v_d.code, 'from', v_d.status, 'to', p_status,
                              'basis', nullif(btrim(coalesce(p_basis, '')), ''), 'reason', btrim(p_reason));
  insert into audit_log (actor_id, actor_name, action, entity_type, entity_name, old_value, new_value, trace_id)
  values (p_actor, p_actor_name, 'hq_gov_set_delegation', 'hq_gov_delegation', v_d.code,
          jsonb_build_object('status', v_d.status, 'basis', v_d.basis), v_row, p_trace);
  update hq_gov_delegation
     set status = p_status, basis = nullif(btrim(coalesce(p_basis, '')), ''), decided_by = p_actor, decided_at = now()
   where code = v_d.code;
  return v_row;
end;
$$;

-- V1.1: record a change of status with its evidence. Verified needs evidence (the constraint holds it too).
create or replace function hq_gov_admin_set_status_item(
  p_actor uuid, p_actor_name text, p_trace text, p_code text, p_status text, p_evidence text, p_residual_risk text, p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_s hq_gov_status_item%rowtype;
  v_row jsonb;
begin
  perform hq_gov_admin_require(p_actor, p_reason);
  if p_status is null or p_status not in ('proposed', 'pending', 'unverified', 'deferred', 'verified') then
    raise exception 'hq_gov invalid: the status must be proposed, pending, unverified, deferred or verified';
  end if;
  if p_status = 'verified' and length(btrim(coalesce(p_evidence, ''))) < 10 then
    raise exception 'hq_gov invalid: verified needs the evidence written down';
  end if;
  select * into v_s from hq_gov_status_item where code = p_code;
  if not found then
    raise exception 'hq_gov not_found: no such status item';
  end if;
  v_row := jsonb_build_object('item', v_s.code, 'from', v_s.status, 'to', p_status,
                              'evidence', nullif(btrim(coalesce(p_evidence, '')), ''),
                              'residual_risk', nullif(btrim(coalesce(p_residual_risk, '')), ''), 'reason', btrim(p_reason));
  insert into audit_log (actor_id, actor_name, action, entity_type, entity_name, old_value, new_value, trace_id)
  values (p_actor, p_actor_name, 'hq_gov_set_status_item', 'hq_gov_status_item', v_s.code,
          jsonb_build_object('status', v_s.status, 'evidence', v_s.evidence, 'residual_risk', v_s.residual_risk), v_row, p_trace);
  update hq_gov_status_item
     set status = p_status,
         evidence = coalesce(nullif(btrim(coalesce(p_evidence, '')), ''), evidence),
         residual_risk = coalesce(nullif(btrim(coalesce(p_residual_risk, '')), ''), residual_risk),
         decided_by = p_actor, decided_at = now()
   where code = v_s.code;
  return v_row;
end;
$$;

-- 11. Seed: Governance Model V1.1. Every seat vacant. Inserts only, never an update of an existing row.
insert into hq_gov_body (code, level, kind, name, description, product_line_code, parent_body_code,
                         constitution_status, constitution_note, interim_authority, document_status, document_ref, sort)
values
  ('competen_holdings', 1, 'holding_company', 'Competen Holdings',
   'Majority shareholder. Shared platform and IT governance.', null, null,
   'established', 'Recorded as stated in Scholar Governance Model V1 (owner GO, 27 Oct 2026). Shareholding grants no office, clinical approval or platform access.',
   null, 'none', null, 10)
on conflict (code) do nothing;
insert into hq_gov_body (code, level, kind, name, description, product_line_code, parent_body_code,
                         constitution_status, constitution_note, interim_authority, document_status, document_ref, sort)
values
  ('scholar_board', 1, 'board', 'Competen Scholar Board',
   'Target five directors after incorporation: two Holdings nominees, two founding-partner nominees, one independent director.',
   'individual', 'competen_holdings',
   'pending_incorporation', 'Competen Scholar is not incorporated. Board constitution and appointments are pending.',
   'Competen Holdings, as documented interim governance until incorporation. Interim, not formal board authority.',
   'draft', 'Shareholders agreement COMPETEN-SCHOLAR-SHA-001 (draft, not executed)', 20),
  ('scholar_governance_committee', 2, 'committee', 'Scholar Academic, Clinical and AI Governance Committee',
   'Governs educational quality, clinical safety, competency frameworks, AI educational suitability and reviewed content.',
   'individual', 'scholar_board',
   'pending_constitution', 'Not constituted. Terms of reference not written. Membership grants no clinical approval or platform access.',
   null, 'none', null, 30),
  ('scholar_product_operations', 3, 'product_lead', 'Scholar Product and Operations',
   'One Scholar Product Lead, reporting to the corporate authority and coordinating six portfolios. The Committee gives specialist oversight and is not the line manager of the Product Lead.',
   'individual', 'scholar_board',
   'pending_constitution', 'Lead and portfolios vacant.', null, 'none', null, 40)
on conflict (code) do nothing;
-- V1.1: a shared corporate service beside the three Scholar levels, so it has no level.
insert into hq_gov_body (code, level, kind, name, description, product_line_code, parent_body_code,
                         constitution_status, constitution_note, interim_authority, document_status, document_ref, sort)
values
  ('holdings_technology_services', null, 'service', 'Holdings Technology Services',
   'Shared Holdings functions, not another Scholar level. Holdings provides centrally governed technology. Scholar owns its product priorities, learner service and acceptance. The functions are accountabilities, not necessarily separate employees.',
   'platform', 'competen_holdings',
   'configured', 'Configured by the owner GO and Addendum V1.1 of 27 Oct 2026. Platform Governance Council mandate unverified. No technical function holder is assumed.',
   null, 'none', null, 50)
on conflict (code) do nothing;

insert into hq_gov_seat (code, body_code, name, description, seat_kind, nomination_source, provider, accountability, exclusive, sort) values
  ('board_holdings_nominee_1', 'scholar_board', 'Holdings nominee director (1 of 2)', 'Parent representation', 'director', 'holdings', null, null, false, 10),
  ('board_holdings_nominee_2', 'scholar_board', 'Holdings nominee director (2 of 2)', 'Parent representation', 'director', 'holdings', null, null, false, 20),
  ('board_founder_nominee_1', 'scholar_board', 'Founding-partner nominee director (1 of 2)', 'Founding partner representation', 'director', 'founding_partner', null, null, false, 30),
  ('board_founder_nominee_2', 'scholar_board', 'Founding-partner nominee director (2 of 2)', 'Founding partner representation', 'director', 'founding_partner', null, null, false, 40),
  ('board_independent_director', 'scholar_board', 'Independent director', 'Education or healthcare. Independent of Holdings, the founding partners and Scholar management.', 'director', 'independent', null, null, true, 50)
on conflict (code) do nothing;

insert into hq_gov_seat (code, body_code, name, description, seat_kind, accountability, authority_position_code, sort)
select v.code, 'scholar_governance_committee', v.name, v.description, 'committee_function', v.accountability,
       case when exists (select 1 from hq_position p where p.code = v.position_code) then v.position_code end, v.sort
from (values
  ('committee_academic_lead_chair', 'Academic Lead and Committee Chair', 'Chairs the committee.', 'Educational quality and programme standards', null::text, 10),
  ('committee_clinical_governance_lead', 'Clinical Governance Lead', null, 'Clinical safety and the clinical reviewer scopes', 'quality_council_member', 20),
  ('committee_competency_framework_lead', 'Competency Framework Lead', null, 'Competency framework governance and publication standards', 'quality_council_member', 30),
  ('committee_ai_governance_rep', 'AI Governance Representative', null, 'AI educational suitability and AI safety escalation', null, 40),
  ('committee_scholar_product_lead', 'Scholar Product Lead (committee seat)', 'Held by the Scholar Product Lead.', 'Brings product and operations to the committee', null, 50),
  ('committee_clinical_content_reviewer', 'Clinical Content Reviewer', 'Independent of the content under review.', 'Independent clinical review of content', 'clinical_content_reviewer', 60)
) as v(code, name, description, accountability, position_code, sort)
on conflict (code) do nothing;

-- V1.1: the Scholar Technology Liaison / Product Technology Lead holds the Product and Technology portfolio
-- (diagram item 4). It is the fourth IT function and it carries no deployment, security or privileged access.
insert into hq_gov_seat (code, body_code, name, description, seat_kind, accountability, authority_position_code, sort)
select v.code, 'scholar_product_operations', v.name, v.description, v.kind, v.accountability,
       case when exists (select 1 from hq_position p where p.code = v.position_code) then v.position_code end, v.sort
from (values
  ('scholar_product_lead', 'Scholar Product Lead', 'Reports to the corporate authority. Coordinates six portfolios.', 'lead', 'Scholar product, policy, programmes and pilot access', 'individual_product_administrator', 10),
  ('portfolio_product_technology', 'Product and Technology: Scholar Technology Liaison / Product Technology Lead',
   'IT function 4. Works with the Holdings Technology Authority and Engineering on requirements, delivery and acceptance. No automatic production deployment, security-administration or privileged-access authority.',
   'portfolio', 'Coordinates Scholar technical requirements, maintains the interface with Holdings Technology Services, coordinates delivery priorities, records Scholar product acceptance and escalates technical service issues', null::text, 20),
  ('portfolio_academic_operations', 'Academic Operations', 'Programmes and learning processes', 'portfolio', 'Programmes and learning processes', null, 30),
  ('portfolio_clinical_content_operations', 'Clinical Content Operations', 'Sources, clinical review and controlled publication', 'portfolio', 'Content sources, review routing and controlled publication', null, 40),
  ('portfolio_student_success', 'Student Success', 'Onboarding, learner support and complaints', 'portfolio', 'Onboarding, learner support and complaints', null, 50),
  ('portfolio_ai_quality_analytics', 'AI Quality and Analytics', 'Source sufficiency, safety, usage and cost analysis', 'portfolio', 'AI output quality, source sufficiency, usage and cost, and the first step of AI safety escalation', null, 60),
  ('portfolio_finance_administration', 'Finance and Administration', 'Budgets, controls and governance records', 'portfolio', 'Budgets, controls and governance records', null, 70)
) as v(code, name, description, kind, accountability, position_code, sort)
on conflict (code) do nothing;

insert into hq_gov_seat (code, body_code, name, description, seat_kind, provider, accountability, authority_position_code, sort)
select v.code, 'holdings_technology_services', v.name, v.description, 'it_function', 'holdings', v.accountability,
       case when exists (select 1 from hq_position p where p.code = v.position_code) then v.position_code end, v.sort
from (values
  ('it_holdings_technology_authority', 'Holdings Technology Authority',
   'IT function 1. Operates only under an existing mandate or an approved interim delegation.',
   'Architecture and engineering standards, technical decisions and release authority, shared provider and routing eligibility', 'platform_director', 10),
  ('it_information_security_authority', 'Information Security Authority',
   'IT function 2. Independent security escalation where required.',
   'Cybersecurity and privileged-access governance, security incidents, exceptions and assurance', null::text, 20),
  ('it_platform_engineering_operations_owner', 'Platform Engineering and Operations Owner',
   'IT function 3.',
   'Development, deployment and monitoring, data integrity, backup and recovery operations, technical service continuity', null, 30)
) as v(code, name, description, accountability, position_code, sort)
on conflict (code) do nothing;

insert into hq_gov_seat_exclusion (seat_a, seat_b, reason) values
  ('committee_clinical_content_reviewer', 'portfolio_clinical_content_operations',
   'independent clinical review: the reviewer cannot run the content operations whose output is reviewed')
on conflict (seat_a, seat_b) do nothing;

insert into hq_gov_delegation (code, from_body_code, to_body_code, relation, scope, status, basis, sort) values
  ('holdings_interim_scholar', 'competen_holdings', 'scholar_board', 'interim_authority',
   'Documented interim corporate authority over Competen Scholar until incorporation and board constitution. Interim, not formal board authority.',
   'interim', 'Owner GO COMPETEN-SCHOLAR-GOV-IMPLEMENT-01, 27 Oct 2026 (Scholar Governance Model V1)', 10)
on conflict (code) do nothing;
insert into hq_gov_delegation (code, from_body_code, to_body_code, relation, scope, status, sort) values
  ('board_to_product', 'scholar_board', 'scholar_product_operations', 'corporate_reporting',
   'The Scholar Product Lead reports to the corporate authority', 'pending', 20),
  ('board_to_committee', 'scholar_board', 'scholar_governance_committee', 'specialist_oversight',
   'Delegated educational and clinical oversight: educational quality, clinical safety, competency frameworks, AI educational suitability and reviewed content', 'pending', 30),
  ('committee_to_product', 'scholar_governance_committee', 'scholar_product_operations', 'specialist_oversight',
   'Standards and safety conditions. Specialist consultation, not line management of the Product Lead', 'pending', 40),
  ('holdings_to_technology_services', 'competen_holdings', 'holdings_technology_services', 'mandate',
   'Mandate of the Holdings Technology Authority for technical decisions and release authority. Platform Governance Council mandate unverified', 'pending', 50),
  ('technology_services_to_product', 'holdings_technology_services', 'scholar_product_operations', 'service',
   'Shared technical governance and operations for Scholar, coordinated through the Scholar Technology Liaison', 'pending', 60),
  ('committee_technology_joint_review', 'scholar_governance_committee', 'holdings_technology_services', 'joint_review',
   'Joint specialist review bridge for changes that touch both educational or clinical and technical domains', 'pending', 70)
on conflict (code) do nothing;

insert into hq_gov_link (code, seat_code, kind, clearance_domain, step, label, route, capability_code, note, sort)
select v.code, v.seat, v.kind, v.domain, v.step, v.label, v.route, v.cap, v.note, v.sort
from (values
  ('clinical_content_approval', 'committee_clinical_content_reviewer', 'approval_workflow', null::text, null::smallint,
   'Clinical content approval queue', '/super-admin/clinical-review', 'hq.quality.clinical.approve',
   'Migration 395. Independent approval of the exact content. Needs an HQ appointment to Clinical Content Reviewer.', 10),
  ('learning_clinical_review', 'committee_clinical_content_reviewer', 'approval_workflow', null, null,
   'Learning course clinical review', '/super-admin/learning/review', 'hq.quality.clinical.approve',
   'Migration 461. The same reviewer authority.', 20),
  ('clinical_reviewer_scopes', 'committee_clinical_governance_lead', 'approval_workflow', null, null,
   'Clinical reviewer scopes and review counts', '/super-admin/clinical-review/governance', 'hq.quality.clinical.govern',
   'Migration 395. Held by Quality Council Member.', 30),
  ('framework_authoring', 'portfolio_clinical_content_operations', 'framework_governance', null, null,
   'Competency authoring', '/super-admin/competencies/authoring', 'hq.quality.competency.author',
   'Migration 465. Competency Author position.', 40),
  ('framework_publication', 'committee_competency_framework_lead', 'framework_governance', null, null,
   'Competency framework publication', '/super-admin/competencies/publication', 'hq.quality.competency.publish',
   'Migration 580. Never by the author. Every owned competency needs clinical approval first (466).', 50),
  ('scholar_programmes', 'scholar_product_lead', 'administration', null, null,
   'Scholar programmes', '/super-admin/individual/programmes', 'hq.individual.config.manage',
   'Configured by the Individual Product Administrator. No committee approval step exists in the product.', 60),
  ('scholar_policy', 'scholar_product_lead', 'administration', null, null,
   'Individual policy', '/super-admin/individual/configuration', 'hq.individual.config.manage', null, 70),
  ('scholar_pilot_access', 'scholar_product_lead', 'administration', null, null,
   'Pilot access', '/super-admin/individual', 'hq.individual.pilot.grant', null, 80),
  ('ai_escalation_1_monitor', 'portfolio_ai_quality_analytics', 'ai_escalation', null, 1,
   'Monitor AI outcomes and learner feedback', '/super-admin/ai/analytics', 'hq.platform.ai.view',
   'Identify inaccurate, unsafe or unsuitable output (migration 600 feedback and outcomes).', 110),
  ('ai_escalation_2_suitability', 'committee_ai_governance_rep', 'ai_escalation', null, 2,
   'Assess educational suitability', '/super-admin/ai/analytics', 'hq.platform.ai.view',
   'Decide whether the committee must act.', 120),
  ('ai_escalation_3_clinical', 'committee_clinical_governance_lead', 'ai_escalation', null, 3,
   'Clinical safety review', '/super-admin/clinical-review/governance', 'hq.quality.clinical.govern',
   'Where the concern is clinical.', 130),
  ('ai_escalation_4_infrastructure', 'it_holdings_technology_authority', 'ai_escalation', null, 4,
   'Restrict or change Scholar AI policy or routing', '/super-admin/ai/fair-use', 'hq.platform.ai.manage',
   'Holdings retains AI infrastructure authority, exercised under an existing mandate or approved interim delegation. Any AI eligibility change is made here.', 140),
  ('ai_escalation_5_security', 'it_information_security_authority', 'ai_escalation', null, 5,
   'Security or data incident', '/super-admin/system/security', 'hq.platform.system.view',
   'Where the incident involves security or personal data.', 150),
  -- V1.1 joint specialist clearance. A change touching both domains needs each relevant clearance, given
  -- independently, before activation. Only the existing workflows are named. No new approval engine.
  ('clearance_scholar_clinical_safety', 'committee_clinical_content_reviewer', 'joint_clearance', 'scholar', null,
   'Clinical safety', '/super-admin/clinical-review', 'hq.quality.clinical.approve',
   'Enforced in the product: independent approval of the exact content (395), required before publication (466).', 210),
  ('clearance_scholar_educational_suitability', 'committee_academic_lead_chair', 'joint_clearance', 'scholar', null,
   'Educational suitability', null, null,
   'No product workflow records this clearance yet. Recorded by the Committee outside the product.', 220),
  ('clearance_scholar_product_acceptance', 'portfolio_product_technology', 'joint_clearance', 'scholar', null,
   'Learner-facing product acceptance', null, null,
   'Recorded by the Scholar Technology Liaison. No product workflow records it yet.', 230),
  ('clearance_holdings_technical_eligibility', 'it_holdings_technology_authority', 'joint_clearance', 'holdings', null,
   'Technical eligibility (shared provider and routing)', '/super-admin/ai/fair-use', 'hq.platform.ai.manage',
   'Enforced in the product: provider, routing and eligibility changes need hq.platform.ai.manage (410).', 240),
  ('clearance_holdings_architecture', 'it_holdings_technology_authority', 'joint_clearance', 'holdings', null,
   'Architecture and engineering compliance', null, null,
   'No product workflow. Applied through code review, CI and the acceptance harnesses.', 250),
  ('clearance_holdings_cybersecurity', 'it_information_security_authority', 'joint_clearance', 'holdings', null,
   'Cybersecurity', '/super-admin/system/security', 'hq.platform.system.view', 'Security operations view.', 260),
  ('clearance_holdings_production_release', 'it_holdings_technology_authority', 'joint_clearance', 'holdings', null,
   'Production release', null, null,
   'Production deploys and migrations need a separate owner GO and are applied by the owner. Not delegated to any position.', 270)
) as v(code, seat, kind, domain, step, label, route, cap, note, sort)
where (v.cap is null or exists (select 1 from hq_capability c where c.code = v.cap))
  and exists (select 1 from hq_gov_seat s where s.code = v.seat)
on conflict (code) do nothing;

-- V1.1 status register. Recorded as the owner and the backup logs stated them on 27 Oct 2026. Nothing here
-- is marked verified.
insert into hq_gov_status_item (code, subject, status, evidence, residual_risk, sort) values
  ('scholar_board_constitution', 'Competen Scholar Board', 'proposed',
   'Competen Scholar is not incorporated. Five seats defined, all vacant. Shareholders agreement SHA-001 is a draft.',
   'Corporate decisions rest on documented interim Holdings authority until incorporation.', 10),
  ('platform_governance_council_mandate', 'Platform Governance Council mandate', 'unverified',
   'No record of a Platform Governance Council or its mandate exists in Competen HQ.',
   'The Holdings Technology Authority has no verified mandate. Its decisions need an existing mandate or an approved interim delegation.', 20),
  ('technical_appointments', 'Holdings Technology Services and Liaison appointments', 'pending',
   'The three Holdings functions and the Scholar Technology Liaison are vacant. No technical function holder is assumed.',
   'Technical decisions remain with the platform owner until lawful appointments are made.', 30),
  ('recovery_capability', 'Production recovery capability', 'unverified',
   'Local encrypted pg_dump backups by competen-db-backup.ps1 on the owner PC. Latest successful backup competen-production-20261027-1322, isolated restore test PASS (27 Oct 2026). The 27 Oct 20:30 run failed (SSL end-of-file during pg_dump), and earlier backups were kept. SSD copy not connected at the last runs. No point-in-time recovery.',
   'Data written after the last successful backup can be lost. While the SSD is disconnected every copy sits on one PC. No point-in-time recovery, and restore is manual.', 40),
  ('paid_backup_pitr', 'Paid backup and point-in-time recovery (Supabase Pro)', 'deferred',
   'Owner decision, 23 Oct 2026: no Supabase Pro upgrade and no PITR for now.',
   'Accepted by the owner. The recovery point stays the last successful local backup.', 50)
on conflict (code) do nothing;

-- Verification: nobody holds a seat (expect 0), and no delegation is approved (expect 0).
select count(*) as live_seat_records from hq_gov_seat_appointment where status <> 'ended';
select count(*) as approved_delegations from hq_gov_delegation where status = 'approved';

notify pgrst, 'reload schema';
