-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains two sql functions and one DO block between dollar quotes.
-- A runner that splits on the statement separator would cut a function in half, so paste and run the entire
-- file at once.
-- ====================================================================================================
-- MIGRATION 996: SQIE QUESTION ANALYTICS FOR HQ -- CONSENTED, COHORT-SUPPRESSED, AGGREGATE ONLY
--
-- SQIE-CLOSE-2026-11 workstream WS-G (owner directive SQIE-CLOSE-2026-11 s8: "preserve privacy boundaries between
-- Individual learner records and institutional analytics"). Tracker rows SQIE-10, C-14, s8 "Privacy". Build record:
-- docs/evidence/SQIE-HQ/995-996-build-record.md.
--
-- THE GAP IT CLOSES (privacy, fixed first). Library item performance on /super-admin/research/questions read every
-- learner library copy and attempt (src/lib/hq/library-item-performance.ts) with NEITHER the collective_analytics
-- consent (440 ckri_participation) NOR the 441 minimum cohort that every other CKRI aggregate applies. These functions
-- move that read into the database, where the person never leaves it, exactly as 441 ckri_build_snapshot does:
--   * POPULATION. Only people whose collective_analytics permission (scope all) is granted when the function runs. A
--     withdrawn person is in no later figure.
--   * FLOOR. A cell describing fewer than greatest(5, p_min) distinct people is SUPPRESSED: its counts are null and only
--     the flag is returned. The floor is never below 5, whatever the caller asks (441 rule).
--   * ROUNDING. People and attempt counts are rounded to p_round (1, 5 or 10, the CKRI policy). Percentages and the
--     discrimination index are computed from the exact counts INSIDE the function and returned rounded.
--   * FIXED COLUMNS. Each function RETURNS TABLE with declared columns and no user id, no question text, no answer:
--     a function whose columns are declared and auditable in one place (plane-boundary.ts, the 339 pattern).
--   * EXECUTE: service_role only. Revoked from public, anon and authenticated.
--
-- WHAT IT ADDS (no table, no column, no row):
--   ckri_library_item_stats(p_versions uuid[], p_min int, p_round int)
--     per library version: learners holding a copy who answered, first-attempt and all-attempt counts, percent correct,
--     last used (a date), learners whose first attempt was wrong, the first-attempt choice distribution of a single best
--     answer item (each choice below the floor is null, the rest rounded), and a DISCRIMINATION index: the point-biserial correlation (Pearson on a 0/1 item score) between a
--     learner first attempt at this item and their first-attempt rate on the OTHER library items they answered (the
--     corrected item-rest correlation), over consenting learners with at least one other item. Null where it cannot be
--     computed (no variance, or fewer than the floor of learners with a rest score).
--   ckri_question_format_correctness(p_since timestamptz, p_min int, p_round int)
--     per question format (the stored kind, or answer.format of a short item: cloze, true_false, extended, scenario and
--     later formats) and source (personal = written for the learner, library = a governed copy): learners, attempts,
--     correct, percent correct, since p_since. Attempts kept unmarked (950) are not counted as answers.
--
-- FORMATIVE PRACTICE, NOT ASSESSMENT. These are question-quality and learning-pattern figures. Nothing here is a grade
-- or a competence, and nothing reads a rubric, a stem, a response or an evaluator output.
--
-- FAIL CLOSED WITHOUT IT. The HQ page calls these functions only. Absent, the page says "not measured" and shows no
-- learner-derived figure at all (the direct reads are removed in the same change).
--
-- APPLY ON STAGING ONLY. NOT AUTHORISED FOR PRODUCTION without a separate owner GO. DEPENDS ON 372, 416, 440, 710.
-- Re-running it is a no-op. OPS-001 s8: proposed Low (two read-only functions).
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique index.
-- notify pgrst last.
--
-- ROLLBACK: docs/evidence/SQIE-HQ/ROLLBACK-996.sql drops both functions. Never refuses (no data depends on them).
-- ====================================================================================================


-- ---- 1. per library version ---------------------------------------------------------------------

create or replace function public.ckri_library_item_stats(p_versions uuid[], p_min integer, p_round integer)
returns table (
  version_id uuid, suppressed boolean, learners integer, attempts integer, first_attempts integer, percent_correct integer,
  first_percent_correct integer, last_used date, missed_learners integer, option_counts jsonb, discrimination numeric, discrimination_n integer
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with params as (
    select greatest(5, coalesce(p_min, 10)) as floor_n,
           case when p_round in (1, 5, 10) then p_round else 5 end as round_to
  ),
  pop as (
    select distinct p.user_id from ckri_participation p
     where p.permission = 'collective_analytics' and p.scope_key = 'all' and p.status = 'granted'
  ),
  -- Every library copy of a consenting learner (all versions: the rest score needs their other items).
  copies as (
    select q.id as question_id, q.user_id, q.library_version_id as version_id, q.kind
      from individual_scholar_question q
     where q.library_version_id is not null and q.user_id in (select user_id from pop)
  ),
  att as (
    select c.version_id, c.user_id, c.kind, a.correct, a.answered_at, a.chosen_index
      from individual_scholar_attempt a join copies c on c.question_id = a.question_id
     where coalesce(a.marking, 'deterministic') <> 'unmarked'
  ),
  firsts as (
    select distinct on (version_id, user_id) version_id, user_id, kind, case when correct then 1 else 0 end as item, chosen_index
      from att order by version_id, user_id, answered_at, chosen_index
  ),
  learner_tot as (select user_id, sum(item) as s, count(*) as n from firsts group by user_id),
  wanted as (select distinct v as version_id from unnest(coalesce(p_versions, '{}'::uuid[])) as u(v)),
  agg as (
    select w.version_id,
           (select count(distinct a.user_id) from att a where a.version_id = w.version_id) as n_people,
           (select count(*) from att a where a.version_id = w.version_id) as n_att,
           (select count(*) from att a where a.version_id = w.version_id and a.correct) as n_ok,
           (select count(*) from firsts f where f.version_id = w.version_id) as n_first,
           (select count(*) from firsts f where f.version_id = w.version_id and f.item = 1) as n_first_ok,
           (select max(a.answered_at)::date from att a where a.version_id = w.version_id) as last_at,
           (select jsonb_object_agg(x.ci::text, case when x.n < pr.floor_n then null else (round(x.n::numeric / pr.round_to) * pr.round_to)::int end)
              from (select f.chosen_index as ci, count(*) as n from firsts f
              where f.version_id = w.version_id and f.kind = 'mcq' group by f.chosen_index) x) as opts,
           (select corr(f.item::double precision, ((t.s - f.item)::double precision / (t.n - 1)))
              from firsts f join learner_tot t on t.user_id = f.user_id where f.version_id = w.version_id and t.n >= 2) as r,
           (select count(*) from firsts f join learner_tot t on t.user_id = f.user_id where f.version_id = w.version_id and t.n >= 2) as r_n
      from wanted w cross join params pr
  )
  select g.version_id,
         g.n_people < pr.floor_n as suppressed,
         case when g.n_people < pr.floor_n then null else (round(g.n_people::numeric / pr.round_to) * pr.round_to)::int end,
         case when g.n_people < pr.floor_n then null else (round(g.n_att::numeric / pr.round_to) * pr.round_to)::int end,
         case when g.n_people < pr.floor_n then null else (round(g.n_first::numeric / pr.round_to) * pr.round_to)::int end,
         case when g.n_people < pr.floor_n or g.n_att = 0 then null else round(100.0 * g.n_ok / g.n_att)::int end,
         case when g.n_people < pr.floor_n or g.n_first = 0 then null else round(100.0 * g.n_first_ok / g.n_first)::int end,
         case when g.n_people < pr.floor_n then null else g.last_at end,
         case when g.n_people < pr.floor_n then null else (round((g.n_first - g.n_first_ok)::numeric / pr.round_to) * pr.round_to)::int end,
         case when g.n_people < pr.floor_n then null else g.opts end,
         case when g.n_people < pr.floor_n or g.r_n < pr.floor_n or g.r is null then null else round(g.r::numeric, 2) end,
         case when g.n_people < pr.floor_n then null else (round(g.r_n::numeric / pr.round_to) * pr.round_to)::int end
    from agg g cross join params pr
$$;


-- ---- 2. per question format ------------------------------------------------------------------------

create or replace function public.ckri_question_format_correctness(p_since timestamptz, p_min integer, p_round integer)
returns table (format text, source text, suppressed boolean, learners integer, attempts integer, correct integer, percent_correct integer)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with params as (
    select greatest(5, coalesce(p_min, 10)) as floor_n,
           case when p_round in (1, 5, 10) then p_round else 5 end as round_to
  ),
  pop as (
    select distinct p.user_id from ckri_participation p
     where p.permission = 'collective_analytics' and p.scope_key = 'all' and p.status = 'granted'
  ),
  att as (
    select case when q.kind = 'short' and jsonb_typeof(q.answer -> 'format') = 'string'
                 and (q.answer ->> 'format') ~ '^[a-z_]{2,40}$' then q.answer ->> 'format' else q.kind end as format,
           case when q.library_version_id is null then 'personal' else 'library' end as source,
           a.user_id, a.correct
      from individual_scholar_attempt a
      join individual_scholar_question q on q.id = a.question_id and q.user_id = a.user_id
     where a.user_id in (select user_id from pop)
       and a.answered_at >= coalesce(p_since, now() - interval '90 days')
       and coalesce(a.marking, 'deterministic') <> 'unmarked'
  ),
  agg as (
    select format, source, count(distinct user_id) as n_people, count(*) as n_att, count(*) filter (where correct) as n_ok
      from att group by format, source
  )
  select g.format, g.source, g.n_people < pr.floor_n,
         case when g.n_people < pr.floor_n then null else (round(g.n_people::numeric / pr.round_to) * pr.round_to)::int end,
         case when g.n_people < pr.floor_n then null else (round(g.n_att::numeric / pr.round_to) * pr.round_to)::int end,
         case when g.n_people < pr.floor_n then null else (round(g.n_ok::numeric / pr.round_to) * pr.round_to)::int end,
         case when g.n_people < pr.floor_n or g.n_att = 0 then null else round(100.0 * g.n_ok / g.n_att)::int end
    from agg g cross join params pr
   order by g.format, g.source
$$;


-- ---- 3. who may call them -----------------------------------------------------------------------------

revoke all on function public.ckri_library_item_stats(uuid[], integer, integer) from public;
revoke all on function public.ckri_question_format_correctness(timestamptz, integer, integer) from public;
do $grants$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.ckri_library_item_stats(uuid[], integer, integer) from anon';
    execute 'revoke all on function public.ckri_question_format_correctness(timestamptz, integer, integer) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.ckri_library_item_stats(uuid[], integer, integer) from authenticated';
    execute 'revoke all on function public.ckri_question_format_correctness(timestamptz, integer, integer) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.ckri_library_item_stats(uuid[], integer, integer) to service_role';
    execute 'grant execute on function public.ckri_question_format_correctness(timestamptz, integer, integer) to service_role';
  end if;
end
$grants$;

comment on function public.ckri_library_item_stats(uuid[], integer, integer) is
  'SQIE-CLOSE-2026-11 WS-G (996). Per library version, over learners with collective_analytics granted only, suppressed below greatest(5, p_min) learners, counts rounded to p_round. No identity, no content. Service role only.';
comment on function public.ckri_question_format_correctness(timestamptz, integer, integer) is
  'SQIE-CLOSE-2026-11 WS-G (996). Per question format and source (personal, library), over learners with collective_analytics granted only, suppressed below greatest(5, p_min) learners, counts rounded. Service role only.';

notify pgrst, 'reload schema';
