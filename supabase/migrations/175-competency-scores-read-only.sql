-- ============================================================
-- MIGRATION 175: MAKE THE "VIEWS COMPETENCY SCORES" POLICY ACTUALLY VIEW-ONLY
--
-- Found by the write-surface section of scripts/rls-drift-audit.ts. The policy is named
-- "Hospital staff views competency scores" and its command is ALL. `views`. So it grants INSERT, UPDATE
-- and DELETE to every profile sharing a hospital with the score's cycle -- which means a logged-in nurse
-- could raise their own competency score directly through the API, bypassing the assessment engine
-- entirely. Nothing in a code review would catch it: the name says read, and nobody reads the cmd column.
--
-- NOT AN ANONYMOUS HOLE. The predicate calls auth.uid(), so an unauthenticated request fails it. This is
-- an integrity problem, not an exposure one, and it needs a logged-in account to use.
--
-- SAFE TO NARROW: every access to competency_scores in the codebase goes through the service-role client
-- -- the scoring engine and /api/scoring/skills write it, admin/workforce and the educator validate routes
-- read it. There is no user-client reader or writer, so removing the write grant removes nothing the
-- application uses.
--
-- The predicate is preserved exactly and the policy keeps doing what its name always claimed. Renamed to
-- the house convention so the repo and the database agree, and scoped to authenticated rather than PUBLIC
-- since anon could never satisfy it anyway.
--
-- Plain statements, idempotent, no do-blocks.
-- ============================================================

drop policy if exists "Hospital staff views competency scores" on competency_scores;
drop policy if exists competency_scores_staff_read on competency_scores;

create policy competency_scores_staff_read on competency_scores
  for select to authenticated
  using (
    exists (
      select 1
      from competency_cycles c
      join profiles p on p.hospital_id = c.hospital_id
      where c.id = competency_scores.cycle_id
        and p.id = auth.uid()
    )
    or current_user_is_super_admin()
  );

notify pgrst, 'reload schema';
