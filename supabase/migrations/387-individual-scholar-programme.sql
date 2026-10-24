-- ====================================================================================================
-- MIGRATION 387: COMPETEN SCHOLAR -- PROGRAMMES, AS CONFIGURATION (WHICH COMPETENCIES A STUDENT LEARNS AGAINST)
--
-- COMPETEN-SCHOLAR-01, S2 (owner GO 2026-10-23): "Scholar is competency-driven ... first target nursing
-- students in Uganda, with a profession-agnostic architecture ... a new profession or competency arrives
-- by configuration, not by a rebuild." Build record: docs/COMPETEN-SCHOLAR-01-competency-learning.md.
--
-- APPLY ON STAGING ONLY. NOT AUTHORISED FOR PRODUCTION. It creates three new tables. It alters no existing
-- table, row, policy or constraint. It depends on profiles (001) and frameworks (003). It does not depend
-- on 372 or 375 or on 388. Re-running it is a no-op.
--
-- ----------------------------------------------------------------------------------------------------
-- THE SHAPE.
--
--   individual_scholar_programme            One study programme: a profession, optionally a country and a
--                                           level (for example nursing, UG, diploma). Configuration rows.
--   individual_scholar_programme_framework  Which shared frameworks a programme learns against, and in
--                                           which LAYER (foundational, profession, specialty). A typed
--                                           foreign key to frameworks(id): a programme cannot name a
--                                           framework that does not exist.
--   individual_scholar_learner              The programme one person studies. Optional -- Scholar works
--                                           without it, and simply proposes no competencies.
--
-- A NEW PROFESSION IS ROWS, NOT CODE. Adding midwifery is one programme row and its framework rows. No
-- code path names a profession. The competency CATALOGUE is not here: this file points at the existing
-- frameworks/framework_competencies (never copied), and only shared, published, active frameworks are ever
-- offered to a student (the read side enforces it, as Competen Professional does).
--
-- ----------------------------------------------------------------------------------------------------
-- RLS. Programme configuration is not personal: RLS is on with NO policy, so only the service role reads
-- it (behind requireIndividualContext). The learner row is personal: own-row select only (owner ruling
-- D6). No insert, update or delete policy anywhere -- writes are service-role only.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. No function, no do-block. No partial unique
-- index. notify pgrst last.
-- ====================================================================================================


create table if not exists individual_scholar_programme (
  code        text primary key,
  label       text not null,
  profession  text not null,
  country     text,
  level       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table individual_scholar_programme drop constraint if exists individual_scholar_programme_code_check;
alter table individual_scholar_programme add constraint individual_scholar_programme_code_check
  check (code ~ '^[a-z0-9][a-z0-9-]{1,62}$');

alter table individual_scholar_programme drop constraint if exists individual_scholar_programme_text_check;
alter table individual_scholar_programme add constraint individual_scholar_programme_text_check
  check (char_length(btrim(label)) between 1 and 120
     and char_length(btrim(profession)) between 1 and 80
     and (country is null or country ~ '^[A-Z]{2}$')
     and (level is null or char_length(btrim(level)) between 1 and 80));

alter table individual_scholar_programme enable row level security;

comment on table individual_scholar_programme is
  'COMPETEN-SCHOLAR-01 S2. A study programme (profession, optional country and level) that Scholar maps a student''s own material against. Configuration: a new profession is a new row, never code. Service-role only.';


create table if not exists individual_scholar_programme_framework (
  programme_code  text not null references individual_scholar_programme(code) on delete cascade,
  framework_id    uuid not null references frameworks(id) on delete cascade,
  layer           text not null,
  sort_order      integer not null default 0,
  primary key (programme_code, framework_id)
);

alter table individual_scholar_programme_framework drop constraint if exists individual_scholar_programme_framework_layer_check;
alter table individual_scholar_programme_framework add constraint individual_scholar_programme_framework_layer_check
  check (layer in ('foundational', 'profession', 'specialty'));

create index if not exists idx_individual_scholar_programme_framework_framework
  on individual_scholar_programme_framework(framework_id);

alter table individual_scholar_programme_framework enable row level security;

comment on table individual_scholar_programme_framework is
  'COMPETEN-SCHOLAR-01 S2. Which shared frameworks a programme learns against, and in which layer. A typed reference to frameworks(id), never a copy of the catalogue. Only shared, published, active frameworks are offered to a student (enforced on read). Service-role only.';


create table if not exists individual_scholar_learner (
  user_id         uuid primary key references profiles(id) on delete cascade,
  programme_code  text not null references individual_scholar_programme(code),
  chosen_at       timestamptz not null default now()
);

create index if not exists idx_individual_scholar_learner_programme
  on individual_scholar_learner(programme_code);

alter table individual_scholar_learner enable row level security;

drop policy if exists individual_scholar_learner_read_own on individual_scholar_learner;
create policy individual_scholar_learner_read_own on individual_scholar_learner
  for select using (auth.uid() = user_id);

comment on table individual_scholar_learner is
  'COMPETEN-SCHOLAR-01 S2. The programme one person studies, chosen by them. Optional: without it Scholar proposes no competencies. Own-row read, service-role write.';

notify pgrst, 'reload schema';
