-- ============================================================
-- MIGRATION 229: CLINIC HOURS (CPR-001 v4 "Clinic hours configurable")
--
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
-- THE COMP DRAWS "Clinic: 08:00 AM - 05:00 PM  [In Progress]" WITH A PROGRESS BAR ACROSS THE DAY.
--
-- That bar is the one element of the hero briefing that cannot be derived from anything already stored.
-- Everything else on it -- patients today, follow-ups, results waiting, the estimated finish -- comes
-- out of the diary. But "the clinic runs 08:00 to 17:00" is a fact about how a practice WORKS, and no
-- appointment implies it: a day with one 14:00 booking does not mean the clinic opens at two.
--
-- Hardcoding 08:00-17:00 would have been the easy version and would be wrong for every practice that
-- runs an evening surgery, and silently wrong -- the bar would simply show them finishing late every
-- single day. The specification asks for it to be configurable, so it is a column.
--
-- STORED AS LOCAL WALL-CLOCK MINUTES, NOT AS A TIMESTAMP. "Opens at 08:00" is true on every date; an
-- instant is true once. The practice's timezone turns it into an instant at read time, the same way
-- CPR-140 and CPR-300 already derive today from practice_workspace.timezone.
-- ────────────────────────────────────────────────────────────────────────────────────────────────────

alter table practice_configuration add column if not exists clinic_opens_minute integer
  not null default 480 check (clinic_opens_minute between 0 and 1439);

alter table practice_configuration add column if not exists clinic_closes_minute integer
  not null default 1020 check (clinic_closes_minute between 1 and 1440);

-- A clinic that closes before it opens is not a night shift, it is a typo. Night work is representable
-- as a later opening; a wrapped window would make every derived figure on the briefing meaningless.
alter table practice_configuration drop constraint if exists practice_configuration_clinic_window_check;
alter table practice_configuration add constraint practice_configuration_clinic_window_check
  check (clinic_closes_minute > clinic_opens_minute);

-- ---- The days the practice actually runs a clinic ------------------------------------------------
--
-- ISO weekday numbers (1 = Monday .. 7 = Sunday), defaulting to Monday-Friday. The comp's weekly
-- locations panel draws five rows; drawing five rows for a practice that also works Saturdays would
-- hide a whole working day, and drawing seven for one that does not would suggest empty days are a gap.
alter table practice_configuration add column if not exists clinic_days integer[]
  not null default array[1,2,3,4,5];

notify pgrst, 'reload schema';
