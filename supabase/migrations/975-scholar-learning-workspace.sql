-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains one SQL marker function between dollar quotes.
-- ====================================================================================================
-- MIGRATION 975: COMPETEN SCHOLAR -- THE LEARNING WORKSPACE (SALE-2026-11 R3, rows SALE-11 and SALE-12)
--
-- Owner directive SALE-2026-11 (4 Nov 2026) section 8 and the owner GO to build R3 before pilot use. Additive only: two
-- widened CHECKs and one marker function. No table, no column, no row written.
--
-- 1. NEXT-BEST-ACTION DECISIONS (SALE-11). The 840 plan event log keeps the learner own choices about My Plan. A
--    next-best-action suggestion (review a misconception, a short retrieval exercise, apply it in a case, continue an
--    unfinished lesson, revisit a prerequisite) can be accepted, snoozed or dismissed, and each choice is recorded. The
--    840 kind CHECK is re-added with one more kind, next_action, and with every other part unchanged. Its status is the
--    840 vocabulary: accepted (added to the learner own calendar), deferred (snoozed until a date) or declined (dismissed
--    until the evidence behind it changes). value holds the evidence fingerprint, the date and the calendar entry id,
--    within the 840 limit of 8000 bytes. Nothing is ever applied to the plan except by the learner own accept.
--
-- 2. PERSONAL SUMMARIES (SALE-12). The 820 note kind CHECK is re-added with one more kind, summary: the learner own
--    summary of a saved teaching, a lesson, a material or a section, in their own words. Like a note it has a body of
--    1 to 4000 characters and no quote. Every 820 rule for note, bookmark and highlight is unchanged, and so are the
--    target CHECK, the composite foreign keys, the bookmark index and the full-text column (a summary is searched
--    like a note).
--
-- 3. THE MARKER. individual_scholar_workspace_975() returns true. The application asks it once (one RPC) to know that
--    975 is applied, because a widened CHECK cannot be seen by a plain select. SECURITY INVOKER, reads nothing,
--    executable by service_role only.
--
-- PRIVATE AND ERASABLE. Both tables keep their 840 and 820 RLS (read own) and their cascades from profiles. Nothing
-- here is read by Professional, by any employer surface or by the HQ plane.
--
-- APPLY ON STAGING ONLY. NOT AUTHORISED FOR PRODUCTION without a separate owner GO. Depends on 820 and 840.
-- Re-running it is a no-op. Rollback: docs/evidence/SALE-R3/ROLLBACK-975.sql (refuses while any next_action event or
-- any summary note exists).
--
-- FAIL CLOSED WITHOUT IT. The marker is absent, so the server offers no accept, snooze or dismiss (the suggestions are
-- still shown, read only, and nothing is recorded) and no summary form, and the routes answer 409.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. No partial unique index. notify pgrst last.
-- ====================================================================================================

-- ---- 1. THE 840 PLAN EVENT KIND, WITH next_action ------------------------------------------------------

alter table individual_learning_plan_event drop constraint if exists individual_learning_plan_event_check;
alter table individual_learning_plan_event add constraint individual_learning_plan_event_check
  check (experience in ('scholar', 'professional')
     and kind in ('proposal', 'topic_postponed', 'recommendation_declined', 'reflection', 'settings_change', 'auto_adjust', 'next_action')
     and char_length(ref) between 1 and 200
     and (status is null or status in ('accepted', 'declined', 'deferred', 'applied', 'undone'))
     and jsonb_typeof(value) = 'object'
     and octet_length(value::text) <= 8000);

-- ---- 2. THE 820 NOTE KIND, WITH summary ----------------------------------------------------------------

alter table individual_scholar_note drop constraint if exists individual_scholar_note_kind_check;
alter table individual_scholar_note add constraint individual_scholar_note_kind_check
  check (kind in ('note', 'bookmark', 'highlight', 'summary')
     and (kind <> 'note' or (body is not null and char_length(btrim(body)) between 1 and 4000 and quote is null))
     and (kind <> 'summary' or (body is not null and char_length(btrim(body)) between 1 and 4000 and quote is null))
     and (kind <> 'bookmark' or (body is null and quote is null))
     and (kind <> 'highlight' or (quote is not null and char_length(btrim(quote)) between 1 and 500
          and (body is null or char_length(btrim(body)) between 1 and 4000))));

-- ---- 3. THE MARKER -------------------------------------------------------------------------------------

create or replace function public.individual_scholar_workspace_975()
returns boolean
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select true
$$;

revoke all on function public.individual_scholar_workspace_975() from public;
revoke all on function public.individual_scholar_workspace_975() from anon, authenticated;
grant execute on function public.individual_scholar_workspace_975() to service_role;

notify pgrst, 'reload schema';
