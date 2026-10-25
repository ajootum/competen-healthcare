-- ====================================================================================================
-- MIGRATION 550: COMPETEN PROFESSIONAL -- PROGRESS, CAREER INTELLIGENCE AND DOCUMENT STUDIO (STAGE 8)
--
-- !! APPLY THIS FILE WHOLE. It contains a plpgsql trigger function. A runner that splits on semicolons
-- !! would cut a function body in half. Paste the entire file into the SQL editor and run it once.
--
-- COMPETEN-PROFESSIONAL-PROGRESS-01, Professional Stage 8, owner GO (development and staging authorised).
-- Production only on separate owner GO. Build record: docs/COMPETEN-PROFESSIONAL-PROGRESS-01-stage8.md.
--
-- DEPENDS ON 007 (profiles) only. It names no Stage 1 to 7, Learning, C5 or Passport table.
--
-- ----------------------------------------------------------------------------------------------------
-- NOT A PROGRESS ENGINE, NOT A DOCUMENT RECORD SYSTEM. Stage 8 reads the own records of the person through
-- their owning modules. What it may store (owner GO s3) is exactly this:
--
--   1. individual_professional_progress_preference -- one row per person: default period and view.
--   2. individual_professional_progress_view -- named saved views (a period and filters). The person may
--      rename or delete them. They hold no record content.
--   3. individual_professional_progress_decision -- accept, defer or dismiss of a recommendation. Append-only,
--      latest wins. A goal or need is never created here: the recommendation opens its owning module.
--   4. individual_professional_progress_snapshot -- a progress snapshot the person explicitly asked for:
--      the period and the REFERENCES and counts it showed, never copies. Immutable.
--   5. individual_professional_document -- a document draft: type, template code and version, and the
--      PRESENTATION the person chose (sections, order, which records by reference, hidden fields, their own
--      narrative text). Source facts are never copied into it: a record is named by its key and read from its
--      owner at preview and export. Editing a draft changes no source record.
--   6. individual_professional_document_export -- export metadata only: format, template version, the sha256
--      of the exact content rendered, size and record count. The file itself is never stored: it is generated
--      for the person and streamed to them. Append-only.
--
-- NO SCORE, NO VERIFIED, NO SCOPE COLUMN. A document record entry carrying a body, text, detail or reflection
-- is refused by CHECK, so a draft cannot become a copy of evidence.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique
-- index. experience_code NOT NULL with no default on new person tables. RLS on, own-row SELECT only, no write
-- policy. Append-only trails keep the cascade path (pg_trigger_depth() > 1). notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/COMPETEN-PROFESSIONAL-PROGRESS-01/ROLLBACK-550.sql
-- ====================================================================================================


-- ---- 1. ONE REFUSAL FOR THE APPEND-ONLY RECORDS OF THIS FILE -------------------------------------------

create or replace function public.individual_professional_stage8_append_only() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception '% is append-only: add a new record instead', tg_table_name;
end
$$;


-- ---- 2. PROGRESS PREFERENCES AND SAVED VIEWS -------------------------------------------------------------

create table if not exists individual_professional_progress_preference (
  user_id uuid primary key references profiles(id) on delete cascade,
  experience_code text not null,
  default_period text not null,
  default_view text not null,
  updated_at timestamptz not null default now()
);

alter table individual_professional_progress_preference drop constraint if exists individual_professional_progress_preference_shape;
alter table individual_professional_progress_preference add constraint individual_professional_progress_preference_shape check (
  experience_code = 'professional'
  and default_period ~ '^[a-z0-9][a-z0-9-]{0,62}$'
  and default_view ~ '^[a-z0-9][a-z0-9-]{0,62}$'
);

alter table individual_professional_progress_preference enable row level security;
drop policy if exists individual_professional_progress_preference_read_own on individual_professional_progress_preference;
create policy individual_professional_progress_preference_read_own on individual_professional_progress_preference
  for select using (auth.uid() = user_id);

create table if not exists individual_professional_progress_view (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  experience_code text not null,
  name text not null,
  view_code text not null,
  period_code text not null,
  filters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_individual_professional_progress_view_user
  on individual_professional_progress_view(user_id, created_at);

alter table individual_professional_progress_view drop constraint if exists individual_professional_progress_view_shape;
alter table individual_professional_progress_view add constraint individual_professional_progress_view_shape check (
  experience_code = 'professional'
  and char_length(btrim(name)) between 1 and 120
  and view_code ~ '^[a-z0-9][a-z0-9-]{0,62}$'
  and period_code ~ '^[a-z0-9][a-z0-9-]{0,62}$'
  and jsonb_typeof(filters) = 'object'
  and pg_column_size(filters) <= 8000
);

alter table individual_professional_progress_view enable row level security;
drop policy if exists individual_professional_progress_view_read_own on individual_professional_progress_view;
create policy individual_professional_progress_view_read_own on individual_professional_progress_view
  for select using (auth.uid() = user_id);


-- ---- 3. RECOMMENDATION DECISIONS -------------------------------------------------------------------------

create table if not exists individual_professional_progress_decision (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  experience_code text not null,
  recommendation_key text not null,
  decision text not null,
  deferred_until date,
  decided_at timestamptz not null default now()
);

create index if not exists idx_individual_professional_progress_decision_user
  on individual_professional_progress_decision(user_id, recommendation_key, decided_at desc);

alter table individual_professional_progress_decision drop constraint if exists individual_professional_progress_decision_shape;
alter table individual_professional_progress_decision add constraint individual_professional_progress_decision_shape check (
  experience_code = 'professional'
  and recommendation_key ~ '^[a-z0-9][a-z0-9:_.-]{0,159}$'
  and decision in ('accepted', 'deferred', 'dismissed')
  and (deferred_until is null or decision = 'deferred')
);

alter table individual_professional_progress_decision enable row level security;
drop policy if exists individual_professional_progress_decision_read_own on individual_professional_progress_decision;
create policy individual_professional_progress_decision_read_own on individual_professional_progress_decision
  for select using (auth.uid() = user_id);

drop trigger if exists trg_individual_professional_progress_decision_append_only on individual_professional_progress_decision;
create trigger trg_individual_professional_progress_decision_append_only
  before update or delete on individual_professional_progress_decision
  for each row execute function individual_professional_stage8_append_only();


-- ---- 4. REQUESTED PROGRESS SNAPSHOTS ---------------------------------------------------------------------

create table if not exists individual_professional_progress_snapshot (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  experience_code text not null,
  period_code text not null,
  period_from date,
  period_to date,
  summary jsonb not null,
  config_version text,
  created_at timestamptz not null default now()
);

create index if not exists idx_individual_professional_progress_snapshot_user
  on individual_professional_progress_snapshot(user_id, created_at desc);

alter table individual_professional_progress_snapshot drop constraint if exists individual_professional_progress_snapshot_shape;
alter table individual_professional_progress_snapshot add constraint individual_professional_progress_snapshot_shape check (
  experience_code = 'professional'
  and period_code ~ '^[a-z0-9][a-z0-9-]{0,62}$'
  and (period_from is null or period_to is null or period_from <= period_to)
  and jsonb_typeof(summary) = 'object'
  and not (summary ?| array['score', 'overall', 'percentage', 'competent', 'verified'])
  and not jsonb_path_exists(summary, '$.**.body')
  and not jsonb_path_exists(summary, '$.**.reflection')
  and pg_column_size(summary) <= 200000
  and char_length(coalesce(config_version, '')) <= 100
);

alter table individual_professional_progress_snapshot enable row level security;
drop policy if exists individual_professional_progress_snapshot_read_own on individual_professional_progress_snapshot;
create policy individual_professional_progress_snapshot_read_own on individual_professional_progress_snapshot
  for select using (auth.uid() = user_id);

drop trigger if exists trg_individual_professional_progress_snapshot_append_only on individual_professional_progress_snapshot;
create trigger trg_individual_professional_progress_snapshot_append_only
  before update or delete on individual_professional_progress_snapshot
  for each row execute function individual_professional_stage8_append_only();


-- ---- 5. DOCUMENT DRAFTS -----------------------------------------------------------------------------------

create table if not exists individual_professional_document (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  experience_code text not null,
  doc_type text not null,
  title text not null,
  template_code text not null,
  template_version integer not null,
  origin text not null,
  passport_share_token_id uuid,
  duplicated_from uuid,
  content jsonb not null,
  ai_assisted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_individual_professional_document_id_user
  on individual_professional_document(id, user_id);
create index if not exists idx_individual_professional_document_user
  on individual_professional_document(user_id, updated_at desc);

alter table individual_professional_document drop constraint if exists individual_professional_document_duplicated_fk;
alter table individual_professional_document add constraint individual_professional_document_duplicated_fk
  foreign key (duplicated_from, user_id) references individual_professional_document(id, user_id) on delete set null (duplicated_from);

alter table individual_professional_document drop constraint if exists individual_professional_document_shape;
alter table individual_professional_document add constraint individual_professional_document_shape check (
  experience_code = 'professional'
  and doc_type ~ '^[a-z0-9][a-z0-9-]{0,62}$'
  and template_code ~ '^[a-z0-9][a-z0-9-]{0,62}$'
  and template_version between 1 and 100000
  and char_length(btrim(title)) between 1 and 200
  and origin in ('progress', 'passport')
  and (passport_share_token_id is null or origin = 'passport')
  and (duplicated_from is null or duplicated_from <> id)
  and jsonb_typeof(content) = 'object'
  and jsonb_typeof(coalesce(content -> 'sections', '[]'::jsonb)) = 'array'
  and not jsonb_path_exists(content, '$.sections[*].records[*] ? (exists(@.body) || exists(@.text) || exists(@.detail) || exists(@.reflection))')
  and pg_column_size(content) <= 200000
);

alter table individual_professional_document enable row level security;
drop policy if exists individual_professional_document_read_own on individual_professional_document;
create policy individual_professional_document_read_own on individual_professional_document
  for select using (auth.uid() = user_id);

comment on table individual_professional_document is
  'COMPETEN-PROFESSIONAL-PROGRESS-01 PR7. A private document draft: presentation choices and record REFERENCES, never copies of source records. Editing it changes no source record.';


-- ---- 6. EXPORT METADATA (the file is never stored) --------------------------------------------------------

create table if not exists individual_professional_document_export (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null,
  user_id uuid not null references profiles(id) on delete cascade,
  experience_code text not null,
  format text not null,
  template_code text not null,
  template_version integer not null,
  content_hash text not null,
  byte_size integer not null,
  record_count integer not null,
  exported_at timestamptz not null default now()
);

create index if not exists idx_individual_professional_document_export_doc
  on individual_professional_document_export(document_id, exported_at desc);

alter table individual_professional_document_export drop constraint if exists individual_professional_document_export_doc_fk;
alter table individual_professional_document_export add constraint individual_professional_document_export_doc_fk
  foreign key (document_id, user_id) references individual_professional_document(id, user_id) on delete cascade;

alter table individual_professional_document_export drop constraint if exists individual_professional_document_export_shape;
alter table individual_professional_document_export add constraint individual_professional_document_export_shape check (
  experience_code = 'professional'
  and format in ('docx', 'pdf')
  and template_code ~ '^[a-z0-9][a-z0-9-]{0,62}$'
  and template_version between 1 and 100000
  and content_hash ~ '^[0-9a-f]{64}$'
  and byte_size between 1 and 50000000
  and record_count between 0 and 10000
);

alter table individual_professional_document_export enable row level security;
drop policy if exists individual_professional_document_export_read_own on individual_professional_document_export;
create policy individual_professional_document_export_read_own on individual_professional_document_export
  for select using (auth.uid() = user_id);

drop trigger if exists trg_individual_professional_document_export_append_only on individual_professional_document_export;
create trigger trg_individual_professional_document_export_append_only
  before update or delete on individual_professional_document_export
  for each row execute function individual_professional_stage8_append_only();

comment on table individual_professional_document_export is
  'COMPETEN-PROFESSIONAL-PROGRESS-01 PR7. Export metadata only: format, template version, sha256 of the rendered content, size, record count. The file is generated for the person and never stored.';


notify pgrst, 'reload schema';
