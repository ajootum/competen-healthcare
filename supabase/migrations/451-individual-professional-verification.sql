-- ====================================================================================================
-- MIGRATION 451: COMPETEN PROFESSIONAL -- INDEPENDENT VERIFICATION OF PROFILE RECORDS
--
-- !! APPLY THIS FILE WHOLE. It contains plpgsql functions. A runner that splits on semicolons would cut a
-- !! function body in half. Paste the entire file into the SQL editor and run it once.
--
-- COMPETEN-PROFESSIONAL-PROFILE-01, owner continuation GO part B item 1 (25 Oct 2026): independent
-- credential verification through existing Holdings authority. Verification is optional for ordinary use.
-- No verifier is appointed automatically. Development and staging authorised. Production needs its own GO.
-- Build record: docs/COMPETEN-PROFESSIONAL-PROFILE-01-stage1.md, section 6.
--
-- DEPENDS ON 450 (individual_professional_profile_item), 264 (hq_capability, hq_position,
-- hq_position_capability) and 117 (ogs_office_appointments, ogs_offices). Independent of 452 and 453.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT IT ADDS.
--
--   1. AUTHORITY, THE EXISTING WAY. Capability hq.individual.professional.verify and position
--      individual_professional_verifier, granted capability to position only. NO appointment is made here,
--      so on the day this is applied nobody can verify anything. Appointing a verifier is an owner act on
--      the existing appointment surface.
--
--   2. A VERIFICATION HISTORY, APPEND-ONLY. individual_professional_item_verification holds one row per
--      event about ONE VERSION of one profile record (450 item id). A later version of the record starts
--      unverified: a verification is about what was checked, never about what the person wrote later.
--
--        requested           the person asks for this version to be verified   (actor = the person)
--        request_withdrawn   the person withdraws an open request              (actor = the person)
--        verified            a verifier confirms it, by a stated method        (actor = a verifier)
--        declined            a verifier could not confirm it, with a reason    (actor = a verifier)
--        revoked             a verifier withdraws an earlier verification      (actor = a verifier)
--        disputed            the person disputes a verifier outcome            (actor = the person)
--
--      Expiry of a verification is valid_until on its verified row, read against today. Nothing is ever
--      rewritten: a revocation, a dispute and a fresh outcome are new rows after the old ones.
--
--   3. THE DATABASE KEEPS THE RULES, NOT ONLY THE ROUTE. A trigger refuses, on insert:
--        a verifier event by anyone who does not hold the capability through an ACTIVE appointment
--        a verifier event by the person the record belongs to (independence)
--        a person event by anyone but the person
--        a request on a superseded or withdrawn version, or while one is already open
--        a verdict with no open request or dispute, a revocation of anything but a standing verification
--      So nothing self-asserted can reach verified: the only way to the verified state is a row whose
--      actor holds the verifier appointment and is not the subject.
--
-- NO SCOPE COLUMN, NO DOCUMENT COPY. The verifier sees the record and its document through the server,
-- and only while a request or dispute is open. Nothing here is readable by an organisation.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique
-- index. experience_code-free (an event belongs to its record). RLS on, own-row SELECT only. The history
-- refuses UPDATE and DELETE except the cascade path (pg_trigger_depth() > 1). notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/COMPETEN-PROFESSIONAL-PROFILE-01/ROLLBACK-451.sql
-- ====================================================================================================


-- ---- 1. AUTHORITY: CAPABILITY AND POSITION, NO APPOINTMENT -------------------------------------------

insert into hq_capability (code, space, label, description) values
  ('hq.individual.professional.verify', 'platform', 'Competen Professional verification',
   'Record independent verification outcomes on the Professional profile records a person has asked to have verified. Never the holder''s own records.')
on conflict (code) do nothing;

insert into hq_position (code, space, name, description) values
  ('individual_professional_verifier', 'platform', 'Professional Credential Verifier',
   'Checks the qualifications, registrations and employment a person asks Competen to verify, and records the outcome. No other HQ right.')
on conflict (code) do nothing;

update hq_position
   set product_line_code = 'individual'
 where code = 'individual_professional_verifier'
   and product_line_code is distinct from 'individual';

insert into hq_position_capability (position_code, capability_code, source)
select p.code, c.code, 'position_default'
from (values ('individual_professional_verifier')) as p(code)
cross join (values ('hq.platform.home.view'), ('hq.individual.professional.verify')) as c(code)
where exists (select 1 from hq_position x where x.code = p.code)
  and exists (select 1 from hq_capability y where y.code = c.code)
  and not exists (
    select 1 from hq_position_capability x
    where x.position_code = p.code and x.capability_code = c.code and x.effective_to is null
  );


-- ---- 2. DOES A PERSON HOLD A CAPABILITY THROUGH AN ACTIVE APPOINTMENT ---------------------------------

create or replace function public.individual_holds_capability(p_person uuid, p_capability text)
returns boolean
language sql
stable
set search_path = public, pg_catalog
as $$
  select p_person is not null and exists (
    select 1
      from ogs_office_appointments a
      join ogs_offices o on o.id = a.office_id
      join hq_position p on p.code = a.role
      join hq_position_capability pc on pc.position_code = p.code
     where a.person_id = p_person
       and a.status = 'active'
       and o.is_active is not false
       and coalesce(o.status, 'active') not in ('dissolved', 'archived')
       and p.is_active
       and pc.capability_code = p_capability
       and pc.effective_to is null
       and (pc.effective_from is null or pc.effective_from <= now())
  )
$$;
revoke all on function public.individual_holds_capability(uuid, text) from public, anon, authenticated;
grant execute on function public.individual_holds_capability(uuid, text) to service_role;


-- ---- 3. THE VERIFICATION HISTORY ---------------------------------------------------------------------

create table if not exists individual_professional_item_verification (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  item_id uuid not null,
  event text not null,
  actor_id uuid references profiles(id) on delete set null,
  method text,
  valid_until date,
  reason text,
  created_at timestamptz not null default now()
);

-- The version verified belongs to the same person. Erasing the record erases its history.
alter table individual_professional_item_verification drop constraint if exists individual_professional_item_verification_item_fk;
alter table individual_professional_item_verification add constraint individual_professional_item_verification_item_fk
  foreign key (item_id, user_id) references individual_professional_profile_item(id, user_id) on delete cascade;

create index if not exists idx_individual_professional_item_verification_item
  on individual_professional_item_verification(item_id, created_at);
create index if not exists idx_individual_professional_item_verification_user
  on individual_professional_item_verification(user_id, created_at desc);

alter table individual_professional_item_verification drop constraint if exists individual_professional_item_verification_event_check;
alter table individual_professional_item_verification add constraint individual_professional_item_verification_event_check
  check (event in ('requested', 'request_withdrawn', 'verified', 'declined', 'revoked', 'disputed'));

-- A verification states how it was done. Only a verification can carry a validity date.
alter table individual_professional_item_verification drop constraint if exists individual_professional_item_verification_shape;
alter table individual_professional_item_verification add constraint individual_professional_item_verification_shape check (
  (event = 'verified') = (method is not null)
  and (method is null or method in ('register_check', 'issuer_confirmation', 'document_review', 'employer_confirmation'))
  and (event = 'verified' or valid_until is null)
  and (event not in ('declined', 'revoked', 'disputed') or char_length(btrim(coalesce(reason, ''))) between 3 and 1000)
  and char_length(coalesce(reason, '')) <= 1000
);

alter table individual_professional_item_verification enable row level security;
drop policy if exists individual_professional_item_verification_read_own on individual_professional_item_verification;
create policy individual_professional_item_verification_read_own on individual_professional_item_verification
  for select using (auth.uid() = user_id);

comment on table individual_professional_item_verification is
  'COMPETEN-PROFESSIONAL-PROFILE-01 (owner GO part B). Append-only verification history of one version of a profile record. Verifier events need hq.individual.professional.verify through an active appointment and an actor who is not the subject, enforced by trigger. Own-row read.';


-- ---- 4. THE RULES, ON INSERT -----------------------------------------------------------------------

create or replace function public.individual_professional_item_verification_guard() returns trigger
language plpgsql set search_path = public as $$
declare
  v_item record;
  v_last text;
  v_verdict text;
begin
  select section, superseded_at, withdrawn_at into v_item
    from individual_professional_profile_item where id = new.item_id and user_id = new.user_id;
  if not found then
    raise exception 'individual_professional_item_verification: no such record for this person';
  end if;
  if v_item.section not in ('qualification', 'registration', 'employment') then
    raise exception 'individual_professional_item_verification: only qualifications, registrations and employment can be verified';
  end if;

  -- The latest event that opens or closes a request, and the latest verdict.
  select event into v_last from individual_professional_item_verification
   where item_id = new.item_id order by created_at desc, id desc limit 1;
  select event into v_verdict from individual_professional_item_verification
   where item_id = new.item_id and event in ('verified', 'declined', 'revoked') order by created_at desc, id desc limit 1;

  if new.event in ('requested', 'request_withdrawn', 'disputed') then
    if new.actor_id is distinct from new.user_id then
      raise exception 'individual_professional_item_verification: only the person can request, withdraw or dispute';
    end if;
  else
    if new.actor_id is null or new.actor_id = new.user_id then
      raise exception 'individual_professional_item_verification: a verifier cannot act on their own record';
    end if;
    if not public.individual_holds_capability(new.actor_id, 'hq.individual.professional.verify') then
      raise exception 'individual_professional_item_verification: the actor does not hold the verifier appointment';
    end if;
  end if;

  if new.event = 'requested' then
    if v_item.superseded_at is not null or v_item.withdrawn_at is not null then
      raise exception 'individual_professional_item_verification: only the current version can be submitted';
    end if;
    if v_last in ('requested', 'disputed') then
      raise exception 'individual_professional_item_verification: a request is already open';
    end if;
    if v_last = 'verified' then
      raise exception 'individual_professional_item_verification: this version is already verified';
    end if;
  elsif new.event = 'request_withdrawn' then
    if v_last is distinct from 'requested' then
      raise exception 'individual_professional_item_verification: there is no open request to withdraw';
    end if;
  elsif new.event in ('verified', 'declined') then
    if v_last not in ('requested', 'disputed') or v_last is null then
      raise exception 'individual_professional_item_verification: a verdict needs an open request or dispute';
    end if;
    if v_item.superseded_at is not null or v_item.withdrawn_at is not null then
      raise exception 'individual_professional_item_verification: the record has changed since it was submitted';
    end if;
  elsif new.event = 'revoked' then
    if v_verdict is distinct from 'verified' then
      raise exception 'individual_professional_item_verification: only a standing verification can be revoked';
    end if;
  elsif new.event = 'disputed' then
    if v_verdict is null or v_last in ('requested', 'disputed') then
      raise exception 'individual_professional_item_verification: there is no verifier outcome to dispute';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists trg_individual_professional_item_verification_guard on individual_professional_item_verification;
create trigger trg_individual_professional_item_verification_guard
  before insert on individual_professional_item_verification
  for each row execute function individual_professional_item_verification_guard();


-- ---- 5. THE HISTORY REFUSES TO BE REWRITTEN ----------------------------------------------------------
--
-- No UPDATE, except the foreign key clearing actor_id when the profile of a verifier is erased, and no DELETE,
-- except the cascade from the record or the person (both pg_trigger_depth() > 1).

create or replace function public.individual_professional_item_verification_append_only() returns trigger
language plpgsql as $$
begin
  if pg_trigger_depth() > 1 then
    if tg_op = 'DELETE' then
      return old;
    end if;
    if old.actor_id is not null and new.actor_id is null
       and (new.id, new.user_id, new.item_id, new.event, new.method, new.valid_until, new.reason, new.created_at)
           is not distinct from
           (old.id, old.user_id, old.item_id, old.event, old.method, old.valid_until, old.reason, old.created_at) then
      return new;
    end if;
  end if;
  raise exception 'individual_professional_item_verification is append-only: add a new event instead';
end
$$;

drop trigger if exists trg_individual_professional_item_verification_append_only on individual_professional_item_verification;
create trigger trg_individual_professional_item_verification_append_only
  before update or delete on individual_professional_item_verification
  for each row execute function individual_professional_item_verification_append_only();


notify pgrst, 'reload schema';
