-- ====================================================================================================
-- MIGRATION 480: COMPETEN PROFESSIONAL -- PERSONAL DEVELOPMENT PLANNING (STAGE 3)
--
-- !! APPLY THIS FILE WHOLE. It contains plpgsql trigger functions. A runner that splits on semicolons
-- !! would cut a function body in half. Paste the entire file into the SQL editor and run it once.
--
-- COMPETEN-PROFESSIONAL-PLAN-01, Professional Stage 3, owner GO (development and staging authorised).
-- Production only on separate owner GO. Build record: docs/COMPETEN-PROFESSIONAL-PLAN-01-stage3.md.
--
-- DEPENDS ON 373 (goal, cpd, evidence), 393 (its (id, user_id) indexes, repeated here idempotently), 450
-- (profile item), 470 (need, reflection, goal_need), 460 and
-- 462 (learning_offering, learning_record), 003 (frameworks, framework_competencies).
--
-- ----------------------------------------------------------------------------------------------------
-- NOT A SECOND PLANNING ENGINE. The 373 goal stays THE goal record. This file widens it and adds around it:
--
--   1. The goal: only its title is required now (target_date becomes optional), plus an optional type,
--      motivation, intended outcome, priority, expected evidence, start and review dates, a template and
--      its answers, where it came from (directly, a need, a competency, a learning opportunity, an
--      aspiration, a reflection, an evaluation), and a deferred status beside planned, in progress, done
--      and dropped. Done is a judgement the person makes: nothing here verifies anything.
--   2. Goal history: an append-only snapshot written by trigger on every meaningful change, so an original
--      intention is never silently overwritten by a revised plan.
--   3. Development activities: PLANNED or intended work (planned, active, completed, deferred, cancelled),
--      linked to many goals (ordered), optionally to a catalogue offering, and optionally depending on
--      another activity. What actually HAPPENED is never stored here. It is the Stage 4 CPD record (373 CPD)
--      or the Holdings learning record (462), which an activity references by composite key, one activity per
--      record. Completed is only possible with such a reference. No hours, credits, evidence or actual dates.
--      Activity history is written by trigger.
--   4. Milestones, optional, per goal.
--   5. Competency links for goals and activities, many to many, with the framework version and unlink
--      history (the 470 need pattern).
--   6. Evidence links from a goal to records that already exist: an evidence item or a private reflection.
--      CPD and learning records reach a goal only through an activity, so there is one path. Unlinking keeps
--      history. The evidence class is that of the source record.
--   7. Goal reviews: append-only, private, with the decision taken (continue, revise, addressed, defer,
--      retire, reopen).
--
-- NO SCOPE COLUMN, no verified column, no score, nothing an employer reads. A plan belongs to the person.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique
-- index. experience_code NOT NULL with no default on new person tables. RLS on, own-row SELECT only, no write
-- policy. Append-only trails keep the cascade path (pg_trigger_depth() > 1). notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/COMPETEN-PROFESSIONAL-PLAN-01/ROLLBACK-480.sql
-- ====================================================================================================


-- ---- 1. THE GOAL GAINS ITS STAGE 3 FIELDS --------------------------------------------------------------

alter table individual_professional_goal alter column target_date drop not null;

alter table individual_professional_goal add column if not exists goal_type_code text;
alter table individual_professional_goal add column if not exists goal_type_label text;
alter table individual_professional_goal add column if not exists motivation text;
alter table individual_professional_goal add column if not exists intended_outcome text;
alter table individual_professional_goal add column if not exists priority_code text;
alter table individual_professional_goal add column if not exists priority_label text;
alter table individual_professional_goal add column if not exists expected_evidence text;
alter table individual_professional_goal add column if not exists start_date date;
alter table individual_professional_goal add column if not exists review_date date;
alter table individual_professional_goal add column if not exists template_code text;
alter table individual_professional_goal add column if not exists template_label text;
alter table individual_professional_goal add column if not exists template_answers jsonb;
alter table individual_professional_goal add column if not exists created_from text not null default 'direct';
alter table individual_professional_goal add column if not exists source_framework_competency_id uuid references framework_competencies(id) on delete set null;
alter table individual_professional_goal add column if not exists source_learning_offering_id uuid references learning_offering(id) on delete set null;
alter table individual_professional_goal add column if not exists aspiration_item_id uuid;
alter table individual_professional_goal add column if not exists reflection_id uuid;
alter table individual_professional_goal add column if not exists reviewed_at timestamptz;

-- Deferred joins the 373 statuses. planned, in_progress, done and dropped keep their meaning.
alter table individual_professional_goal drop constraint if exists individual_professional_goal_status_check;
alter table individual_professional_goal add constraint individual_professional_goal_status_check
  check (status in ('planned', 'in_progress', 'done', 'deferred', 'dropped'));

alter table individual_professional_goal drop constraint if exists individual_professional_goal_stage3_shape;
alter table individual_professional_goal add constraint individual_professional_goal_stage3_shape check (
  (goal_type_code is null or (goal_type_code ~ '^[a-z0-9][a-z0-9-]{0,62}$' and goal_type_label is not null))
  and (priority_code is null or (priority_code ~ '^[a-z0-9][a-z0-9-]{0,62}$' and priority_label is not null))
  and (template_code is null or (template_code ~ '^[a-z0-9][a-z0-9-]{0,62}$' and template_label is not null))
  and (template_answers is null or (jsonb_typeof(template_answers) = 'object' and length(template_answers::text) <= 6000))
  and char_length(coalesce(goal_type_label, '')) <= 160
  and char_length(coalesce(priority_label, '')) <= 160
  and char_length(coalesce(template_label, '')) <= 160
  and char_length(coalesce(motivation, '')) <= 1000
  and char_length(coalesce(intended_outcome, '')) <= 2000
  and char_length(coalesce(expected_evidence, '')) <= 2000
  and created_from in ('direct', 'need', 'competency', 'learning', 'aspiration', 'reflection', 'evaluation')
  and (start_date is null or target_date is null or target_date >= start_date)
  and (aspiration_item_id is null or created_from = 'aspiration')
  and (reflection_id is null or created_from = 'reflection')
);

alter table individual_professional_goal drop constraint if exists individual_professional_goal_aspiration_fk;
alter table individual_professional_goal add constraint individual_professional_goal_aspiration_fk
  foreign key (aspiration_item_id, user_id) references individual_professional_profile_item(id, user_id) on delete set null (aspiration_item_id);
alter table individual_professional_goal drop constraint if exists individual_professional_goal_reflection_fk;
alter table individual_professional_goal add constraint individual_professional_goal_reflection_fk
  foreign key (reflection_id, user_id) references individual_professional_reflection(id, user_id) on delete set null (reflection_id);


-- ---- 2. ONE REFUSAL FOR THE APPEND-ONLY TRAILS OF THIS FILE --------------------------------------------

create or replace function public.individual_professional_stage3_append_only() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception '% is append-only: add a new record instead', tg_table_name;
end
$$;


-- ---- 3. GOAL HISTORY, WRITTEN BY TRIGGER ------------------------------------------------------------------

create table if not exists individual_professional_goal_history (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null,
  user_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  detail text,
  status text,
  goal_type_label text,
  priority_label text,
  intended_outcome text,
  expected_evidence text,
  start_date date,
  target_date date,
  review_date date,
  template_answers jsonb,
  recorded_at timestamptz not null default now()
);

alter table individual_professional_goal_history drop constraint if exists individual_professional_goal_history_goal_fk;
alter table individual_professional_goal_history add constraint individual_professional_goal_history_goal_fk
  foreign key (goal_id, user_id) references individual_professional_goal(id, user_id) on delete cascade;
create index if not exists idx_individual_professional_goal_history_goal
  on individual_professional_goal_history(goal_id, recorded_at desc);

alter table individual_professional_goal_history enable row level security;
drop policy if exists individual_professional_goal_history_read_own on individual_professional_goal_history;
create policy individual_professional_goal_history_read_own on individual_professional_goal_history
  for select using (auth.uid() = user_id);

create or replace function public.individual_professional_goal_history_write() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (
       old.title, old.detail, old.status, old.goal_type_label, old.priority_label, old.intended_outcome, old.expected_evidence,
       old.start_date, old.target_date, old.review_date, old.template_answers
     ) is not distinct from (
       new.title, new.detail, new.status, new.goal_type_label, new.priority_label, new.intended_outcome, new.expected_evidence,
       new.start_date, new.target_date, new.review_date, new.template_answers
     ) then
    return null;
  end if;
  insert into individual_professional_goal_history (
    goal_id, user_id, title, detail, status, goal_type_label, priority_label, intended_outcome, expected_evidence,
    start_date, target_date, review_date, template_answers
  ) values (
    new.id, new.user_id, new.title, new.detail, new.status, new.goal_type_label, new.priority_label, new.intended_outcome, new.expected_evidence,
    new.start_date, new.target_date, new.review_date, new.template_answers
  );
  return null;
end
$$;

drop trigger if exists trg_individual_professional_goal_history on individual_professional_goal;
create trigger trg_individual_professional_goal_history
  after insert or update on individual_professional_goal
  for each row execute function individual_professional_goal_history_write();

drop trigger if exists trg_individual_professional_goal_history_append_only on individual_professional_goal_history;
create trigger trg_individual_professional_goal_history_append_only
  before update or delete on individual_professional_goal_history
  for each row execute function individual_professional_stage3_append_only();

-- Backfill: one snapshot per existing goal. Idempotent.
insert into individual_professional_goal_history (goal_id, user_id, title, detail, status, target_date, recorded_at)
select g.id, g.user_id, g.title, g.detail, g.status, g.target_date, g.updated_at
  from individual_professional_goal g
 where not exists (select 1 from individual_professional_goal_history h where h.goal_id = g.id);


-- ---- 4. DEVELOPMENT ACTIVITIES ----------------------------------------------------------------------------
--
-- The composite keys below need (id, user_id) unique indexes on the CPD and evidence tables. Migration 393
-- created them under these exact names, so on any project with 393 these two statements do nothing. They are
-- repeated so 480 cannot fail where 393 is absent.

create unique index if not exists ux_individual_professional_cpd_id_user
  on individual_professional_cpd(id, user_id);
create unique index if not exists ux_individual_professional_evidence_id_user
  on individual_professional_evidence(id, user_id);

create table if not exists individual_professional_activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  experience_code text not null,
  activity_type_code text,
  activity_type_label text,
  title text not null,
  detail text,
  status text not null default 'planned',
  planned_start date,
  planned_end date,
  provider text,
  external_url text,
  learning_offering_id uuid references learning_offering(id) on delete set null,
  learning_record_id uuid,
  cpd_id uuid,
  depends_on_activity_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_individual_professional_activity_id_user
  on individual_professional_activity(id, user_id);
create index if not exists idx_individual_professional_activity_user
  on individual_professional_activity(user_id, status, created_at desc);
-- One activity per record of what happened. Many goals hang off it through the activity goal table.
-- Nulls are distinct, so planned activities without a record are unaffected.
create unique index if not exists ux_individual_professional_activity_cpd
  on individual_professional_activity(cpd_id);
create unique index if not exists ux_individual_professional_activity_record
  on individual_professional_activity(learning_record_id);

-- References to records that already exist: the OWN learning record, CPD entry and other activity of the same person.
alter table individual_professional_activity drop constraint if exists individual_professional_activity_record_fk;
alter table individual_professional_activity add constraint individual_professional_activity_record_fk
  foreign key (learning_record_id, user_id) references learning_record(id, user_id) on delete set null (learning_record_id);
alter table individual_professional_activity drop constraint if exists individual_professional_activity_cpd_fk;
alter table individual_professional_activity add constraint individual_professional_activity_cpd_fk
  foreign key (cpd_id, user_id) references individual_professional_cpd(id, user_id) on delete set null (cpd_id);
alter table individual_professional_activity drop constraint if exists individual_professional_activity_depends_fk;
alter table individual_professional_activity add constraint individual_professional_activity_depends_fk
  foreign key (depends_on_activity_id, user_id) references individual_professional_activity(id, user_id) on delete set null (depends_on_activity_id);

alter table individual_professional_activity drop constraint if exists individual_professional_activity_shape;
alter table individual_professional_activity add constraint individual_professional_activity_shape check (
  experience_code in ('scholar', 'professional')
  and status in ('planned', 'active', 'completed', 'deferred', 'cancelled')
  and (activity_type_code is null or (activity_type_code ~ '^[a-z0-9][a-z0-9-]{0,62}$'
       and char_length(btrim(coalesce(activity_type_label, ''))) between 1 and 160))
  and (activity_type_label is null or activity_type_code is not null)
  and char_length(btrim(title)) between 3 and 200
  -- completed is backed by the record of what happened, never stored here on its own
  and (status <> 'completed' or cpd_id is not null or learning_record_id is not null)
  and char_length(coalesce(detail, '')) <= 2000
  and char_length(coalesce(provider, '')) <= 160
  and (external_url is null or (external_url ~ '^https?://' and char_length(external_url) <= 500))
  and (planned_start is null or planned_end is null or planned_end >= planned_start)
  and (depends_on_activity_id is null or depends_on_activity_id <> id)
);

alter table individual_professional_activity enable row level security;
drop policy if exists individual_professional_activity_read_own on individual_professional_activity;
create policy individual_professional_activity_read_own on individual_professional_activity
  for select using (auth.uid() = user_id);

comment on table individual_professional_activity is
  'COMPETEN-PROFESSIONAL-PLAN-01. A planned or intended development activity. What happened is the referenced CPD entry or learning record, never a copy here. Completing it never achieves a goal by itself.';

-- Activity to goal, many to many, ordered per goal.
create table if not exists individual_professional_activity_goal (
  activity_id uuid not null,
  goal_id uuid not null,
  user_id uuid not null references profiles(id) on delete cascade,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (activity_id, goal_id)
);
alter table individual_professional_activity_goal drop constraint if exists individual_professional_activity_goal_activity_fk;
alter table individual_professional_activity_goal add constraint individual_professional_activity_goal_activity_fk
  foreign key (activity_id, user_id) references individual_professional_activity(id, user_id) on delete cascade;
alter table individual_professional_activity_goal drop constraint if exists individual_professional_activity_goal_goal_fk;
alter table individual_professional_activity_goal add constraint individual_professional_activity_goal_goal_fk
  foreign key (goal_id, user_id) references individual_professional_goal(id, user_id) on delete cascade;
create index if not exists idx_individual_professional_activity_goal_goal
  on individual_professional_activity_goal(goal_id, position);
alter table individual_professional_activity_goal drop constraint if exists individual_professional_activity_goal_position;
alter table individual_professional_activity_goal add constraint individual_professional_activity_goal_position check (position between 0 and 10000);

alter table individual_professional_activity_goal enable row level security;
drop policy if exists individual_professional_activity_goal_read_own on individual_professional_activity_goal;
create policy individual_professional_activity_goal_read_own on individual_professional_activity_goal
  for select using (auth.uid() = user_id);

-- Activity history, written by trigger.
create table if not exists individual_professional_activity_history (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null,
  user_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  status text not null,
  planned_start date,
  planned_end date,
  cpd_id uuid,
  learning_record_id uuid,
  recorded_at timestamptz not null default now()
);
alter table individual_professional_activity_history drop constraint if exists individual_professional_activity_history_activity_fk;
alter table individual_professional_activity_history add constraint individual_professional_activity_history_activity_fk
  foreign key (activity_id, user_id) references individual_professional_activity(id, user_id) on delete cascade;
create index if not exists idx_individual_professional_activity_history_activity
  on individual_professional_activity_history(activity_id, recorded_at desc);

alter table individual_professional_activity_history enable row level security;
drop policy if exists individual_professional_activity_history_read_own on individual_professional_activity_history;
create policy individual_professional_activity_history_read_own on individual_professional_activity_history
  for select using (auth.uid() = user_id);

create or replace function public.individual_professional_activity_history_write() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (old.title, old.status, old.planned_start, old.planned_end, old.cpd_id, old.learning_record_id)
     is not distinct from (new.title, new.status, new.planned_start, new.planned_end, new.cpd_id, new.learning_record_id) then
    return null;
  end if;
  insert into individual_professional_activity_history (activity_id, user_id, title, status, planned_start, planned_end, cpd_id, learning_record_id)
  values (new.id, new.user_id, new.title, new.status, new.planned_start, new.planned_end, new.cpd_id, new.learning_record_id);
  return null;
end
$$;

-- When the record behind a completed activity is removed (the CPD entry or learning record is deleted and the
-- reference is set null, or the person unlinks it), the activity goes back to planned. Completed never
-- outlives the record of what happened. A plain update to completed without a record is still refused.
create or replace function public.individual_professional_activity_record_cleared() returns trigger
language plpgsql as $$
begin
  if new.status = 'completed' and new.cpd_id is null and new.learning_record_id is null
     and (old.cpd_id is not null or old.learning_record_id is not null) then
    new.status := 'planned';
  end if;
  return new;
end
$$;

drop trigger if exists trg_individual_professional_activity_record_cleared on individual_professional_activity;
create trigger trg_individual_professional_activity_record_cleared
  before update on individual_professional_activity
  for each row execute function individual_professional_activity_record_cleared();

drop trigger if exists trg_individual_professional_activity_history on individual_professional_activity;
create trigger trg_individual_professional_activity_history
  after insert or update on individual_professional_activity
  for each row execute function individual_professional_activity_history_write();

drop trigger if exists trg_individual_professional_activity_history_append_only on individual_professional_activity_history;
create trigger trg_individual_professional_activity_history_append_only
  before update or delete on individual_professional_activity_history
  for each row execute function individual_professional_stage3_append_only();


-- ---- 5. MILESTONES (OPTIONAL) ------------------------------------------------------------------------------

create table if not exists individual_professional_milestone (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  goal_id uuid not null,
  title text not null,
  milestone_type_code text,
  milestone_type_label text,
  due_on date,
  achieved_on date,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
alter table individual_professional_milestone drop constraint if exists individual_professional_milestone_goal_fk;
alter table individual_professional_milestone add constraint individual_professional_milestone_goal_fk
  foreign key (goal_id, user_id) references individual_professional_goal(id, user_id) on delete cascade;
create index if not exists idx_individual_professional_milestone_goal
  on individual_professional_milestone(goal_id, position);
alter table individual_professional_milestone drop constraint if exists individual_professional_milestone_shape;
alter table individual_professional_milestone add constraint individual_professional_milestone_shape check (
  char_length(btrim(title)) between 2 and 200
  and (milestone_type_code is null or (milestone_type_code ~ '^[a-z0-9][a-z0-9-]{0,62}$' and milestone_type_label is not null))
  and char_length(coalesce(milestone_type_label, '')) <= 160
  and position between 0 and 10000
);

alter table individual_professional_milestone enable row level security;
drop policy if exists individual_professional_milestone_read_own on individual_professional_milestone;
create policy individual_professional_milestone_read_own on individual_professional_milestone
  for select using (auth.uid() = user_id);


-- ---- 6. COMPETENCY LINKS FOR GOALS AND ACTIVITIES (VERSIONED, UNLINK KEPT) ----------------------------

create table if not exists individual_professional_plan_competency (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  goal_id uuid,
  activity_id uuid,
  framework_id uuid not null references frameworks(id) on delete restrict,
  framework_competency_id uuid not null references framework_competencies(id) on delete restrict,
  framework_version text,
  learning_outcome text,
  linked_at timestamptz not null default now(),
  unlinked_at timestamptz
);
alter table individual_professional_plan_competency drop constraint if exists individual_professional_plan_competency_goal_fk;
alter table individual_professional_plan_competency add constraint individual_professional_plan_competency_goal_fk
  foreign key (goal_id, user_id) references individual_professional_goal(id, user_id) on delete cascade;
alter table individual_professional_plan_competency drop constraint if exists individual_professional_plan_competency_activity_fk;
alter table individual_professional_plan_competency add constraint individual_professional_plan_competency_activity_fk
  foreign key (activity_id, user_id) references individual_professional_activity(id, user_id) on delete cascade;
create index if not exists idx_individual_professional_plan_competency_user
  on individual_professional_plan_competency(user_id, goal_id, activity_id);
alter table individual_professional_plan_competency drop constraint if exists individual_professional_plan_competency_shape;
alter table individual_professional_plan_competency add constraint individual_professional_plan_competency_shape check (
  ((goal_id is not null)::int + (activity_id is not null)::int) = 1
  and char_length(coalesce(framework_version, '')) <= 40
  and char_length(coalesce(learning_outcome, '')) <= 1000
  and (unlinked_at is null or unlinked_at >= linked_at)
);

alter table individual_professional_plan_competency enable row level security;
drop policy if exists individual_professional_plan_competency_read_own on individual_professional_plan_competency;
create policy individual_professional_plan_competency_read_own on individual_professional_plan_competency
  for select using (auth.uid() = user_id);


-- ---- 7. EVIDENCE LINKS FROM A GOAL TO RECORDS THAT ALREADY EXIST -------------------------------------------

create table if not exists individual_professional_goal_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  goal_id uuid not null,
  evidence_id uuid,
  reflection_id uuid,
  linked_at timestamptz not null default now(),
  unlinked_at timestamptz
);
alter table individual_professional_goal_evidence drop constraint if exists individual_professional_goal_evidence_goal_fk;
alter table individual_professional_goal_evidence add constraint individual_professional_goal_evidence_goal_fk
  foreign key (goal_id, user_id) references individual_professional_goal(id, user_id) on delete cascade;
alter table individual_professional_goal_evidence drop constraint if exists individual_professional_goal_evidence_evidence_fk;
alter table individual_professional_goal_evidence add constraint individual_professional_goal_evidence_evidence_fk
  foreign key (evidence_id, user_id) references individual_professional_evidence(id, user_id) on delete cascade;
alter table individual_professional_goal_evidence drop constraint if exists individual_professional_goal_evidence_reflection_fk;
alter table individual_professional_goal_evidence add constraint individual_professional_goal_evidence_reflection_fk
  foreign key (reflection_id, user_id) references individual_professional_reflection(id, user_id) on delete cascade;
create index if not exists idx_individual_professional_goal_evidence_goal
  on individual_professional_goal_evidence(goal_id, linked_at);
alter table individual_professional_goal_evidence drop constraint if exists individual_professional_goal_evidence_shape;
alter table individual_professional_goal_evidence add constraint individual_professional_goal_evidence_shape check (
  ((evidence_id is not null)::int + (reflection_id is not null)::int) = 1
  and (unlinked_at is null or unlinked_at >= linked_at)
);

alter table individual_professional_goal_evidence enable row level security;
drop policy if exists individual_professional_goal_evidence_read_own on individual_professional_goal_evidence;
create policy individual_professional_goal_evidence_read_own on individual_professional_goal_evidence
  for select using (auth.uid() = user_id);

-- Competency and evidence links are never rewritten: unlink once, keep it as history. Delete only by cascade.
create or replace function public.individual_professional_stage3_link_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception '% keeps its history: unlink instead of deleting', tg_table_name;
  end if;
  if old.unlinked_at is null and new.unlinked_at is not null
     and (to_jsonb(new) - 'unlinked_at') = (to_jsonb(old) - 'unlinked_at') then
    return new;
  end if;
  raise exception '% keeps its history: a link can only be unlinked, once', tg_table_name;
end
$$;

drop trigger if exists trg_individual_professional_plan_competency_guard on individual_professional_plan_competency;
create trigger trg_individual_professional_plan_competency_guard
  before update or delete on individual_professional_plan_competency
  for each row execute function individual_professional_stage3_link_guard();
drop trigger if exists trg_individual_professional_goal_evidence_guard on individual_professional_goal_evidence;
create trigger trg_individual_professional_goal_evidence_guard
  before update or delete on individual_professional_goal_evidence
  for each row execute function individual_professional_stage3_link_guard();


-- ---- 8. GOAL REVIEWS: PRIVATE, APPEND-ONLY -----------------------------------------------------------------

create table if not exists individual_professional_goal_review (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  goal_id uuid not null,
  undertaken text,
  learned text,
  evidence_note text,
  changed text,
  next_steps text,
  decision text not null,
  status_before text,
  reviewed_at timestamptz not null default now()
);
alter table individual_professional_goal_review drop constraint if exists individual_professional_goal_review_goal_fk;
alter table individual_professional_goal_review add constraint individual_professional_goal_review_goal_fk
  foreign key (goal_id, user_id) references individual_professional_goal(id, user_id) on delete cascade;
create index if not exists idx_individual_professional_goal_review_goal
  on individual_professional_goal_review(goal_id, reviewed_at desc);
alter table individual_professional_goal_review drop constraint if exists individual_professional_goal_review_shape;
alter table individual_professional_goal_review add constraint individual_professional_goal_review_shape check (
  decision in ('continue', 'revise', 'reprioritise', 'addressed', 'deferred', 'retired', 'reopened')
  and char_length(coalesce(undertaken, '')) <= 2000 and char_length(coalesce(learned, '')) <= 2000
  and char_length(coalesce(evidence_note, '')) <= 2000 and char_length(coalesce(changed, '')) <= 2000
  and char_length(coalesce(next_steps, '')) <= 2000
);

alter table individual_professional_goal_review enable row level security;
drop policy if exists individual_professional_goal_review_read_own on individual_professional_goal_review;
create policy individual_professional_goal_review_read_own on individual_professional_goal_review
  for select using (auth.uid() = user_id);

drop trigger if exists trg_individual_professional_goal_review_append_only on individual_professional_goal_review;
create trigger trg_individual_professional_goal_review_append_only
  before update or delete on individual_professional_goal_review
  for each row execute function individual_professional_stage3_append_only();

comment on table individual_professional_goal_review is
  'COMPETEN-PROFESSIONAL-PLAN-01. A private, append-only review of a goal and the decision the person took. Addressed is the person''s own judgement, never verification.';


notify pgrst, 'reload schema';
