-- ============================================================
-- MIGRATION 174: STOP SERVING FOUR TABLES TO UNAUTHENTICATED VISITORS
--
-- Found by scripts/anon-exposure-harness.ts, which probes every table in the public schema with the
-- PUBLIC anon key. These four are not drift -- their policies match the repo exactly. They were declared
-- this way ("Anyone can view ...", applying to PUBLIC, which includes anon) and have been doing precisely
-- what they say ever since. The declaration is the problem.
--
-- THE ONE THAT MATTERS IS `questions`. An unauthenticated request returns published questions WITH
-- correct_answer and explanation: 34 answer keys, no login. The application never needed that policy --
-- every read of `questions` in the codebase goes through the service-role client, and the candidate-facing
-- page deliberately selects only (id, content, options) while grading fetches correct_answer server-side
-- in /api/quiz/attempt. So the public policy granted nothing to the app and everything to everyone else.
-- It is dropped outright rather than narrowed: with no user-client reader, an authenticated read policy
-- would still hand every logged-in user the whole answer key.
--
-- The other three are catalogue data and are NARROWED to authenticated rather than dropped, because
-- `courses` genuinely is read through the user client (dashboard/courses/[id]), and reference data has a
-- plausible client reader in future. Nothing about the app changes; anonymous access stops.
--
-- Policy names change from prose to the house convention, so the repo and the database agree afterwards.
--
-- Plain statements, idempotent, no do-blocks.
-- ============================================================

-- questions: no user-client reader exists; service role only from here.
drop policy if exists "Anyone can view published questions" on questions;

-- courses: read by dashboard/courses/[id] through the user client, so it keeps a read policy.
drop policy if exists "Anyone can view published courses" on courses;
drop policy if exists courses_read_published on courses;
create policy courses_read_published on courses for select to authenticated using (is_published = true);

-- competencies: reference catalogue.
drop policy if exists "Anyone can view competencies" on competencies;
drop policy if exists competencies_read on competencies;
create policy competencies_read on competencies for select to authenticated using (true);

-- benner_scale: reference scale.
drop policy if exists "Anyone reads benner scale" on benner_scale;
drop policy if exists benner_scale_read on benner_scale;
create policy benner_scale_read on benner_scale for select to authenticated using (true);

notify pgrst, 'reload schema';
