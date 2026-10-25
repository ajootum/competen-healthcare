-- ====================================================================================================
-- MIGRATION 520: COMPETEN PROFESSIONAL -- MY COMPETENCIES, SELF-ASSESSMENT AND EVIDENCE MAPPING (STAGE 5)
--
-- !! APPLY THIS FILE WHOLE. It contains plpgsql trigger functions. A runner that splits on semicolons
-- !! would cut a function body in half. Paste the entire file into the SQL editor and run it once.
--
-- COMPETEN-PROFESSIONAL-COMPETENCY-01, Professional Stage 5, C1 C2 C3 C4 C6 and the Passport selection.
-- Owner GO (development and staging authorised). Production only on separate owner GO.
-- Build record: docs/COMPETEN-PROFESSIONAL-COMPETENCY-01-stage5.md. C5 (verification) is migrations 510-519.
--
-- DEPENDS ON 373 (cpd, evidence, share), 393 (the (id, user_id) indexes), 450 (profile item), 470
-- (reflection), 462 (learning_record), 375 (Scholar Passport item), 007 (scoring scales and levels), 003.
--
-- ----------------------------------------------------------------------------------------------------
-- NOT A SECOND COMPETENCY FRAMEWORK AND NOT A SECOND EVIDENCE ENGINE. The CFCA catalogues stay the frameworks,
-- scoring_levels stays the proficiency scale, and the records of what happened stay where they are (CPD,
-- learning record, evidence, profile item, reflection, Scholar Passport item). This file adds:
--
--   1. 373 evidence gains an evidence type, so observations, mentor feedback, teaching, research, quality
--      improvement and assessments are recorded in the SAME evidence record, not a new one.
--   2. My competencies: the competencies a person chose to develop, from an offered catalogue (with the
--      framework version) or in their own words when no catalogue is offered. History by trigger.
--   3. Self-assessments: APPEND-ONLY, always and only self-reported (a CHECK makes anything else
--      unrepresentable). A reassessment is a new row, so earlier ones are never lost.
--   4. Evidence links at learning-outcome level: many to many, each naming exactly ONE existing record by
--      composite key, the outcome, the framework version, the kind of support (knowledge, application,
--      practical performance, experience, verification), and who established it. Unlinked once, never
--      rewritten or deleted. An AI suggestion becomes a link only when the person accepts it.
--   5. The Passport selection: which competencies, and which parts of them, ONE Passport link carries.
--
-- NO VERIFIED COLUMN, no score of competence, no scope or employer column. Verification is C5 alone.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique
-- index. experience_code NOT NULL with no default on new person tables. RLS on, own-row SELECT only, no write
-- policy. Append-only trails keep the cascade path (pg_trigger_depth() > 1). notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/COMPETEN-PROFESSIONAL-COMPETENCY-01/ROLLBACK-520.sql
-- ====================================================================================================


-- ---- 1. ONE EVIDENCE RECORD, TYPED ---------------------------------------------------------------------

alter table individual_professional_evidence add column if not exists evidence_type_code text;
alter table individual_professional_evidence add column if not exists evidence_type_label text;
alter table individual_professional_evidence add column if not exists author_name text;

alter table individual_professional_evidence drop constraint if exists individual_professional_evidence_stage5_shape;
alter table individual_professional_evidence add constraint individual_professional_evidence_stage5_shape check (
  (evidence_type_code is null or (evidence_type_code ~ '^[a-z0-9][a-z0-9-]{0,62}$' and evidence_type_label is not null))
  and char_length(coalesce(evidence_type_label, '')) <= 160
  and char_length(coalesce(author_name, '')) <= 160
);

-- The keys the links below name. Each exists already where its migration is applied, so these do nothing there.
create unique index if not exists ux_individual_professional_cpd_id_user on individual_professional_cpd(id, user_id);
create unique index if not exists ux_individual_professional_evidence_id_user on individual_professional_evidence(id, user_id);
create unique index if not exists ux_individual_scholar_passport_item_id_user on individual_scholar_passport_item(id, user_id);


-- ---- 2. ONE REFUSAL FOR THE APPEND-ONLY RECORDS OF THIS FILE --------------------------------------------

create or replace function public.individual_professional_stage5_append_only() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception '% is append-only: add a new record instead', tg_table_name;
end
$$;


-- ---- 3. MY COMPETENCIES (C1) ------------------------------------------------------------------------------

create table if not exists individual_professional_my_competency (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  experience_code text not null,
  kind text not null,
  framework_id uuid references frameworks(id) on delete restrict,
  framework_competency_id uuid references framework_competencies(id) on delete restrict,
  framework_version text,
  title text not null,
  description text,
  category_code text,
  category_label text,
  interest boolean not null default false,
  interest_note text,
  added_at timestamptz not null default now(),
  removed_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_individual_professional_my_competency_id_user
  on individual_professional_my_competency(id, user_id);
-- One entry per catalogue competency per person. Personal entries have no competency id, and nulls are distinct.
create unique index if not exists ux_individual_professional_my_competency_competency
  on individual_professional_my_competency(user_id, framework_competency_id);
create index if not exists idx_individual_professional_my_competency_user
  on individual_professional_my_competency(user_id, removed_at, added_at desc);

alter table individual_professional_my_competency drop constraint if exists individual_professional_my_competency_shape;
alter table individual_professional_my_competency add constraint individual_professional_my_competency_shape check (
  experience_code in ('scholar', 'professional')
  and kind in ('catalogue', 'personal')
  and ((kind = 'catalogue') = (framework_id is not null and framework_competency_id is not null))
  and (kind = 'catalogue' or framework_version is null)
  and char_length(btrim(title)) between 3 and 200
  and char_length(coalesce(description, '')) <= 2000
  and (category_code is null or (category_code ~ '^[a-z0-9][a-z0-9-]{0,62}$' and category_label is not null))
  and char_length(coalesce(category_label, '')) <= 160
  and char_length(coalesce(framework_version, '')) <= 40
  and char_length(coalesce(interest_note, '')) <= 1000
  and (removed_at is null or removed_at >= added_at)
);

alter table individual_professional_my_competency enable row level security;
drop policy if exists individual_professional_my_competency_read_own on individual_professional_my_competency;
create policy individual_professional_my_competency_read_own on individual_professional_my_competency
  for select using (auth.uid() = user_id);

comment on table individual_professional_my_competency is
  'COMPETEN-PROFESSIONAL-COMPETENCY-01 C1. A competency the person chose to develop: from an offered catalogue (with the framework version) or in their own words. Never a statement of competence.';

create table if not exists individual_professional_my_competency_history (
  id uuid primary key default gen_random_uuid(),
  my_competency_id uuid not null,
  user_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  framework_version text,
  category_label text,
  interest boolean not null,
  removed boolean not null,
  recorded_at timestamptz not null default now()
);
alter table individual_professional_my_competency_history drop constraint if exists individual_professional_my_competency_history_fk;
alter table individual_professional_my_competency_history add constraint individual_professional_my_competency_history_fk
  foreign key (my_competency_id, user_id) references individual_professional_my_competency(id, user_id) on delete cascade;
create index if not exists idx_individual_professional_my_competency_history
  on individual_professional_my_competency_history(my_competency_id, recorded_at desc);

alter table individual_professional_my_competency_history enable row level security;
drop policy if exists individual_professional_my_competency_history_read_own on individual_professional_my_competency_history;
create policy individual_professional_my_competency_history_read_own on individual_professional_my_competency_history
  for select using (auth.uid() = user_id);

create or replace function public.individual_professional_my_competency_history_write() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (old.title, old.framework_version, old.category_label, old.interest, old.removed_at is not null)
     is not distinct from (new.title, new.framework_version, new.category_label, new.interest, new.removed_at is not null) then
    return null;
  end if;
  insert into individual_professional_my_competency_history (my_competency_id, user_id, title, framework_version, category_label, interest, removed)
  values (new.id, new.user_id, new.title, new.framework_version, new.category_label, new.interest, new.removed_at is not null);
  return null;
end
$$;

drop trigger if exists trg_individual_professional_my_competency_history on individual_professional_my_competency;
create trigger trg_individual_professional_my_competency_history
  after insert or update on individual_professional_my_competency
  for each row execute function individual_professional_my_competency_history_write();

drop trigger if exists trg_individual_professional_my_competency_history_append_only on individual_professional_my_competency_history;
create trigger trg_individual_professional_my_competency_history_append_only
  before update or delete on individual_professional_my_competency_history
  for each row execute function individual_professional_stage5_append_only();


-- ---- 4. SELF-ASSESSMENTS (C2): APPEND-ONLY, SELF-REPORTED BY CONSTRUCTION -------------------------------

create table if not exists individual_professional_self_assessment (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  my_competency_id uuid not null,
  learning_outcome text,
  framework_version text,
  scale_id uuid references scoring_scales(id) on delete set null,
  level_id uuid references scoring_levels(id) on delete set null,
  scale_label text,
  level_score integer,
  level_label text not null,
  confidence_code text,
  confidence_label text,
  reflection text,
  development_interest boolean not null default false,
  basis text not null default 'self_reported',
  assessed_at timestamptz not null default now()
);
alter table individual_professional_self_assessment drop constraint if exists individual_professional_self_assessment_competency_fk;
alter table individual_professional_self_assessment add constraint individual_professional_self_assessment_competency_fk
  foreign key (my_competency_id, user_id) references individual_professional_my_competency(id, user_id) on delete cascade;
create index if not exists idx_individual_professional_self_assessment_competency
  on individual_professional_self_assessment(my_competency_id, assessed_at desc);

alter table individual_professional_self_assessment drop constraint if exists individual_professional_self_assessment_shape;
alter table individual_professional_self_assessment add constraint individual_professional_self_assessment_shape check (
  basis = 'self_reported'
  and char_length(btrim(level_label)) between 1 and 160
  and char_length(coalesce(scale_label, '')) <= 160
  and char_length(coalesce(learning_outcome, '')) <= 1000
  and char_length(coalesce(framework_version, '')) <= 40
  and (confidence_code is null or (confidence_code ~ '^[a-z0-9][a-z0-9-]{0,62}$' and confidence_label is not null))
  and char_length(coalesce(confidence_label, '')) <= 160
  and char_length(coalesce(reflection, '')) <= 5000
);

alter table individual_professional_self_assessment enable row level security;
drop policy if exists individual_professional_self_assessment_read_own on individual_professional_self_assessment;
create policy individual_professional_self_assessment_read_own on individual_professional_self_assessment
  for select using (auth.uid() = user_id);

drop trigger if exists trg_individual_professional_self_assessment_append_only on individual_professional_self_assessment;
create trigger trg_individual_professional_self_assessment_append_only
  before update or delete on individual_professional_self_assessment
  for each row execute function individual_professional_stage5_append_only();

comment on table individual_professional_self_assessment is
  'COMPETEN-PROFESSIONAL-COMPETENCY-01 C2. A self-assessment: self-reported by construction, append-only, never reduced or rejected for want of evidence, never verification.';


-- ---- 5. EVIDENCE LINKS AT LEARNING-OUTCOME LEVEL (C4) ---------------------------------------------------

create table if not exists individual_professional_competency_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  my_competency_id uuid not null,
  cpd_id uuid,
  learning_record_id uuid,
  evidence_id uuid,
  profile_item_id uuid,
  reflection_id uuid,
  study_achievement_id uuid,
  learning_outcome text,
  framework_version text,
  relation_code text not null,
  relation_label text not null,
  source text not null default 'person',
  model text,
  prompt_version text,
  linked_at timestamptz not null default now(),
  unlinked_at timestamptz
);

create unique index if not exists ux_individual_professional_competency_evidence_id_user
  on individual_professional_competency_evidence(id, user_id);
create index if not exists idx_individual_professional_competency_evidence_competency
  on individual_professional_competency_evidence(my_competency_id, linked_at);

alter table individual_professional_competency_evidence drop constraint if exists individual_professional_competency_evidence_competency_fk;
alter table individual_professional_competency_evidence add constraint individual_professional_competency_evidence_competency_fk
  foreign key (my_competency_id, user_id) references individual_professional_my_competency(id, user_id) on delete cascade;
alter table individual_professional_competency_evidence drop constraint if exists individual_professional_competency_evidence_cpd_fk;
alter table individual_professional_competency_evidence add constraint individual_professional_competency_evidence_cpd_fk
  foreign key (cpd_id, user_id) references individual_professional_cpd(id, user_id) on delete cascade;
alter table individual_professional_competency_evidence drop constraint if exists individual_professional_competency_evidence_record_fk;
alter table individual_professional_competency_evidence add constraint individual_professional_competency_evidence_record_fk
  foreign key (learning_record_id, user_id) references learning_record(id, user_id) on delete cascade;
alter table individual_professional_competency_evidence drop constraint if exists individual_professional_competency_evidence_evidence_fk;
alter table individual_professional_competency_evidence add constraint individual_professional_competency_evidence_evidence_fk
  foreign key (evidence_id, user_id) references individual_professional_evidence(id, user_id) on delete cascade;
alter table individual_professional_competency_evidence drop constraint if exists individual_professional_competency_evidence_item_fk;
alter table individual_professional_competency_evidence add constraint individual_professional_competency_evidence_item_fk
  foreign key (profile_item_id, user_id) references individual_professional_profile_item(id, user_id) on delete cascade;
alter table individual_professional_competency_evidence drop constraint if exists individual_professional_competency_evidence_reflection_fk;
alter table individual_professional_competency_evidence add constraint individual_professional_competency_evidence_reflection_fk
  foreign key (reflection_id, user_id) references individual_professional_reflection(id, user_id) on delete cascade;
alter table individual_professional_competency_evidence drop constraint if exists individual_professional_competency_evidence_study_fk;
alter table individual_professional_competency_evidence add constraint individual_professional_competency_evidence_study_fk
  foreign key (study_achievement_id, user_id) references individual_scholar_passport_item(id, user_id) on delete cascade;

alter table individual_professional_competency_evidence drop constraint if exists individual_professional_competency_evidence_shape;
alter table individual_professional_competency_evidence add constraint individual_professional_competency_evidence_shape check (
  ((cpd_id is not null)::int + (learning_record_id is not null)::int + (evidence_id is not null)::int
    + (profile_item_id is not null)::int + (reflection_id is not null)::int + (study_achievement_id is not null)::int) = 1
  and relation_code ~ '^[a-z0-9][a-z0-9-]{0,62}$'
  and char_length(btrim(relation_label)) between 1 and 160
  and char_length(coalesce(learning_outcome, '')) <= 1000
  and char_length(coalesce(framework_version, '')) <= 40
  and source in ('person', 'ai')
  and ((source = 'ai') = (model is not null and prompt_version is not null))
  and (unlinked_at is null or unlinked_at >= linked_at)
);

alter table individual_professional_competency_evidence enable row level security;
drop policy if exists individual_professional_competency_evidence_read_own on individual_professional_competency_evidence;
create policy individual_professional_competency_evidence_read_own on individual_professional_competency_evidence
  for select using (auth.uid() = user_id);

-- A link is never rewritten: unlink once and keep it as history. Delete only by cascade.
create or replace function public.individual_professional_competency_evidence_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'individual_professional_competency_evidence keeps its history: unlink instead of deleting';
  end if;
  if old.unlinked_at is null and new.unlinked_at is not null
     and (to_jsonb(new) - 'unlinked_at') = (to_jsonb(old) - 'unlinked_at') then
    return new;
  end if;
  raise exception 'individual_professional_competency_evidence keeps its history: a link can only be unlinked, once';
end
$$;

drop trigger if exists trg_individual_professional_competency_evidence_guard on individual_professional_competency_evidence;
create trigger trg_individual_professional_competency_evidence_guard
  before update or delete on individual_professional_competency_evidence
  for each row execute function individual_professional_competency_evidence_guard();

comment on table individual_professional_competency_evidence is
  'COMPETEN-PROFESSIONAL-COMPETENCY-01 C4. One existing record supporting one competency or learning outcome, with the framework version and the kind of support. A reference, never a copy. Supporting evidence is not verification.';


-- ---- 6. THE PASSPORT SELECTION (S11) ----------------------------------------------------------------------

create table if not exists individual_professional_share_competency (
  share_token_id uuid not null,
  user_id uuid not null references profiles(id) on delete cascade,
  my_competency_id uuid not null,
  include_self_assessment boolean not null default false,
  include_evidence boolean not null default false,
  include_assessed_outcomes boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (share_token_id, my_competency_id)
);
alter table individual_professional_share_competency drop constraint if exists individual_professional_share_competency_share_fk;
alter table individual_professional_share_competency add constraint individual_professional_share_competency_share_fk
  foreign key (share_token_id, user_id) references individual_professional_share(share_token_id, user_id) on delete cascade;
alter table individual_professional_share_competency drop constraint if exists individual_professional_share_competency_competency_fk;
alter table individual_professional_share_competency add constraint individual_professional_share_competency_competency_fk
  foreign key (my_competency_id, user_id) references individual_professional_my_competency(id, user_id) on delete cascade;
create index if not exists idx_individual_professional_share_competency_user
  on individual_professional_share_competency(user_id);

alter table individual_professional_share_competency enable row level security;
drop policy if exists individual_professional_share_competency_read_own on individual_professional_share_competency;
create policy individual_professional_share_competency_read_own on individual_professional_share_competency
  for select using (auth.uid() = user_id);

comment on table individual_professional_share_competency is
  'COMPETEN-PROFESSIONAL-COMPETENCY-01 S11. The competencies, and which parts of them, a person chose to carry on one Professional Passport link. None by default. Reflections have no path here.';


notify pgrst, 'reload schema';
