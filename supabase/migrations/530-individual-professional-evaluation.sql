-- ====================================================================================================
-- MIGRATION 530: COMPETEN PROFESSIONAL -- MY PROFESSIONAL EVALUATION (STAGE 6)
--
-- !! APPLY THIS FILE WHOLE. It contains a plpgsql trigger function. A runner that splits on semicolons
-- !! would cut a function body in half. Paste the entire file into the SQL editor and run it once.
--
-- COMPETEN-PROFESSIONAL-EVALUATION-01, Professional Stage 6, owner GO (development and staging authorised).
-- Production only on separate owner GO. Build record: docs/COMPETEN-PROFESSIONAL-EVALUATION-01-stage6.md.
--
-- DEPENDS ON 373 (individual_professional_share), 453 (its (share_token_id, user_id) index) and 007
-- (profiles). It reads nothing else and names no Stage 1 to 5, Learning or C5 table.
--
-- ----------------------------------------------------------------------------------------------------
-- NOT AN EVALUATION ENGINE, NOT A RECORD SYSTEM. Stage 6 reads the own records of the person through their
-- owning modules and interprets them. The ONLY things it writes are these (owner GO s9):
--
--   1. individual_professional_evaluation -- an IMMUTABLE snapshot. Its scope, date, professional context,
--      the REFERENCES of the source records it read (kind, id, class, date, framework version -- never a
--      copy of their words), the criteria and configuration version, the six separate findings, the
--      limitations, the recommendations offered, and, where AI was used, its labelled text, model and policy
--      version. A later evaluation is a new row. A correction is a new row that names the one it corrects.
--   2. individual_professional_evaluation_annotation -- an optional private note on an evaluation. A
--      revision is a new row naming the earlier one.
--   3. individual_professional_evaluation_decision -- accept (optionally edited), defer or dismiss, per
--      recommendation of a snapshot. The latest row for a recommendation is the decision. A need, goal or
--      activity an acceptance creates is written by ITS owning service and only referenced here by id.
--   4. individual_professional_share_evaluation -- which evaluations one Passport link carries (owner GO
--      s13). None by default. Annotations have no path here.
--
-- NO SCORE, NO PERCENTAGE, NO VERIFIED, NO SCOPE COLUMN. The six findings are kept apart by a CHECK, and a
-- source reference that carries a body or text is refused, so a snapshot cannot become a copy of evidence.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique
-- index. experience_code NOT NULL with no default on new person tables. RLS on, own-row SELECT only, no write
-- policy. Append-only trails keep the cascade path (pg_trigger_depth() > 1). notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/COMPETEN-PROFESSIONAL-EVALUATION-01/ROLLBACK-530.sql
-- ====================================================================================================


-- ---- 1. ONE REFUSAL FOR THE APPEND-ONLY RECORDS OF THIS FILE -------------------------------------------

create or replace function public.individual_professional_stage6_append_only() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception '% is append-only: add a new record instead', tg_table_name;
end
$$;


-- ---- 2. THE EVALUATION SNAPSHOT -----------------------------------------------------------------------

create table if not exists individual_professional_evaluation (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  experience_code text not null,
  scope_kind text not null,
  scope_ref text,
  scope_label text not null,
  period_from date,
  period_to date,
  context jsonb not null default '{}'::jsonb,
  sources jsonb not null,
  findings jsonb not null,
  limitations jsonb not null default '[]'::jsonb,
  recommendations jsonb not null default '[]'::jsonb,
  criteria jsonb not null,
  config_version text,
  framework_versions jsonb not null default '[]'::jsonb,
  interpretation text not null,
  ai_text text,
  ai_model text,
  ai_policy_version text,
  supersedes_id uuid,
  correction_note text,
  evaluated_at timestamptz not null default now()
);

create unique index if not exists ux_individual_professional_evaluation_id_user
  on individual_professional_evaluation(id, user_id);
create index if not exists idx_individual_professional_evaluation_user
  on individual_professional_evaluation(user_id, evaluated_at desc);
create index if not exists idx_individual_professional_evaluation_scope
  on individual_professional_evaluation(user_id, scope_kind, scope_ref);

alter table individual_professional_evaluation drop constraint if exists individual_professional_evaluation_supersedes_fk;
alter table individual_professional_evaluation add constraint individual_professional_evaluation_supersedes_fk
  foreign key (supersedes_id, user_id) references individual_professional_evaluation(id, user_id) on delete cascade;

alter table individual_professional_evaluation drop constraint if exists individual_professional_evaluation_shape;
alter table individual_professional_evaluation add constraint individual_professional_evaluation_shape check (
  experience_code = 'professional'
  and scope_kind in ('development', 'goal', 'competency', 'outcome', 'topic', 'cpd', 'learning', 'area')
  and (scope_kind = 'development' or scope_ref is not null)
  and char_length(btrim(scope_label)) between 1 and 300
  and char_length(coalesce(scope_ref, '')) <= 300
  and (period_from is null or period_to is null or period_from <= period_to)
  and jsonb_typeof(context) = 'object'
  and jsonb_typeof(sources) = 'array'
  and jsonb_typeof(findings) = 'object'
  and findings ?& array['development_activity', 'knowledge', 'application', 'competency_evidence', 'independent_verification', 'evidence_confidence']
  and not (findings ?| array['score', 'overall', 'percentage', 'competent', 'verified'])
  and not jsonb_path_exists(sources, '$[*] ? (exists(@.body) || exists(@.text) || exists(@.reflection) || exists(@.detail))')
  and jsonb_typeof(limitations) = 'array'
  and jsonb_typeof(recommendations) = 'array'
  and jsonb_typeof(criteria) = 'object'
  and jsonb_typeof(framework_versions) = 'array'
  and pg_column_size(sources) + pg_column_size(findings) + pg_column_size(recommendations) <= 400000
  and char_length(coalesce(config_version, '')) <= 100
  and (
    (interpretation = 'deterministic' and ai_text is null and ai_model is null and ai_policy_version is null)
    or (interpretation = 'deterministic_and_ai' and char_length(btrim(coalesce(ai_text, ''))) between 1 and 8000
        and char_length(btrim(coalesce(ai_model, ''))) between 1 and 200 and char_length(btrim(coalesce(ai_policy_version, ''))) between 1 and 200)
  )
  and (
    (supersedes_id is null and correction_note is null)
    or (supersedes_id is not null and supersedes_id <> id and char_length(btrim(coalesce(correction_note, ''))) between 3 and 2000)
  )
);

alter table individual_professional_evaluation enable row level security;
drop policy if exists individual_professional_evaluation_read_own on individual_professional_evaluation;
create policy individual_professional_evaluation_read_own on individual_professional_evaluation
  for select using (auth.uid() = user_id);

drop trigger if exists trg_individual_professional_evaluation_append_only on individual_professional_evaluation;
create trigger trg_individual_professional_evaluation_append_only
  before update or delete on individual_professional_evaluation
  for each row execute function individual_professional_stage6_append_only();

comment on table individual_professional_evaluation is
  'COMPETEN-PROFESSIONAL-EVALUATION-01. An immutable, private, formative evaluation snapshot: references and findings by six separate dimensions, never copies of evidence, never a score, never verification of competence. Corrections are new linked rows.';


-- ---- 3. OPTIONAL PRIVATE ANNOTATIONS ------------------------------------------------------------------

create table if not exists individual_professional_evaluation_annotation (
  id uuid primary key default gen_random_uuid(),
  evaluation_id uuid not null,
  user_id uuid not null references profiles(id) on delete cascade,
  experience_code text not null,
  body text not null,
  template_code text,
  template_label text,
  supersedes_id uuid,
  created_at timestamptz not null default now()
);

create unique index if not exists ux_individual_professional_evaluation_annotation_id_user
  on individual_professional_evaluation_annotation(id, user_id);
create index if not exists idx_individual_professional_evaluation_annotation_eval
  on individual_professional_evaluation_annotation(evaluation_id, created_at);

alter table individual_professional_evaluation_annotation drop constraint if exists individual_professional_evaluation_annotation_eval_fk;
alter table individual_professional_evaluation_annotation add constraint individual_professional_evaluation_annotation_eval_fk
  foreign key (evaluation_id, user_id) references individual_professional_evaluation(id, user_id) on delete cascade;
alter table individual_professional_evaluation_annotation drop constraint if exists individual_professional_evaluation_annotation_supersedes_fk;
alter table individual_professional_evaluation_annotation add constraint individual_professional_evaluation_annotation_supersedes_fk
  foreign key (supersedes_id, user_id) references individual_professional_evaluation_annotation(id, user_id) on delete cascade;

alter table individual_professional_evaluation_annotation drop constraint if exists individual_professional_evaluation_annotation_shape;
alter table individual_professional_evaluation_annotation add constraint individual_professional_evaluation_annotation_shape check (
  experience_code = 'professional'
  and char_length(btrim(body)) between 3 and 5000
  and (template_code is null or (template_code ~ '^[a-z0-9][a-z0-9-]{0,62}$' and template_label is not null))
  and char_length(coalesce(template_label, '')) <= 300
  and (supersedes_id is null or supersedes_id <> id)
);

alter table individual_professional_evaluation_annotation enable row level security;
drop policy if exists individual_professional_evaluation_annotation_read_own on individual_professional_evaluation_annotation;
create policy individual_professional_evaluation_annotation_read_own on individual_professional_evaluation_annotation
  for select using (auth.uid() = user_id);

drop trigger if exists trg_individual_professional_evaluation_annotation_append_only on individual_professional_evaluation_annotation;
create trigger trg_individual_professional_evaluation_annotation_append_only
  before update or delete on individual_professional_evaluation_annotation
  for each row execute function individual_professional_stage6_append_only();

comment on table individual_professional_evaluation_annotation is
  'COMPETEN-PROFESSIONAL-EVALUATION-01. An optional private note on an evaluation. Append-only: a revision names the earlier note. Never shared.';


-- ---- 4. RECOMMENDATION DECISIONS ------------------------------------------------------------------------

create table if not exists individual_professional_evaluation_decision (
  id uuid primary key default gen_random_uuid(),
  evaluation_id uuid not null,
  user_id uuid not null references profiles(id) on delete cascade,
  experience_code text not null,
  recommendation_key text not null,
  decision text not null,
  edited_title text,
  deferred_until date,
  note text,
  created_kind text,
  created_id uuid,
  decided_at timestamptz not null default now()
);

create index if not exists idx_individual_professional_evaluation_decision_eval
  on individual_professional_evaluation_decision(evaluation_id, recommendation_key, decided_at desc);
create index if not exists idx_individual_professional_evaluation_decision_user
  on individual_professional_evaluation_decision(user_id);

alter table individual_professional_evaluation_decision drop constraint if exists individual_professional_evaluation_decision_eval_fk;
alter table individual_professional_evaluation_decision add constraint individual_professional_evaluation_decision_eval_fk
  foreign key (evaluation_id, user_id) references individual_professional_evaluation(id, user_id) on delete cascade;

alter table individual_professional_evaluation_decision drop constraint if exists individual_professional_evaluation_decision_shape;
alter table individual_professional_evaluation_decision add constraint individual_professional_evaluation_decision_shape check (
  experience_code = 'professional'
  and recommendation_key ~ '^[a-z0-9][a-z0-9:_.-]{0,159}$'
  and decision in ('accepted', 'deferred', 'dismissed')
  and (edited_title is null or (decision = 'accepted' and char_length(btrim(edited_title)) between 3 and 200))
  and (deferred_until is null or decision = 'deferred')
  and char_length(coalesce(note, '')) <= 1000
  and ((created_kind is null and created_id is null)
    or (decision = 'accepted' and created_kind in ('need', 'goal', 'activity') and created_id is not null))
);

alter table individual_professional_evaluation_decision enable row level security;
drop policy if exists individual_professional_evaluation_decision_read_own on individual_professional_evaluation_decision;
create policy individual_professional_evaluation_decision_read_own on individual_professional_evaluation_decision
  for select using (auth.uid() = user_id);

drop trigger if exists trg_individual_professional_evaluation_decision_append_only on individual_professional_evaluation_decision;
create trigger trg_individual_professional_evaluation_decision_append_only
  before update or delete on individual_professional_evaluation_decision
  for each row execute function individual_professional_stage6_append_only();

comment on table individual_professional_evaluation_decision is
  'COMPETEN-PROFESSIONAL-EVALUATION-01. Accept, defer or dismiss per recommendation of a snapshot, append-only, latest wins. A need, goal or activity an acceptance creates is its owning module record, referenced here by id only.';


-- ---- 5. WHICH EVALUATIONS ONE PASSPORT LINK CARRIES -----------------------------------------------------

create unique index if not exists ux_individual_professional_share_token_user
  on individual_professional_share(share_token_id, user_id);

create table if not exists individual_professional_share_evaluation (
  share_token_id uuid not null,
  user_id uuid not null references profiles(id) on delete cascade,
  evaluation_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (share_token_id, evaluation_id)
);

alter table individual_professional_share_evaluation drop constraint if exists individual_professional_share_evaluation_share_fk;
alter table individual_professional_share_evaluation add constraint individual_professional_share_evaluation_share_fk
  foreign key (share_token_id, user_id) references individual_professional_share(share_token_id, user_id) on delete cascade;
alter table individual_professional_share_evaluation drop constraint if exists individual_professional_share_evaluation_eval_fk;
alter table individual_professional_share_evaluation add constraint individual_professional_share_evaluation_eval_fk
  foreign key (evaluation_id, user_id) references individual_professional_evaluation(id, user_id) on delete cascade;
create index if not exists idx_individual_professional_share_evaluation_user
  on individual_professional_share_evaluation(user_id);

alter table individual_professional_share_evaluation enable row level security;
drop policy if exists individual_professional_share_evaluation_read_own on individual_professional_share_evaluation;
create policy individual_professional_share_evaluation_read_own on individual_professional_share_evaluation
  for select using (auth.uid() = user_id);

comment on table individual_professional_share_evaluation is
  'COMPETEN-PROFESSIONAL-EVALUATION-01 s13. The evaluations a person chose to carry on one Professional Passport link, shown as formative with their sources, method, date and limitations. None by default. Annotations have no path here.';


notify pgrst, 'reload schema';
