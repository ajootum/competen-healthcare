-- ====================================================================================================
-- MIGRATION 470: COMPETEN PROFESSIONAL -- PERSONAL DEVELOPMENT NEEDS (STAGE 2)
--
-- !! APPLY THIS FILE WHOLE. It contains plpgsql trigger functions. A runner that splits on semicolons
-- !! would cut a function body in half. Paste the entire file into the SQL editor and run it once.
--
-- COMPETEN-PROFESSIONAL-NEEDS-01, Professional Stage 2, owner GO (development and staging authorised).
-- Production needs its own owner GO. Build record: docs/COMPETEN-PROFESSIONAL-NEEDS-01-stage2.md.
--
-- DEPENDS ON 373 (individual_professional_need, individual_professional_goal) and 450
-- (individual_professional_profile_item), plus 003 (frameworks, framework_competencies). Independent of
-- 451-453 and of 460-464.
--
-- ----------------------------------------------------------------------------------------------------
-- NOT A SECOND NEEDS ENGINE. The 373 need stays THE development-need record. This file widens it and adds
-- what the Stage 2 GO asks for around it:
--
--   1. The need gains a lifecycle stage (identified, exploring, prioritised, in development, addressed,
--      deferred, retired), a priority, a category, a motivation, why it matters, its professional context,
--      development interests, a free-text source note, how it was created (by the person, from an AI
--      suggestion, from a rule suggestion) and when it was last reviewed. Every one of these is optional:
--      the only thing a need must have is still its title, "what would you like to develop".
--      Stages are NOT sequential: any stage can follow any other. The 373 status (open, met, closed)
--      is kept and kept consistent BY TRIGGER, so the MVP routes and pages keep working unchanged.
--   2. More sources. The 373 origin gains reflection, aspiration, competency exploration, feedback,
--      evaluation, learning discovery and earlier study. A need may name the private reflection or the career
--      aspiration (450) it came from, by composite key, so it can only name one of their own.
--   3. History. individual_professional_need_history is an append-only snapshot of the need, written by
--      trigger on every meaningful change, whoever makes it (the 402 and 450 pattern).
--   4. Private reflections. individual_professional_reflection, own-row read only. Nothing shares them:
--      no Passport, share link or plan reads this table.
--   5. Many-to-many links. A need to many CFCA competencies (with the framework VERSION at the time of
--      linking, and unlinking kept as history), and a goal to many needs (the 373 goal.need_id stays).
--   6. Suggestions. A rule or AI suggestion is a private row the person accepts (it becomes a need),
--      dismisses or defers. A suggestion never becomes a need by itself.
--
-- NO SCOPE COLUMN on any new table, and no verified or deficiency column anywhere: a need is something a
-- person wants to develop, never a finding about them.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique
-- index. experience_code NOT NULL with no default on new person tables. RLS on, own-row SELECT only, no write
-- policy. Append-only trails keep the cascade path (pg_trigger_depth() > 1). notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/COMPETEN-PROFESSIONAL-NEEDS-01/ROLLBACK-470.sql
-- ====================================================================================================


-- ---- 1. PRIVATE REFLECTIONS ------------------------------------------------------------------------

create table if not exists individual_professional_reflection (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  experience_code text not null,
  template_code text,
  template_label text,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_individual_professional_reflection_id_user
  on individual_professional_reflection(id, user_id);
create index if not exists idx_individual_professional_reflection_user
  on individual_professional_reflection(user_id, created_at desc);

alter table individual_professional_reflection drop constraint if exists individual_professional_reflection_shape;
alter table individual_professional_reflection add constraint individual_professional_reflection_shape check (
  experience_code in ('scholar', 'professional')
  and char_length(btrim(body)) between 3 and 5000
  and (template_code is null or (template_code ~ '^[a-z0-9][a-z0-9-]{0,62}$' and template_label is not null))
  and char_length(coalesce(template_label, '')) <= 300
);

alter table individual_professional_reflection enable row level security;
drop policy if exists individual_professional_reflection_read_own on individual_professional_reflection;
create policy individual_professional_reflection_read_own on individual_professional_reflection
  for select using (auth.uid() = user_id);

comment on table individual_professional_reflection is
  'COMPETEN-PROFESSIONAL-NEEDS-01. A private professional reflection. Own-row read. Never shared, never in a plan, Passport or link.';


-- ---- 2. THE NEED GAINS ITS STAGE 2 FIELDS ------------------------------------------------------------

alter table individual_professional_need add column if not exists stage_code text;
alter table individual_professional_need add column if not exists priority_code text;
alter table individual_professional_need add column if not exists priority_label text;
alter table individual_professional_need add column if not exists category_code text;
alter table individual_professional_need add column if not exists category_label text;
alter table individual_professional_need add column if not exists motivation_code text;
alter table individual_professional_need add column if not exists motivation_label text;
alter table individual_professional_need add column if not exists why_it_matters text;
alter table individual_professional_need add column if not exists professional_context text;
alter table individual_professional_need add column if not exists development_interests text;
alter table individual_professional_need add column if not exists source_note text;
alter table individual_professional_need add column if not exists created_via text not null default 'person';
alter table individual_professional_need add column if not exists reflection_id uuid;
alter table individual_professional_need add column if not exists aspiration_item_id uuid;
alter table individual_professional_need add column if not exists reviewed_at timestamptz;

-- More sources. Widening only: every existing origin stays valid.
alter table individual_professional_need drop constraint if exists individual_professional_need_origin_check;
alter table individual_professional_need add constraint individual_professional_need_origin_check
  check (origin in ('self_identified', 'passport_gap', 'reflection', 'aspiration', 'competency_exploration',
                    'feedback', 'evaluation', 'learning_discovery', 'scholar_learning'));

alter table individual_professional_need drop constraint if exists individual_professional_need_stage2_shape;
alter table individual_professional_need add constraint individual_professional_need_stage2_shape check (
  (stage_code is null or stage_code in ('identified', 'exploring', 'prioritised', 'in_development', 'addressed', 'deferred', 'retired'))
  and (priority_code is null or (priority_code ~ '^[a-z0-9][a-z0-9-]{0,62}$' and priority_label is not null))
  and (category_code is null or (category_code ~ '^[a-z0-9][a-z0-9-]{0,62}$' and category_label is not null))
  and (motivation_code is null or (motivation_code ~ '^[a-z0-9][a-z0-9-]{0,62}$' and motivation_label is not null))
  and char_length(coalesce(priority_label, '')) <= 160
  and char_length(coalesce(category_label, '')) <= 160
  and char_length(coalesce(motivation_label, '')) <= 160
  and char_length(coalesce(why_it_matters, '')) <= 2000
  and char_length(coalesce(professional_context, '')) <= 1000
  and char_length(coalesce(development_interests, '')) <= 1000
  and char_length(coalesce(source_note, '')) <= 500
  and created_via in ('person', 'ai_suggestion', 'rule_suggestion')
  and (reflection_id is null or origin = 'reflection')
  and (aspiration_item_id is null or origin = 'aspiration')
);

-- The stage and the 373 status say the same thing. addressed is met, deferred and retired are closed, every
-- other stage is open. The trigger below keeps them so, and this CHECK proves it on every row.
alter table individual_professional_need drop constraint if exists individual_professional_need_stage_status;
alter table individual_professional_need add constraint individual_professional_need_stage_status check (
  stage_code is null or status = case when stage_code = 'addressed' then 'met'
                                      when stage_code in ('deferred', 'retired') then 'closed'
                                      else 'open' end
);

-- A need may name only a reflection or aspiration of the SAME person.
alter table individual_professional_need drop constraint if exists individual_professional_need_reflection_fk;
alter table individual_professional_need add constraint individual_professional_need_reflection_fk
  foreign key (reflection_id, user_id) references individual_professional_reflection(id, user_id) on delete set null (reflection_id);
alter table individual_professional_need drop constraint if exists individual_professional_need_aspiration_fk;
alter table individual_professional_need add constraint individual_professional_need_aspiration_fk
  foreign key (aspiration_item_id, user_id) references individual_professional_profile_item(id, user_id) on delete set null (aspiration_item_id);


-- ---- 3. STAGE AND STATUS, KEPT TOGETHER ----------------------------------------------------------------
--
-- A writer that sets the stage gets the matching status. A writer that sets only the 373 status (the MVP
-- needs route) gets the matching stage. closed_at follows the status (the 373 closed_when CHECK).

create or replace function public.individual_professional_need_stage_sync() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.stage_code is null then
      new.stage_code := case new.status when 'met' then 'addressed' when 'closed' then 'deferred' else 'identified' end;
    end if;
  elsif new.stage_code is distinct from old.stage_code then
    null;
  elsif new.status is distinct from old.status then
    new.stage_code := case new.status when 'met' then 'addressed' when 'closed' then 'deferred'
                      else case when old.stage_code in ('addressed', 'deferred', 'retired') then 'identified' else old.stage_code end end;
  end if;
  new.status := case when new.stage_code = 'addressed' then 'met'
                     when new.stage_code in ('deferred', 'retired') then 'closed'
                     else 'open' end;
  if new.status = 'open' then
    new.closed_at := null;
  elsif new.closed_at is null then
    new.closed_at := now();
  end if;
  return new;
end
$$;

drop trigger if exists trg_individual_professional_need_stage_sync on individual_professional_need;
create trigger trg_individual_professional_need_stage_sync
  before insert or update on individual_professional_need
  for each row execute function individual_professional_need_stage_sync();

-- Backfill: every existing need gets the stage its status means. Idempotent.
update individual_professional_need
   set stage_code = case status when 'met' then 'addressed' when 'closed' then 'deferred' else 'identified' end
 where stage_code is null;


-- ---- 4. NEED HISTORY, APPEND-ONLY, WRITTEN BY TRIGGER ----------------------------------------------------

create table if not exists individual_professional_need_history (
  id uuid primary key default gen_random_uuid(),
  need_id uuid not null,
  user_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  detail text,
  stage_code text,
  priority_label text,
  category_label text,
  motivation_label text,
  why_it_matters text,
  professional_context text,
  development_interests text,
  framework_competency_id uuid,
  recorded_at timestamptz not null default now()
);

alter table individual_professional_need_history drop constraint if exists individual_professional_need_history_need_fk;
alter table individual_professional_need_history add constraint individual_professional_need_history_need_fk
  foreign key (need_id, user_id) references individual_professional_need(id, user_id) on delete cascade;

create index if not exists idx_individual_professional_need_history_need
  on individual_professional_need_history(need_id, recorded_at desc);

alter table individual_professional_need_history enable row level security;
drop policy if exists individual_professional_need_history_read_own on individual_professional_need_history;
create policy individual_professional_need_history_read_own on individual_professional_need_history
  for select using (auth.uid() = user_id);

create or replace function public.individual_professional_need_history_write() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (
       old.title, old.detail, old.stage_code, old.priority_label, old.category_label, old.motivation_label,
       old.why_it_matters, old.professional_context, old.development_interests, old.framework_competency_id
     ) is not distinct from (
       new.title, new.detail, new.stage_code, new.priority_label, new.category_label, new.motivation_label,
       new.why_it_matters, new.professional_context, new.development_interests, new.framework_competency_id
     ) then
    return null;
  end if;
  insert into individual_professional_need_history (
    need_id, user_id, title, detail, stage_code, priority_label, category_label, motivation_label,
    why_it_matters, professional_context, development_interests, framework_competency_id
  ) values (
    new.id, new.user_id, new.title, new.detail, new.stage_code, new.priority_label, new.category_label, new.motivation_label,
    new.why_it_matters, new.professional_context, new.development_interests, new.framework_competency_id
  );
  return null;
end
$$;

drop trigger if exists trg_individual_professional_need_history on individual_professional_need;
create trigger trg_individual_professional_need_history
  after insert or update on individual_professional_need
  for each row execute function individual_professional_need_history_write();

-- One shared refusal for the append-only trails of this file. Only the cascade path may delete, and an
-- update is refused outright, except where a trail declares its own allowed change (section 5).
create or replace function public.individual_professional_stage2_append_only() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception '% is append-only: add a new record instead', tg_table_name;
end
$$;

drop trigger if exists trg_individual_professional_need_history_append_only on individual_professional_need_history;
create trigger trg_individual_professional_need_history_append_only
  before update or delete on individual_professional_need_history
  for each row execute function individual_professional_stage2_append_only();

-- Backfill: one snapshot per existing need, so its history starts with what it says today. Idempotent.
insert into individual_professional_need_history (
  need_id, user_id, title, detail, stage_code, priority_label, category_label, motivation_label,
  why_it_matters, professional_context, development_interests, framework_competency_id, recorded_at
)
select n.id, n.user_id, n.title, n.detail, n.stage_code, n.priority_label, n.category_label, n.motivation_label,
       n.why_it_matters, n.professional_context, n.development_interests, n.framework_competency_id, n.updated_at
  from individual_professional_need n
 where not exists (select 1 from individual_professional_need_history h where h.need_id = n.id);


-- ---- 5. NEED TO COMPETENCY, MANY TO MANY, WITH THE FRAMEWORK VERSION -----------------------------------

create table if not exists individual_professional_need_competency (
  id uuid primary key default gen_random_uuid(),
  need_id uuid not null,
  user_id uuid not null references profiles(id) on delete cascade,
  framework_id uuid not null references frameworks(id) on delete restrict,
  framework_competency_id uuid not null references framework_competencies(id) on delete restrict,
  framework_version text,
  learning_outcome text,
  linked_at timestamptz not null default now(),
  unlinked_at timestamptz
);

alter table individual_professional_need_competency drop constraint if exists individual_professional_need_competency_need_fk;
alter table individual_professional_need_competency add constraint individual_professional_need_competency_need_fk
  foreign key (need_id, user_id) references individual_professional_need(id, user_id) on delete cascade;

create unique index if not exists ux_individual_professional_need_competency_link
  on individual_professional_need_competency(need_id, framework_competency_id, linked_at);
create index if not exists idx_individual_professional_need_competency_user
  on individual_professional_need_competency(user_id, need_id);

alter table individual_professional_need_competency drop constraint if exists individual_professional_need_competency_shape;
alter table individual_professional_need_competency add constraint individual_professional_need_competency_shape check (
  char_length(coalesce(framework_version, '')) <= 40
  and char_length(coalesce(learning_outcome, '')) <= 1000
  and (unlinked_at is null or unlinked_at >= linked_at)
);

alter table individual_professional_need_competency enable row level security;
drop policy if exists individual_professional_need_competency_read_own on individual_professional_need_competency;
create policy individual_professional_need_competency_read_own on individual_professional_need_competency
  for select using (auth.uid() = user_id);

-- A link is never rewritten. The one change allowed is unlinking it once, which keeps it as history.
create or replace function public.individual_professional_need_competency_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'individual_professional_need_competency keeps its history: unlink instead of deleting';
  end if;
  if old.unlinked_at is null and new.unlinked_at is not null
     and (new.id, new.need_id, new.user_id, new.framework_id, new.framework_competency_id, new.framework_version,
          new.learning_outcome, new.linked_at)
         is not distinct from
         (old.id, old.need_id, old.user_id, old.framework_id, old.framework_competency_id, old.framework_version,
          old.learning_outcome, old.linked_at) then
    return new;
  end if;
  raise exception 'individual_professional_need_competency keeps its history: a link can only be unlinked, once';
end
$$;

drop trigger if exists trg_individual_professional_need_competency_guard on individual_professional_need_competency;
create trigger trg_individual_professional_need_competency_guard
  before update or delete on individual_professional_need_competency
  for each row execute function individual_professional_need_competency_guard();

comment on table individual_professional_need_competency is
  'COMPETEN-PROFESSIONAL-NEEDS-01. Links a development need to CFCA competencies, many to many, keeping the framework version at linking and every unlink as history. A link is never a statement of incompetence.';


-- ---- 6. GOAL TO NEED, MANY TO MANY ----------------------------------------------------------------------
--
-- One need may support several goals and one goal may address several needs. The 373 goal.need_id stays the
-- MVP link. Stage 3 (development planning) governs goals themselves.

create table if not exists individual_professional_goal_need (
  goal_id uuid not null,
  need_id uuid not null,
  user_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (goal_id, need_id)
);

alter table individual_professional_goal_need drop constraint if exists individual_professional_goal_need_goal_fk;
alter table individual_professional_goal_need add constraint individual_professional_goal_need_goal_fk
  foreign key (goal_id, user_id) references individual_professional_goal(id, user_id) on delete cascade;
alter table individual_professional_goal_need drop constraint if exists individual_professional_goal_need_need_fk;
alter table individual_professional_goal_need add constraint individual_professional_goal_need_need_fk
  foreign key (need_id, user_id) references individual_professional_need(id, user_id) on delete cascade;

create index if not exists idx_individual_professional_goal_need_need
  on individual_professional_goal_need(need_id);

alter table individual_professional_goal_need enable row level security;
drop policy if exists individual_professional_goal_need_read_own on individual_professional_goal_need;
create policy individual_professional_goal_need_read_own on individual_professional_goal_need
  for select using (auth.uid() = user_id);


-- ---- 7. SUGGESTIONS: PRIVATE, AND NEVER A NEED UNTIL THE PERSON ACCEPTS ----------------------------------

create table if not exists individual_professional_need_suggestion (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  experience_code text not null,
  source text not null,
  rule_key text,
  title text not null,
  basis text not null,
  model text,
  status text not null default 'suggested',
  accepted_need_id uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

alter table individual_professional_need_suggestion drop constraint if exists individual_professional_need_suggestion_need_fk;
alter table individual_professional_need_suggestion add constraint individual_professional_need_suggestion_need_fk
  foreign key (accepted_need_id, user_id) references individual_professional_need(id, user_id) on delete set null (accepted_need_id);

create index if not exists idx_individual_professional_need_suggestion_user
  on individual_professional_need_suggestion(user_id, status, created_at desc);

alter table individual_professional_need_suggestion drop constraint if exists individual_professional_need_suggestion_shape;
alter table individual_professional_need_suggestion add constraint individual_professional_need_suggestion_shape check (
  experience_code in ('scholar', 'professional')
  and source in ('ai', 'rule')
  and (source = 'rule') = (rule_key is not null)
  and (source = 'ai' or model is null)
  and char_length(btrim(title)) between 3 and 200
  and char_length(btrim(basis)) between 3 and 1000
  and char_length(coalesce(rule_key, '')) <= 200
  and status in ('suggested', 'accepted', 'dismissed', 'deferred')
  and ((status = 'suggested') = (decided_at is null))
);

alter table individual_professional_need_suggestion enable row level security;
drop policy if exists individual_professional_need_suggestion_read_own on individual_professional_need_suggestion;
create policy individual_professional_need_suggestion_read_own on individual_professional_need_suggestion
  for select using (auth.uid() = user_id);

comment on table individual_professional_need_suggestion is
  'COMPETEN-PROFESSIONAL-NEEDS-01. A private rule or AI suggestion of a development need, with its basis. It becomes a need only when the person accepts it. Own-row read.';


notify pgrst, 'reload schema';
