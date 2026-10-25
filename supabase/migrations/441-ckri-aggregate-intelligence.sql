-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains plpgsql functions between dollar quotes. A runner that splits on the
-- statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 441: CKRI K2 -- AGGREGATE LEARNING INTELLIGENCE, BUILT INSIDE THE DATABASE
--
-- COMPETEN-KNOWLEDGE-RESEARCH-01 (owner GO, 2026-10-25) section 4 (K2). Development and staging only.
-- Design: docs/COMPETEN-KNOWLEDGE-RESEARCH-01-ckri-foundation.md. Field catalogue: src/lib/knowledge/data-contracts.ts.
--
-- APPLY ON STAGING FIRST. ADDITIVE. Two new tables, four functions, two triggers. No existing row is changed.
-- Re-running it is a no-op. OPS-001 s8: proposed Medium (new functions reading learner evidence), with a rollback
-- rehearsal. Depends on 440, 372, 388, 402, 414, 416, 422, 423 and 435, and on practice_platform_flags.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR, IN ONE SENTENCE.
--
-- It computes deterministic, suppressed, rounded aggregates of structured Scholar evidence for the people who chose
-- collective analytics, so that no row-level evidence, no free text and no person identifier ever leaves the database
-- for collective intelligence.
--
-- ----------------------------------------------------------------------------------------------------
-- THE PIECES.
--
--   ckri_snapshot        one build: measure, period, cohort dimension, disclosure settings, provenance (contract,
--                        policy and builder versions, actor, time, rounded population) and retain_until (NOT NULL).
--                        Content is frozen. retain_until may only move later (a K4 approved dataset). Deleted only
--                        once expired, or by cascade.
--   ckri_snapshot_cell   one reported cell: subject (a competency or a library case), cohort value (a configured
--                        CODE, or all), period start, rounded participants and events, and up to three rates. A
--                        suppressed cell carries no figure at all. NO PERSON COLUMN EXISTS. Written only by the builder.
--   ckri_build_snapshot  the builder. Refuses unless the ckri_research flag is ON, the actor holds
--                        hq.quality.research.govern, the measure is known and available, the cohort minimum is at
--                        least 5 and the range is at most three years. Population: people whose collective_analytics
--                        choice is granted AT BUILD TIME. Suppresses cells under the minimum, applies complementary
--                        suppression within each subject and period, rounds counts, computes rates from unrounded counts.
--   ckri_purge_expired_snapshots  deletes snapshots past retain_until. Returns the number deleted.
--
-- WHAT IT NEVER READS. Uploads, chunks, question stems and options, rationales, source quotes, free-text answers and
-- reasoning, AI feedback, case blueprints and debriefs, titles, topics, typed institution and level labels, decision
-- reasons, evaluation criteria and limitations. scripts/ckri-harness.ts scans this file for each.
--
-- RLS: on for both tables, no policy. Execute on the builder and purge: the service role only.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique
-- index. notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/CKRI/ROLLBACK-441.sql drops the functions, triggers and tables. Snapshots built
--   on staging are lost. They hold aggregates only.
-- ====================================================================================================


-- ---- 1. snapshots and cells -------------------------------------------------------------------------------

create table if not exists ckri_snapshot (
  id                     uuid primary key default gen_random_uuid(),
  measure                text not null,
  period_grain           text not null,
  period_from            date not null,
  period_to              date not null,
  cohort_dimension       text not null,
  min_cohort             integer not null,
  round_to               integer not null,
  complementary          boolean not null,
  contract_version       text not null,
  policy_version         text not null,
  builder_version        text not null,
  population_rounded     integer,
  cells_reported         integer not null default 0,
  cells_suppressed       integer not null default 0,
  built_by               uuid not null references profiles(id),
  built_at               timestamptz not null default now(),
  retain_until           date not null,
  note                   text
);
alter table ckri_snapshot drop constraint if exists ckri_snapshot_check;
alter table ckri_snapshot add constraint ckri_snapshot_check
  check (measure in ('outcome_coverage', 'knowledge_gap', 'retention', 'reasoning_difficulty', 'resource_demand')
     and period_grain in ('month', 'quarter')
     and period_to > period_from and period_to <= period_from + 1096
     and cohort_dimension in ('none', 'programme', 'level', 'institution')
     and min_cohort between 5 and 1000
     and round_to in (1, 5, 10)
     and (population_rounded is null or population_rounded >= 5)
     and cells_reported >= 0 and cells_suppressed >= 0
     and char_length(contract_version) between 1 and 60 and char_length(policy_version) between 1 and 120
     and char_length(builder_version) between 1 and 60
     and retain_until > built_at::date
     and (note is null or char_length(note) <= 1000));
create index if not exists idx_ckri_snapshot_measure on ckri_snapshot(measure, built_at desc);
create index if not exists idx_ckri_snapshot_retain on ckri_snapshot(retain_until);
alter table ckri_snapshot enable row level security;

create table if not exists ckri_snapshot_cell (
  snapshot_id    uuid not null references ckri_snapshot(id) on delete cascade,
  subject_kind   text not null,
  subject_ref    uuid not null,
  cohort_value   text not null,
  period_start   date not null,
  suppressed     boolean not null,
  participants   integer,
  events         integer,
  rate           numeric(5, 4),
  rate_b         numeric(5, 4),
  rate_c         numeric(5, 4),
  constraint ckri_snapshot_cell_pk primary key (snapshot_id, subject_kind, subject_ref, cohort_value, period_start)
);
alter table ckri_snapshot_cell drop constraint if exists ckri_snapshot_cell_check;
alter table ckri_snapshot_cell add constraint ckri_snapshot_cell_check
  check (subject_kind in ('competency', 'library_case')
     and cohort_value ~ '^[A-Za-z0-9_.:-]{1,80}$'
     and (suppressed = (participants is null))
     and (not suppressed or (events is null and rate is null and rate_b is null and rate_c is null))
     and (participants is null or participants >= 5)
     and (events is null or events >= 0)
     and (rate is null or rate between 0 and 1) and (rate_b is null or rate_b between 0 and 1) and (rate_c is null or rate_c between 0 and 1));
alter table ckri_snapshot_cell enable row level security;

create or replace function public.ckri_snapshot_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 or old.retain_until < current_date then return old; end if;
    raise exception 'ckri_snapshot: a snapshot is kept until its retention date';
  end if;
  if tg_op = 'INSERT' then
    if coalesce(current_setting('ckri.builder', true), '') <> 'build' then
      raise exception 'ckri_snapshot: written only by ckri_build_snapshot';
    end if;
    return new;
  end if;
  if coalesce(current_setting('ckri.builder', true), '') = 'build' then
    return new;
  end if;
  if (to_jsonb(new) - 'retain_until' - 'note') is distinct from (to_jsonb(old) - 'retain_until' - 'note') then
    raise exception 'ckri_snapshot: a snapshot is frozen once built';
  end if;
  if new.retain_until < old.retain_until then
    raise exception 'ckri_snapshot: retention can be extended, never shortened. A snapshot past its date is purged';
  end if;
  return new;
end;
$$;
drop trigger if exists ckri_snapshot_guard on ckri_snapshot;
create trigger ckri_snapshot_guard before insert or update or delete on ckri_snapshot for each row execute function public.ckri_snapshot_guard();

create or replace function public.ckri_snapshot_cell_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  if tg_op = 'INSERT' and coalesce(current_setting('ckri.builder', true), '') = 'build' then return new; end if;
  raise exception 'ckri_snapshot_cell: written only by ckri_build_snapshot, and frozen once written';
end;
$$;
drop trigger if exists ckri_snapshot_cell_guard on ckri_snapshot_cell;
create trigger ckri_snapshot_cell_guard before insert or update or delete on ckri_snapshot_cell for each row execute function public.ckri_snapshot_cell_guard();


-- ---- 2. the builder --------------------------------------------------------------------------------------

create or replace function public.ckri_build_snapshot(
  p_measure text, p_from date, p_to date, p_grain text, p_dimension text, p_min integer, p_round integer,
  p_complementary boolean, p_contract_version text, p_policy_version text, p_retain_days integer, p_actor uuid)
returns uuid
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_id uuid;
  v_pop integer;
  v_reported integer;
  v_suppressed integer;
begin
  if not exists (select 1 from practice_platform_flags where flag = 'ckri_research' and enabled is true) then
    raise exception 'ckri_build_snapshot: Knowledge and Research Intelligence is switched off here';
  end if;
  if not ckri_holds_capability(p_actor, 'hq.quality.research.govern') then
    raise exception 'ckri_build_snapshot: not authorised. Building needs an appointment holding hq.quality.research.govern';
  end if;
  if p_measure not in ('outcome_coverage', 'knowledge_gap', 'retention', 'reasoning_difficulty', 'resource_demand') then
    raise exception 'ckri_build_snapshot: unknown or unavailable measure %', p_measure;
  end if;
  if p_min is null or p_min < 5 then
    raise exception 'ckri_build_snapshot: the minimum cohort is never below 5';
  end if;
  if p_retain_days is null or p_retain_days not between 30 and 1825 then
    raise exception 'ckri_build_snapshot: retention is 30 to 1825 days';
  end if;

  perform set_config('ckri.builder', 'build', true);
  drop table if exists ckri_pop, ckri_acc, ckri_ev, ckri_cev, ckri_agg;

  -- The population: granted at build time. A withdrawn person is in no later snapshot.
  create temporary table ckri_pop on commit drop as
    select p.user_id from ckri_participation p
     where p.permission = 'collective_analytics' and p.scope_key = 'all' and p.status = 'granted';

  -- Accepted mappings: the latest decision per mapping is accepted. Decision reasons are never read.
  create temporary table ckri_acc on commit drop as
    select m.id as map_id, m.user_id, m.chunk_id, m.competency_id, d.created_at as decided_at
      from individual_scholar_competency_map m
      join lateral (select x.decision, x.created_at from individual_scholar_competency_decision x
                     where x.map_id = m.id and x.user_id = m.user_id order by x.created_at desc, x.id desc limit 1) d on true
     where d.decision = 'accepted' and m.user_id in (select user_id from ckri_pop);

  -- One row per countable event: who (never leaves this function), subject, time, and up to three flags.
  create temporary table ckri_ev (user_id uuid, subject_kind text, subject_ref uuid, at timestamptz,
                                  f_a numeric, f_b numeric, f_c numeric, event_key text) on commit drop;

  if p_measure = 'outcome_coverage' then
    insert into ckri_ev select a.user_id, 'competency', a.competency_id, a.decided_at, null, null, null, a.map_id::text from ckri_acc a;
  elsif p_measure = 'knowledge_gap' then
    insert into ckri_ev
      select t.user_id, 'competency', a.competency_id, t.answered_at, case when t.correct then 1 else 0 end, null, null, t.id::text || ':' || a.competency_id::text
        from individual_scholar_attempt t
        join individual_scholar_question q on q.id = t.question_id and q.user_id = t.user_id
        join ckri_acc a on a.chunk_id = q.chunk_id and a.user_id = q.user_id;
  elsif p_measure = 'retention' then
    insert into ckri_ev
      select t.user_id, 'competency', a.competency_id, t.answered_at, case when t.correct then 1 else 0 end, null, null, t.id::text || ':' || a.competency_id::text
        from individual_scholar_attempt t
        join individual_scholar_question q on q.id = t.question_id and q.user_id = t.user_id
        join ckri_acc a on a.chunk_id = q.chunk_id and a.user_id = q.user_id
       where exists (select 1 from individual_scholar_attempt e
                      join individual_scholar_question eq on eq.id = e.question_id and eq.user_id = e.user_id
                      join ckri_acc ea on ea.chunk_id = eq.chunk_id and ea.user_id = eq.user_id and ea.competency_id = a.competency_id
                     where e.user_id = t.user_id and e.correct and e.answered_at <= t.answered_at - interval '7 days');
  elsif p_measure = 'reasoning_difficulty' then
    insert into ckri_ev
      select s.user_id, 'competency', c.competency_id, x.created_at,
             case when x.marking = 'deterministic' and x.correct is not null then case when x.correct then 1 else 0 end else null end,
             case when jsonb_array_length(coalesce(x.safety_criterion_ids, '[]'::jsonb)) > 0 then 1 else 0 end,
             case when x.marking = 'ai_evaluation' and x.correct is not null then case when x.correct then 1 else 0 end else null end,
             x.id::text || ':' || c.competency_id::text
        from individual_scholar_case_answer x
        join individual_scholar_case_session s on s.id = x.session_id and s.user_id = x.user_id
        join lateral (
          select cc.competency_id from individual_scholar_case_competency cc where cc.case_id = s.private_case_id and cc.user_id = s.user_id
          union
          select lc.competency_id from case_library_version_competency lc where lc.version_id = s.library_version_id
        ) c on true
       where s.user_id in (select user_id from ckri_pop);
  elsif p_measure = 'resource_demand' then
    insert into ckri_ev
      select l.user_id, 'competency', l.competency_id, l.created_at, null, null, null, 'l:' || l.id::text
        from individual_scholar_learning_session l
       where l.competency_id is not null and l.user_id in (select user_id from ckri_pop)
      union all
      select s.user_id, 'library_case', v.case_id, s.started_at, null, null, null, 'c:' || s.id::text
        from case_library_session s join case_library_version v on v.id = s.version_id
       where s.user_id in (select user_id from ckri_pop)
      union all
      select s.user_id, 'library_case', v.case_id, s.created_at, null, null, null, 's:' || s.id::text
        from individual_scholar_case_session s join case_library_version v on v.id = s.library_version_id
       where s.library_version_id is not null and s.user_id in (select user_id from ckri_pop);
  end if;

  delete from ckri_ev where user_id not in (select user_id from ckri_pop) or at < p_from or at >= p_to;

  -- The cohort value in force when the event happened (402 history). Codes only, never labels.
  create temporary table ckri_cev on commit drop as
    select e.*, date_trunc(p_grain, e.at)::date as period_start,
           case when p_dimension = 'none' then 'all'
                else coalesce((select case p_dimension when 'programme' then lc.programme_code when 'level' then lc.level_code else lc.institution_code end
                                 from individual_scholar_learner_context lc
                                where lc.user_id = e.user_id and lc.effective_from <= e.at and (lc.effective_to is null or lc.effective_to > e.at)
                                order by lc.effective_from desc limit 1), 'unrecorded') end as cohort_value
      from ckri_ev e;

  create temporary table ckri_agg on commit drop as
    select subject_kind, subject_ref, cohort_value, period_start,
           count(distinct user_id) as n_people, count(distinct event_key) as n_events,
           avg(f_a) as r_a, avg(f_b) as r_b, avg(f_c) as r_c,
           (count(distinct user_id) < p_min) as small
      from ckri_cev
     where cohort_value ~ '^[A-Za-z0-9_.:-]{1,80}$'
     group by subject_kind, subject_ref, cohort_value, period_start;

  -- Complementary suppression: where exactly one cell of a subject and period is small, also hide the next smallest,
  -- so the hidden one cannot be recovered by subtraction from a total.
  if p_complementary then
    update ckri_agg g set small = true
      from (select distinct on (a.subject_kind, a.subject_ref, a.period_start) a.subject_kind, a.subject_ref, a.period_start, a.cohort_value
              from ckri_agg a
             where not a.small
               and (select count(*) from ckri_agg b where b.subject_kind = a.subject_kind and b.subject_ref = a.subject_ref and b.period_start = a.period_start and b.small) = 1
             order by a.subject_kind, a.subject_ref, a.period_start, a.n_people asc, a.cohort_value) c
     where g.subject_kind = c.subject_kind and g.subject_ref = c.subject_ref and g.period_start = c.period_start and g.cohort_value = c.cohort_value;
  end if;

  select count(distinct user_id) into v_pop from ckri_cev;
  select count(*) filter (where not small), count(*) filter (where small) into v_reported, v_suppressed from ckri_agg;

  insert into ckri_snapshot (measure, period_grain, period_from, period_to, cohort_dimension, min_cohort, round_to, complementary,
                             contract_version, policy_version, builder_version, population_rounded, cells_reported, cells_suppressed,
                             built_by, retain_until)
  values (p_measure, p_grain, p_from, p_to, p_dimension, p_min, p_round, p_complementary, p_contract_version, p_policy_version,
          'ckri-builder/1', case when v_pop >= p_min then (round(v_pop::numeric / p_round) * p_round)::int else null end,
          v_reported, v_suppressed, p_actor, current_date + p_retain_days)
  returning id into v_id;

  insert into ckri_snapshot_cell (snapshot_id, subject_kind, subject_ref, cohort_value, period_start, suppressed, participants, events, rate, rate_b, rate_c)
  select v_id, subject_kind, subject_ref, cohort_value, period_start, small,
         case when small then null else (round(n_people::numeric / p_round) * p_round)::int end,
         case when small then null else (round(n_events::numeric / p_round) * p_round)::int end,
         case when small then null else round(r_a, 2) end,
         case when small then null else round(r_b, 2) end,
         case when small then null else round(r_c, 2) end
    from ckri_agg;

  perform set_config('ckri.builder', '', true);
  return v_id;
end;
$$;
revoke all on function public.ckri_build_snapshot(text, date, date, text, text, integer, integer, boolean, text, text, integer, uuid) from public, anon, authenticated;
grant execute on function public.ckri_build_snapshot(text, date, date, text, text, integer, integer, boolean, text, text, integer, uuid) to service_role;

create or replace function public.ckri_purge_expired_snapshots()
returns integer
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_n integer;
begin
  delete from ckri_snapshot where retain_until < current_date;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.ckri_purge_expired_snapshots() from public, anon, authenticated;
grant execute on function public.ckri_purge_expired_snapshots() to service_role;


-- Verification: RLS on, no policy, triggers present, no rows.
select c.relname, c.relrowsecurity, (select count(*) from pg_policies p where p.tablename = c.relname) as policies
  from pg_class c where c.relname in ('ckri_snapshot', 'ckri_snapshot_cell') order by c.relname;

notify pgrst, 'reload schema';
