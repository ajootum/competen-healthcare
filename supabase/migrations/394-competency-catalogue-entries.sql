-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains a plpgsql trigger function between dollar quotes. A runner that splits
-- on the statement separator would cut the function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 394: CONTROLLED COMPETENCY CATALOGUES -- REFERENCES TO EXISTING COMPETENCIES, WITH CONTENT STATUS
--
-- COMPETEN-HOLDINGS-SHARED-ENGINES-01, P0 competency catalogue (owner direction 2026-10-24). Range 394-395.
--
-- APPLY ON STAGING FIRST. ADDITIVE. One new table and its guard trigger. No existing row or policy is
-- changed. Re-running it is a no-op. OPS-001 s8: proposed Medium (new trigger function), so it carries a
-- staging rollback rehearsal.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR, IN ONE SENTENCE.
--
-- It lets a shared framework act as a CONTROLLED catalogue that names existing competencies (and through
-- them their practice and clinical practice unit, migration 011) without copying them, each with a content
-- status that says whether the content is approved, a draft, or unreviewed -- so no existing published
-- framework is exposed to Individual merely by existing, and nothing is presented as approved unless it is.
--
-- ----------------------------------------------------------------------------------------------------
-- THE TABLE. competency_catalogue_entry, one row per (catalogue, competency).
--
--   catalogue_id     the catalogue: a SHARED framework (hospital_id null). It is published through the
--                    existing governed framework lifecycle (submit, independent approval) like any other.
--   competency_id    an existing competency of a SHARED framework. Referenced, never copied. Deleting the
--                    competency removes the reference.
--   content_status   approved, draft or unreviewed. Not null, default unreviewed: a reference nobody has
--                    reviewed says so. Approved is a claim about the clinical content and is only ever
--                    written by a person through the governed configuration path.
--   status_note      why, in words (at most 500 characters), for example who reviewed it or what is missing.
--
-- NOTE: FROZEN OUTSIDE DRAFT. Entries can be added, changed or removed only while the catalogue framework is a
-- draft. Once it is in review, approved or published, its entries are what the independent approver saw,
-- and the trigger refuses any change -- except a delete that arrives by CASCADE from a parent
-- (pg_trigger_depth() > 1), so a framework or competency can still be removed.
--
-- NOTE: SHARED ONLY, BOTH SIDES. The trigger refuses a hospital framework as the catalogue and a competency
-- of a hospital framework as the entry: the own content of an organisation is never pulled into Individual.
--
-- RLS: on, no policy. Read and written by the server through the service role only, like the other
-- reference tables the HQ plane configures.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique
-- index. notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/CFCA/ROLLBACK-394.sql drops the trigger, the function and the table.
--   Catalogue entries made on staging are lost. No other table is touched.
-- ====================================================================================================

create table if not exists competency_catalogue_entry (
  id              uuid primary key default gen_random_uuid(),
  catalogue_id    uuid not null references frameworks(id) on delete cascade,
  competency_id   uuid not null references framework_competencies(id) on delete cascade,
  content_status  text not null default 'unreviewed',
  status_note     text,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table competency_catalogue_entry drop constraint if exists competency_catalogue_entry_status_check;
alter table competency_catalogue_entry add constraint competency_catalogue_entry_status_check
  check (content_status in ('approved', 'draft', 'unreviewed')
     and (status_note is null or char_length(status_note) <= 500));

create unique index if not exists ux_competency_catalogue_entry
  on competency_catalogue_entry(catalogue_id, competency_id);
create index if not exists idx_competency_catalogue_entry_competency
  on competency_catalogue_entry(competency_id);

alter table competency_catalogue_entry enable row level security;

create or replace function public.competency_catalogue_entry_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_catalogue uuid;
  v_status text;
  v_hospital uuid;
  v_comp_hospital uuid;
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  v_catalogue := case when tg_op = 'DELETE' then old.catalogue_id else new.catalogue_id end;
  select f.pub_status, f.hospital_id into v_status, v_hospital from frameworks f where f.id = v_catalogue;
  if tg_op = 'UPDATE' and new.catalogue_id is distinct from old.catalogue_id then
    raise exception 'competency_catalogue_entry: an entry cannot move to another catalogue';
  end if;
  if coalesce(v_status, 'draft') <> 'draft' then
    raise exception 'competency_catalogue_entry: catalogue % is %, so its entries are frozen. Start a new draft version', v_catalogue, v_status;
  end if;
  if v_hospital is not null then
    raise exception 'competency_catalogue_entry: a catalogue must be a shared framework';
  end if;
  if tg_op <> 'DELETE' then
    select f.hospital_id into v_comp_hospital
      from framework_competencies c join framework_domains d on d.id = c.domain_id join frameworks f on f.id = d.framework_id
     where c.id = new.competency_id;
    if v_comp_hospital is not null then
      raise exception 'competency_catalogue_entry: only competencies of shared frameworks can be referenced';
    end if;
    new.updated_at := now();
    return new;
  end if;
  return old;
end;
$$;

drop trigger if exists competency_catalogue_entry_guard on competency_catalogue_entry;
create trigger competency_catalogue_entry_guard
  before insert or update or delete on competency_catalogue_entry
  for each row execute function public.competency_catalogue_entry_guard();


-- Verification: the table, RLS on with no policy, the trigger, and no rows.
select c.relname, c.relrowsecurity,
       (select count(*) from pg_policies p where p.tablename = c.relname) as policies
  from pg_class c where c.relname = 'competency_catalogue_entry';

select tgname from pg_trigger where tgname = 'competency_catalogue_entry_guard';

select count(*) as entries from competency_catalogue_entry;

notify pgrst, 'reload schema';
