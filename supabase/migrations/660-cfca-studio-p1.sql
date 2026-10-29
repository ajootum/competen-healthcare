-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains plpgsql trigger functions between dollar quotes. A runner that splits
-- on the statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 660: CFCA COMPETENCY STUDIO, PHASE 1 -- PROGRAMME OVERLAYS, QUALIFICATION LEVELS, DACUM 0-6,
-- COMPETENCY STAGES AND THEIR VERSIONED MAPPING, CCHU ASSESSMENT COMPONENTS, NUR-FOUND DRAFT
--
-- CFCA-STUDIO-P1 (owner instruction 2026-10-29), over the CFCA-REVIEW-01 baseline.
--
-- APPLY ON STAGING FIRST. ADDITIVE ONLY. New tables, new nullable or defaulted columns, new rows.
-- No existing row, framework, version, score or assessment record is changed. Re-running it is a no-op.
-- OPS-001 s8: proposed Medium (new trigger functions), so it carries a staging rollback rehearsal.
-- Depends on 007 (scales), 013 (taxonomy), 384 (layers), 387 (programmes) and 394 (catalogue entries).
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT IT ADDS.
--
-- 1. QUALIFICATION LEVELS. A taxonomy of kind qualification_level (Enrolled, Diploma, Bachelor, Master,
--    Doctoral), editable as terms on the Metadata page, and a nullable programme link to one of them
--    (individual_scholar_programme.qualification_term_id). Competency layers stay what they are -- a level
--    is NOT a layer.
--
-- 2. THE PROGRAMME OVERLAY. Two columns on competency_catalogue_entry (394): requirement (required,
--    recommended, optional) and expected_level_id (the target level for THIS programme catalogue, null =
--    the expected level of the competency itself). A programme framework is a controlled catalogue that NAMES the
--    shared competencies it uses, so no competency is defined twice for different cadres. The 394 trigger
--    already freezes every entry column outside draft, so the overlay is what the independent publisher saw.
--
-- 3. CCHU ASSESSMENT COMPONENTS. A registry (competency_assessment_component: Clinical Skills, Knowledge,
--    Knowledge Application, more may be added as rows) and, per catalogue entry, which components apply
--    and what each must reach (competency_catalogue_entry_component: pass level, mandatory, safety
--    critical, optional weight). Frozen with its catalogue exactly like the entry. A safety-critical
--    component is always mandatory. The roll-up rule (no weighted average overrides a failed mandatory or
--    safety-critical component) is src/lib/competency/studio-components.ts.
--
-- 4. DACUM 0-6. A second scoring scale with seven levels, beside the default Benner 0-6 scale, which is
--    not touched (and stays the default). The level wording is data and editable on the Scoring page.
--
-- 5. COMPETENCY STAGES AND A VERSIONED SCALE-TO-STAGE MAPPING. competency_stage (Unstaged, Novice,
--    Advanced Beginner, Competent, Proficient, Expert), competency_stage_mapping (one version per scale,
--    draft, published or retired) and competency_stage_mapping_band (one scale level to one stage). A
--    published mapping is immutable and hashed. Publishing retires the previous published version of the
--    same scale. The publisher is never the person who drafted it. Seeded: DACUM version 1, the mapping
--    the owner approved in CFCA-STUDIO-P1 (0 Unstaged, 1-2 Novice, 3 Advanced Beginner, 4 Competent,
--    5 Proficient, 6 Expert), published on that approval.
--
-- 6. NUR-FOUND. A DRAFT shared catalogue, Competen Nursing Foundation (layer profession, profession
--    Nursing), that names the existing Core Nursing competencies -- references, not copies, all
--    unreviewed. Nothing is published, allowlisted or offered by this. Core Nursing is read, never written.
--
-- NOT ACTIVATED. No clinical verification is switched on. No assessment method, assessor or decision is
-- created. Engine A (the hospital assessment tables) is not read or written.
--
-- RLS: on, no policy, on every new table. Read and written by the server through the service role only.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique
-- index. notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/CFCA-STUDIO-P1/ROLLBACK-660.sql.
-- ====================================================================================================

-- ---------- 1. QUALIFICATION LEVELS ----------

insert into taxonomies (kind, label) values ('qualification_level', 'Qualification level')
on conflict (kind) do nothing;

insert into taxonomy_terms (taxonomy_id, value, code, sort_order)
select t.id, v.value, v.code, v.sort_order
  from taxonomies t,
       (values ('Enrolled', 'enrolled', 10), ('Diploma', 'diploma', 20), ('Bachelor''s degree', 'bachelor', 30),
               ('Master''s degree', 'master', 40), ('Doctoral degree', 'doctoral', 50)) as v(value, code, sort_order)
 where t.kind = 'qualification_level'
on conflict (taxonomy_id, value) do nothing;

alter table individual_scholar_programme
  add column if not exists qualification_term_id uuid references taxonomy_terms(id) on delete restrict;
create index if not exists idx_individual_scholar_programme_qualification
  on individual_scholar_programme(qualification_term_id);

create or replace function public.individual_scholar_programme_qualification_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if new.qualification_term_id is not null and not exists (
    select 1 from taxonomy_terms tt join taxonomies t on t.id = tt.taxonomy_id
     where tt.id = new.qualification_term_id and t.kind = 'qualification_level') then
    raise exception 'individual_scholar_programme: the qualification must be a qualification_level term';
  end if;
  return new;
end;
$$;

drop trigger if exists individual_scholar_programme_qualification_guard on individual_scholar_programme;
create trigger individual_scholar_programme_qualification_guard
  before insert or update of qualification_term_id on individual_scholar_programme
  for each row execute function public.individual_scholar_programme_qualification_guard();

-- ---------- 2. THE PROGRAMME OVERLAY ON CATALOGUE ENTRIES ----------

alter table competency_catalogue_entry add column if not exists requirement text not null default 'required';
alter table competency_catalogue_entry add column if not exists expected_level_id uuid references scoring_levels(id) on delete restrict;

alter table competency_catalogue_entry drop constraint if exists competency_catalogue_entry_requirement_check;
alter table competency_catalogue_entry add constraint competency_catalogue_entry_requirement_check
  check (requirement in ('required', 'recommended', 'optional'));

-- ---------- 3. CCHU ASSESSMENT COMPONENTS ----------

create table if not exists competency_assessment_component (
  code         text primary key,
  label        text not null,
  description  text,
  sort_order   int not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table competency_assessment_component drop constraint if exists competency_assessment_component_check;
alter table competency_assessment_component add constraint competency_assessment_component_check
  check (code ~ '^[a-z][a-z0-9_]{2,40}$'
     and char_length(btrim(label)) between 2 and 80
     and (description is null or char_length(description) <= 500));

alter table competency_assessment_component enable row level security;

insert into competency_assessment_component (code, label, description, sort_order) values
  ('clinical_skills', 'Clinical Skills', 'Performance of the clinical skill, observed or simulated.', 10),
  ('knowledge', 'Knowledge', 'The underpinning knowledge, examined.', 20),
  ('knowledge_application', 'Knowledge Application', 'Applying knowledge to a clinical situation: clinical reasoning and judgement.', 30)
on conflict (code) do nothing;

create table if not exists competency_catalogue_entry_component (
  entry_id            uuid not null references competency_catalogue_entry(id) on delete cascade,
  component_code      text not null references competency_assessment_component(code) on delete restrict,
  pass_level_id       uuid references scoring_levels(id) on delete restrict,
  is_mandatory        boolean not null default true,
  is_safety_critical  boolean not null default false,
  weight              numeric(5,2),
  sort_order          int not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  primary key (entry_id, component_code)
);

alter table competency_catalogue_entry_component drop constraint if exists competency_catalogue_entry_component_check;
alter table competency_catalogue_entry_component add constraint competency_catalogue_entry_component_check
  check ((not is_safety_critical or is_mandatory)
     and (weight is null or (weight > 0 and weight <= 100)));

create index if not exists idx_competency_catalogue_entry_component_code
  on competency_catalogue_entry_component(component_code);

alter table competency_catalogue_entry_component enable row level security;

create or replace function public.competency_catalogue_entry_component_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_entry uuid;
  v_status text;
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  v_entry := case when tg_op = 'DELETE' then old.entry_id else new.entry_id end;
  if tg_op = 'UPDATE' and (new.entry_id is distinct from old.entry_id or new.component_code is distinct from old.component_code) then
    raise exception 'competency_catalogue_entry_component: a component requirement cannot move to another entry or component';
  end if;
  select f.pub_status into v_status
    from competency_catalogue_entry e join frameworks f on f.id = e.catalogue_id
   where e.id = v_entry;
  if coalesce(v_status, 'draft') <> 'draft' then
    raise exception 'competency_catalogue_entry_component: the catalogue is %, so its component requirements are frozen. Start a new draft version', v_status;
  end if;
  if tg_op <> 'DELETE' then
    new.updated_at := now();
    return new;
  end if;
  return old;
end;
$$;

drop trigger if exists competency_catalogue_entry_component_guard on competency_catalogue_entry_component;
create trigger competency_catalogue_entry_component_guard
  before insert or update or delete on competency_catalogue_entry_component
  for each row execute function public.competency_catalogue_entry_component_guard();

-- ---------- 4. DACUM 0-6, BESIDE THE DEFAULT BENNER SCALE ----------

insert into scoring_scales (name, description, min_score, max_score, is_default)
select 'DACUM 0-6', 'DACUM achievement scale for programme competencies (CFCA-STUDIO-P1). Level wording is editable.', 0, 6, false
 where not exists (select 1 from scoring_scales where name = 'DACUM 0-6');

insert into scoring_levels (scale_id, score, label, description, color, is_passing)
select s.id, v.score, v.label, v.description, v.color, v.is_passing
  from scoring_scales s,
       (values
         (0, 'Not yet demonstrated', 'No exposure to the competency, or not yet able to perform any part of it.', '#9ca3af', false),
         (1, 'Performs parts with considerable assistance', 'Can perform some parts satisfactorily, but needs considerable assistance and supervision.', '#f97316', false),
         (2, 'Performs with periodic assistance', 'Can perform it satisfactorily, but needs periodic assistance and supervision.', '#eab308', false),
         (3, 'Performs without assistance', 'Can perform it satisfactorily without assistance or supervision.', '#14b8a6', true),
         (4, 'Performs to a high standard', 'Can perform it without assistance, with more than acceptable speed and quality.', '#0d9488', true),
         (5, 'Performs with initiative and adaptability', 'Can perform it with initiative and adapt it to problem situations.', '#3b82f6', true),
         (6, 'Leads and guides others', 'Can perform it with initiative and adaptability, and can lead others in performing it.', '#8b5cf6', true)
       ) as v(score, label, description, color, is_passing)
 where s.name = 'DACUM 0-6'
on conflict (scale_id, score) do nothing;

-- ---------- 5. COMPETENCY STAGES AND THE VERSIONED SCALE-TO-STAGE MAPPING ----------

create table if not exists competency_stage (
  code         text primary key,
  label        text not null,
  description  text,
  sort_order   int not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table competency_stage drop constraint if exists competency_stage_check;
alter table competency_stage add constraint competency_stage_check
  check (code ~ '^[a-z][a-z0-9_]{2,40}$'
     and char_length(btrim(label)) between 2 and 80
     and (description is null or char_length(description) <= 500));

alter table competency_stage enable row level security;

insert into competency_stage (code, label, description, sort_order) values
  ('unstaged', 'Unstaged', 'Not yet at a competency stage.', 0),
  ('novice', 'Novice', null, 10),
  ('advanced_beginner', 'Advanced Beginner', null, 20),
  ('competent', 'Competent', null, 30),
  ('proficient', 'Proficient', null, 40),
  ('expert', 'Expert', null, 50)
on conflict (code) do nothing;

create table if not exists competency_stage_mapping (
  id                  uuid primary key default gen_random_uuid(),
  scale_id            uuid not null references scoring_scales(id) on delete restrict,
  version             int not null,
  status              text not null default 'draft',
  note                text,
  content_hash        text,
  approval_reference  text,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  published_by        uuid,
  published_at        timestamptz,
  retired_at          timestamptz,
  unique (scale_id, version)
);

alter table competency_stage_mapping drop constraint if exists competency_stage_mapping_check;
alter table competency_stage_mapping add constraint competency_stage_mapping_check
  check (version >= 1
     and status in ('draft', 'published', 'retired')
     and (note is null or char_length(note) <= 500)
     and (approval_reference is null or char_length(approval_reference) <= 300));

alter table competency_stage_mapping enable row level security;

create table if not exists competency_stage_mapping_band (
  mapping_id  uuid not null references competency_stage_mapping(id) on delete cascade,
  level_id    uuid not null references scoring_levels(id) on delete restrict,
  stage_code  text not null references competency_stage(code) on delete restrict,
  primary key (mapping_id, level_id)
);

alter table competency_stage_mapping_band enable row level security;

create or replace function public.competency_stage_mapping_band_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_mapping uuid;
  v_status text;
  v_scale uuid;
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  v_mapping := case when tg_op = 'DELETE' then old.mapping_id else new.mapping_id end;
  select m.status, m.scale_id into v_status, v_scale from competency_stage_mapping m where m.id = v_mapping;
  if coalesce(v_status, 'draft') <> 'draft' then
    raise exception 'competency_stage_mapping_band: mapping % is %, so its bands are frozen. Draft a new version', v_mapping, v_status;
  end if;
  if tg_op = 'UPDATE' and new.mapping_id is distinct from old.mapping_id then
    raise exception 'competency_stage_mapping_band: a band cannot move to another mapping';
  end if;
  if tg_op <> 'DELETE' then
    if not exists (select 1 from scoring_levels l where l.id = new.level_id and l.scale_id = v_scale) then
      raise exception 'competency_stage_mapping_band: the level must belong to the scale of the mapping';
    end if;
    return new;
  end if;
  return old;
end;
$$;

drop trigger if exists competency_stage_mapping_band_guard on competency_stage_mapping_band;
create trigger competency_stage_mapping_band_guard
  before insert or update or delete on competency_stage_mapping_band
  for each row execute function public.competency_stage_mapping_band_guard();

create or replace function public.competency_stage_mapping_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_unmapped int;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 or old.status = 'draft' then
      return old;
    end if;
    raise exception 'competency_stage_mapping: a % mapping is kept for the record and cannot be deleted', old.status;
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'competency_stage_mapping: a mapping starts as a draft';
    end if;
    new.content_hash := null;
    new.published_by := null;
    new.published_at := null;
    new.retired_at := null;
    return new;
  end if;
  if new.scale_id is distinct from old.scale_id or new.version is distinct from old.version
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'competency_stage_mapping: the scale, version and author of a mapping never change';
  end if;
  if old.status = 'draft' and new.status = 'draft' then
    new.content_hash := null;
    new.published_by := null;
    new.published_at := null;
    new.retired_at := null;
    return new;
  end if;
  if old.status = 'draft' and new.status = 'published' then
    if new.published_by is null and new.approval_reference is null then
      raise exception 'competency_stage_mapping: publishing needs a publisher or a recorded approval';
    end if;
    if new.published_by is not null and new.published_by = old.created_by then
      raise exception 'competency_stage_mapping: the person who drafted a mapping cannot publish it';
    end if;
    select count(*) into v_unmapped from scoring_levels l
     where l.scale_id = old.scale_id
       and not exists (select 1 from competency_stage_mapping_band b where b.mapping_id = old.id and b.level_id = l.id);
    if v_unmapped > 0 then
      raise exception 'competency_stage_mapping: % level(s) of the scale have no stage, so the mapping cannot be published', v_unmapped;
    end if;
    new.content_hash := md5(coalesce((
      select string_agg(l.score::text || ':' || b.stage_code, ',' order by l.score)
        from competency_stage_mapping_band b join scoring_levels l on l.id = b.level_id
       where b.mapping_id = old.id), ''));
    new.published_at := now();
    new.retired_at := null;
    update competency_stage_mapping set status = 'retired', retired_at = now()
     where scale_id = old.scale_id and status = 'published' and id <> old.id;
    return new;
  end if;
  if old.status = 'published' and new.status = 'retired'
     and new.content_hash is not distinct from old.content_hash
     and new.published_by is not distinct from old.published_by
     and new.published_at is not distinct from old.published_at
     and new.approval_reference is not distinct from old.approval_reference
     and new.note is not distinct from old.note then
    new.retired_at := coalesce(new.retired_at, now());
    return new;
  end if;
  raise exception 'competency_stage_mapping: a % mapping cannot become % or be edited. Draft a new version', old.status, new.status;
end;
$$;

drop trigger if exists competency_stage_mapping_guard on competency_stage_mapping;
create trigger competency_stage_mapping_guard
  before insert or update or delete on competency_stage_mapping
  for each row execute function public.competency_stage_mapping_guard();

-- Seed: DACUM version 1, as the owner approved it in CFCA-STUDIO-P1. Drafted, banded, then published on
-- that recorded approval. Skipped entirely when DACUM already has any mapping.
insert into competency_stage_mapping (scale_id, version, status, note)
select s.id, 1, 'draft', 'DACUM 0-6 to Competen stages, as approved by the owner in CFCA-STUDIO-P1.'
  from scoring_scales s
 where s.name = 'DACUM 0-6'
   and not exists (select 1 from competency_stage_mapping m where m.scale_id = s.id);

insert into competency_stage_mapping_band (mapping_id, level_id, stage_code)
select m.id, l.id, v.stage_code
  from competency_stage_mapping m
  join scoring_scales s on s.id = m.scale_id and s.name = 'DACUM 0-6'
  join scoring_levels l on l.scale_id = s.id
  join (values (0, 'unstaged'), (1, 'novice'), (2, 'novice'), (3, 'advanced_beginner'), (4, 'competent'),
               (5, 'proficient'), (6, 'expert')) as v(score, stage_code) on v.score = l.score
 where m.version = 1 and m.status = 'draft'
on conflict (mapping_id, level_id) do nothing;

update competency_stage_mapping m
   set status = 'published', approval_reference = 'Owner instruction CFCA-STUDIO-P1, 29 Oct 2026'
  from scoring_scales s
 where s.id = m.scale_id and s.name = 'DACUM 0-6' and m.version = 1 and m.status = 'draft';

-- ---------- 6. NUR-FOUND, A DRAFT CATALOGUE NAMING THE CORE NURSING COMPETENCIES ----------

insert into frameworks (name, code, library, description, is_active, pub_status, hospital_id, competency_layer, profession_term_id)
select 'Competen Nursing Foundation', 'NUR-FOUND', 'core',
       'The nursing foundation every nursing programme builds on. It names the shared Core Nursing competencies and copies none. Draft until clinical review and independent publication.',
       true, 'draft', null, 'profession', nursing.id
  from (select tt.id from taxonomy_terms tt join taxonomies t on t.id = tt.taxonomy_id
         where t.kind = 'profession' and tt.value = 'Nursing' order by tt.created_at limit 1) as nursing
 where not exists (select 1 from frameworks f where f.code = 'NUR-FOUND' and f.hospital_id is null);

insert into competency_catalogue_entry (catalogue_id, competency_id, content_status, sort_order, requirement)
select nf.id, c.id, 'unreviewed',
       row_number() over (order by d.sort_order, d.name, c.sort_order, c.name)::int, 'required'
  from frameworks nf
  join frameworks core on core.name = 'Core Nursing' and core.hospital_id is null
  join framework_domains d on d.framework_id = core.id
  join framework_competencies c on c.domain_id = d.id
 where nf.code = 'NUR-FOUND' and nf.hospital_id is null and nf.pub_status = 'draft'
on conflict (catalogue_id, competency_id) do nothing;

-- ---------- VERIFICATION ----------

select 'qualification_terms' as item, count(*)::text as value
  from taxonomy_terms tt join taxonomies t on t.id = tt.taxonomy_id where t.kind = 'qualification_level'
union all select 'dacum_levels', count(*)::text
  from scoring_levels l join scoring_scales s on s.id = l.scale_id where s.name = 'DACUM 0-6'
union all select 'benner_still_default', (select is_default::text from scoring_scales where id = '00000000-0000-0000-0000-000000000001')
union all select 'stages', count(*)::text from competency_stage
union all select 'dacum_mapping_v1', coalesce((select m.status || ' ' || m.content_hash from competency_stage_mapping m
  join scoring_scales s on s.id = m.scale_id where s.name = 'DACUM 0-6' and m.version = 1), 'missing')
union all select 'components', count(*)::text from competency_assessment_component
union all select 'nur_found', coalesce((select pub_status from frameworks where code = 'NUR-FOUND' and hospital_id is null), 'missing')
union all select 'nur_found_entries', count(*)::text
  from competency_catalogue_entry e join frameworks f on f.id = e.catalogue_id where f.code = 'NUR-FOUND'
union all select 'new_tables_rls_no_policy', count(*)::text
  from pg_class c where c.relname in ('competency_assessment_component', 'competency_catalogue_entry_component',
    'competency_stage', 'competency_stage_mapping', 'competency_stage_mapping_band')
   and c.relrowsecurity and not exists (select 1 from pg_policies p where p.tablename = c.relname);

notify pgrst, 'reload schema';
