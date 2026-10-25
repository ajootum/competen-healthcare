-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains plpgsql trigger functions between dollar quotes. A runner that splits
-- on the statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 444: CKRI GOVERNANCE ENFORCEMENT -- LAWFUL BASIS, ETHICS EXEMPTION, PARTNER AGREEMENTS
--
-- Owner "COMPETEN -- LEARNING, PROFESSIONAL AND CKRI CONTINUATION", part C (2026-10-25). Development and staging only.
-- Fixes forward from 440 and 443, which are frozen and unchanged here: every rule below is a NEW trigger beside the
-- existing guards, and every new column is nullable or defaulted.
--
-- APPLY ON STAGING FIRST. ADDITIVE. One new table, six nullable columns on two existing CKRI tables, six functions,
-- six triggers. No existing row is changed. Re-running it is a no-op. OPS-001 s8: proposed Medium (new trigger
-- functions), with a rollback rehearsal. Depends on 440 and 443.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR, IN ONE SENTENCE.
--
-- It makes three owner principles facts the database checks: a purpose is not in force until its lawful basis and
-- the decision behind it are recorded, research does not begin until an ethics approval or a documented exemption is
-- recorded, and no external partner gets access, and no institution sponsors a study, without an authorised agreement.
--
-- ----------------------------------------------------------------------------------------------------
-- THE PIECES.
--
--   ckri_purpose  + lawful_basis, basis_decision_ref. Activation needs both (the 440 activation rules still apply).
--                   Frozen once the purpose leaves draft.
--   ckri_research_project  + ethics_exemption_ref, ethics_exemption_basis, ethics_exemption_by, ethics_exemption_at.
--                   An exemption is recorded only by a governor, only before recruitment, never together with an
--                   ethics approval, and NEVER for a purpose that requires ethics review (every research study does).
--                   Recruitment now needs an ethics approval OR an exemption, whatever the purpose (440 required it
--                   only where the purpose required ethics). An institution sponsor needs an active agreement.
--   ckri_research_dataset  releasing data to a project needs its ethics approval or exemption on record: research
--                   on data begins at release, which 443 allows from approval, before recruitment.
--   ckri_partner_agreement  a partner agreement: partner, kind, the institution it binds (if any), the project it
--                   covers (or all of that partner's projects), signed and expiry dates, where the signed copy is kept,
--                   and the five terms owner s7 requires (scientific leadership, data responsibilities, intellectual
--                   property, authorship, publication rights). Draft, then active when a governor who did not record
--                   it authorises it, then expired or terminated. Terms frozen once active.
--   ckri_research_member  an EXTERNAL member is appointed only against an active, unexpired agreement that covers
--                   the project (443 required only a reference string). Ending or expiry of the agreement ends every
--                   active external appointment made under it.
--
-- RLS: on for the new table, no policy. Execute on the expiry sweep: the service role only.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique
-- index. notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/CKRI/ROLLBACK-444.sql drops the triggers, functions, the table and the columns.
-- ====================================================================================================


-- ---- 1. lawful basis on purposes --------------------------------------------------------------------------

alter table ckri_purpose add column if not exists lawful_basis text;
alter table ckri_purpose add column if not exists basis_decision_ref text;
alter table ckri_purpose drop constraint if exists ckri_purpose_basis_check;
alter table ckri_purpose add constraint ckri_purpose_basis_check
  check ((lawful_basis is null or lawful_basis in ('consent', 'contract', 'legal_obligation', 'public_task', 'legitimate_interests', 'vital_interests'))
     and (basis_decision_ref is null or char_length(btrim(basis_decision_ref)) between 3 and 300));

create or replace function public.ckri_purpose_basis_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if old.status = 'draft' and new.status = 'active' and (new.lawful_basis is null or new.basis_decision_ref is null) then
    raise exception 'ckri_purpose: a purpose is activated only once its lawful basis and the decision behind it are recorded';
  end if;
  if old.status <> 'draft' and (new.lawful_basis is distinct from old.lawful_basis or new.basis_decision_ref is distinct from old.basis_decision_ref) then
    raise exception 'ckri_purpose: the lawful basis of an active purpose is frozen. Retire it and draft another';
  end if;
  return new;
end;
$$;
drop trigger if exists ckri_purpose_basis_guard on ckri_purpose;
create trigger ckri_purpose_basis_guard before update on ckri_purpose for each row execute function public.ckri_purpose_basis_guard();


-- ---- 2. partner agreements ----------------------------------------------------------------------------------

create table if not exists ckri_partner_agreement (
  id               uuid primary key default gen_random_uuid(),
  code             text not null,
  partner_name     text not null,
  partner_kind     text not null,
  institution_ref  uuid,
  project_id       uuid references ckri_research_project(id) on delete cascade,
  terms            jsonb not null,
  document_ref     text not null,
  signed_on        date,
  expires_on       date,
  status           text not null default 'draft',
  recorded_by      uuid not null references profiles(id),
  authorised_by    uuid references profiles(id),
  authorised_at    timestamptz,
  ended_at         timestamptz,
  end_reason       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table ckri_partner_agreement drop constraint if exists ckri_partner_agreement_check;
alter table ckri_partner_agreement add constraint ckri_partner_agreement_check
  check (code ~ '^[A-Za-z0-9][A-Za-z0-9_./-]{4,80}$'
     and char_length(btrim(partner_name)) between 2 and 300
     and partner_kind in ('university', 'nursing_school', 'hospital', 'professional_body', 'research_institution', 'other')
     and jsonb_typeof(terms) = 'object' and octet_length(terms::text) <= 20000
     and char_length(btrim(document_ref)) between 3 and 500
     and status in ('draft', 'active', 'expired', 'terminated')
     and (status = 'draft') = (authorised_at is null)
     and (status = 'draft' or (authorised_by is not null and signed_on is not null and expires_on is not null
          and ckri_keys_present(terms, array['scientific_leadership', 'data_responsibilities', 'intellectual_property', 'authorship', 'publication_rights'])))
     and (expires_on is null or signed_on is null or expires_on > signed_on)
     and (status in ('expired', 'terminated')) = (ended_at is not null)
     and (status <> 'terminated' or char_length(btrim(coalesce(end_reason, ''))) >= 5));
create unique index if not exists ux_ckri_partner_agreement_code on ckri_partner_agreement(code);
alter table ckri_partner_agreement enable row level security;

-- Is this agreement in force now, for this project (or all projects of its partner)?
create or replace function public.ckri_agreement_covers(p_code text, p_project uuid)
returns boolean
language sql
stable
set search_path = public, pg_catalog
as $$
  select exists (select 1 from ckri_partner_agreement a
                  where a.code = p_code and a.status = 'active' and a.expires_on >= current_date and a.signed_on <= current_date
                    and (a.project_id is null or a.project_id = p_project))
$$;
revoke all on function public.ckri_agreement_covers(text, uuid) from public, anon, authenticated;
grant execute on function public.ckri_agreement_covers(text, uuid) to service_role;

create or replace function public.ckri_partner_agreement_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 or old.status = 'draft' then return old; end if;
    raise exception 'ckri_partner_agreement: an agreement that was in force is the record. Terminate it instead';
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then raise exception 'ckri_partner_agreement: an agreement starts as a draft'; end if;
    if not ckri_holds_capability(new.recorded_by, 'hq.quality.research.govern') then
      raise exception 'ckri_partner_agreement: not authorised. Agreements are recorded with hq.quality.research.govern';
    end if;
    return new;
  end if;
  if new.code is distinct from old.code or new.recorded_by is distinct from old.recorded_by or new.created_at is distinct from old.created_at then
    raise exception 'ckri_partner_agreement: an agreement code and recorder cannot be rewritten';
  end if;
  if old.status <> 'draft' and (new.partner_name is distinct from old.partner_name or new.partner_kind is distinct from old.partner_kind
     or new.institution_ref is distinct from old.institution_ref or new.project_id is distinct from old.project_id or new.terms is distinct from old.terms
     or new.document_ref is distinct from old.document_ref or new.signed_on is distinct from old.signed_on or new.expires_on is distinct from old.expires_on
     or new.authorised_by is distinct from old.authorised_by) then
    raise exception 'ckri_partner_agreement: an authorised agreement is frozen. Terminate it and record the new one';
  end if;
  if old.status in ('expired', 'terminated') and new.status is distinct from old.status then
    raise exception 'ckri_partner_agreement: an % agreement stays %', old.status, old.status;
  end if;
  if old.status = 'draft' and new.status = 'active' then
    if new.authorised_by is null or new.authorised_by = new.recorded_by or not ckri_holds_capability(new.authorised_by, 'hq.quality.research.govern') then
      raise exception 'ckri_partner_agreement: not authorised. A governor who did not record the agreement authorises it';
    end if;
    if new.expires_on is null or new.expires_on < current_date then
      raise exception 'ckri_partner_agreement: an agreement already expired cannot be put in force';
    end if;
    new.authorised_at := now();
  end if;
  if old.status = 'draft' and new.status in ('expired', 'terminated') then
    raise exception 'ckri_partner_agreement: a draft was never in force. Delete it instead';
  end if;
  if old.status = 'active' and new.status in ('expired', 'terminated') then
    new.ended_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists ckri_partner_agreement_guard on ckri_partner_agreement;
create trigger ckri_partner_agreement_guard before insert or update or delete on ckri_partner_agreement for each row execute function public.ckri_partner_agreement_guard();

-- An agreement leaving force ends every active external appointment made under it.
create or replace function public.ckri_partner_agreement_end()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if old.status = 'active' and new.status in ('expired', 'terminated') then
    update ckri_research_member set status = 'ended'
     where external and status = 'active' and agreement_ref = new.code;
  end if;
  return null;
end;
$$;
drop trigger if exists ckri_partner_agreement_end on ckri_partner_agreement;
create trigger ckri_partner_agreement_end after update on ckri_partner_agreement for each row execute function public.ckri_partner_agreement_end();

-- The sweep: agreements past their expiry date are marked expired (which ends their external appointments).
create or replace function public.ckri_expire_agreements()
returns integer
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_n integer;
begin
  update ckri_partner_agreement set status = 'expired' where status = 'active' and expires_on < current_date;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.ckri_expire_agreements() from public, anon, authenticated;
grant execute on function public.ckri_expire_agreements() to service_role;

-- External access: an external member is appointed only under an agreement in force for the project.
create or replace function public.ckri_research_member_agreement_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if new.external and new.status = 'active' and (tg_op = 'INSERT' or old.status <> 'active')
     and not ckri_agreement_covers(new.agreement_ref, new.project_id) then
    raise exception 'ckri_research_member: an external member is appointed only under an authorised partner agreement in force for this project';
  end if;
  return new;
end;
$$;
drop trigger if exists ckri_research_member_agreement_guard on ckri_research_member;
create trigger ckri_research_member_agreement_guard before insert or update on ckri_research_member for each row execute function public.ckri_research_member_agreement_guard();


-- ---- 3. ethics approval or documented exemption, before research begins ------------------------------------------

alter table ckri_research_project add column if not exists ethics_exemption_ref text;
alter table ckri_research_project add column if not exists ethics_exemption_basis text;
alter table ckri_research_project add column if not exists ethics_exemption_by uuid references profiles(id);
alter table ckri_research_project add column if not exists ethics_exemption_at timestamptz;
alter table ckri_research_project drop constraint if exists ckri_research_project_exemption_check;
alter table ckri_research_project add constraint ckri_research_project_exemption_check
  check (((ethics_exemption_ref is null) = (ethics_exemption_basis is null)) and ((ethics_exemption_ref is null) = (ethics_exemption_by is null))
     and ((ethics_exemption_ref is null) = (ethics_exemption_at is null))
     and (ethics_exemption_ref is null or (char_length(btrim(ethics_exemption_ref)) >= 3 and char_length(btrim(ethics_exemption_basis)) between 20 and 2000))
     and (ethics_exemption_ref is null or ethics_ref is null));

create or replace function public.ckri_research_project_ethics_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_requires boolean;
begin
  if new.ethics_exemption_ref is distinct from old.ethics_exemption_ref or new.ethics_exemption_basis is distinct from old.ethics_exemption_basis
     or new.ethics_exemption_by is distinct from old.ethics_exemption_by or new.ethics_exemption_at is distinct from old.ethics_exemption_at then
    if old.status not in ('draft', 'submitted', 'approved') then
      raise exception 'ckri_research_project: an ethics exemption is recorded before research begins, never after';
    end if;
    if new.ethics_exemption_ref is not null then
      select requires_ethics into v_requires from ckri_purpose where code = new.purpose_code;
      if v_requires then
        raise exception 'ckri_research_project: this purpose requires ethics review, so it cannot be exempted';
      end if;
      if new.ethics_exemption_by is null or new.ethics_exemption_by <> new.changed_by or not ckri_holds_capability(new.ethics_exemption_by, 'hq.quality.research.govern') then
        raise exception 'ckri_research_project: not authorised. An ethics exemption is recorded by a governor';
      end if;
      if new.ethics_exemption_by = new.proposed_by then
        raise exception 'ckri_research_project: not independent. The proposer cannot exempt their own project';
      end if;
      new.ethics_exemption_at := now();
    end if;
  end if;
  if new.status = 'recruiting' and old.status is distinct from 'recruiting' then
    if new.ethics_ref is null and new.ethics_exemption_ref is null then
      raise exception 'ckri_research_project: research begins only with a recorded ethics approval or a documented ethics exemption';
    end if;
    if new.sponsor = 'institution' and not exists (
      select 1 from ckri_partner_agreement a
       where a.code = new.agreement_ref and a.status = 'active' and a.expires_on >= current_date and a.signed_on <= current_date
         and a.institution_ref = new.institution_ref and (a.project_id is null or a.project_id = new.id)) then
      raise exception 'ckri_research_project: an institution-sponsored project needs an authorised agreement in force with that institution';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists ckri_research_project_ethics_guard on ckri_research_project;
create trigger ckri_research_project_ethics_guard before update on ckri_research_project for each row execute function public.ckri_research_project_ethics_guard();

-- Releasing data to a project is where research on it begins.
create or replace function public.ckri_research_dataset_ethics_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if not exists (select 1 from ckri_research_project p where p.id = new.project_id and (p.ethics_ref is not null or p.ethics_exemption_ref is not null)) then
    raise exception 'ckri_research_dataset: no data is released to a project before its ethics approval or documented exemption is recorded';
  end if;
  return new;
end;
$$;
drop trigger if exists ckri_research_dataset_ethics_guard on ckri_research_dataset;
create trigger ckri_research_dataset_ethics_guard before insert on ckri_research_dataset for each row execute function public.ckri_research_dataset_ethics_guard();


-- Verification: the new table, columns and triggers.
select c.relname, c.relrowsecurity, (select count(*) from pg_policies p where p.tablename = c.relname) as policies
  from pg_class c where c.relname = 'ckri_partner_agreement';
select tgname from pg_trigger where tgname in ('ckri_purpose_basis_guard', 'ckri_partner_agreement_guard', 'ckri_partner_agreement_end',
  'ckri_research_member_agreement_guard', 'ckri_research_project_ethics_guard', 'ckri_research_dataset_ethics_guard') order by tgname;

notify pgrst, 'reload schema';
