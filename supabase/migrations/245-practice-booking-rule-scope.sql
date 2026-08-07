-- ============================================================
-- MIGRATION 245: THE RULE SCOPE INDEX LEARNS WHAT A SCOPE IS NOW
-- CPR-V5-007 s7.2, s11
--
-- ----------------------------------------------------------------------------------------------------
-- Migration 230 wrote ux_practice_booking_rule_scope over
-- (workspace_id, location_id, appointment_type) WHERE active, with a comment that is still exactly
-- right about WHY: "Two rules for the same location and type would make 'most specific wins'
-- ambiguous, and the tie would be broken by row order -- which is to say, arbitrarily."
--
-- What changed is not the reasoning. It is what a scope CONSISTS OF. Migration 244 gave a rule a
-- session, a channel and a priority, so s7.2's scope is now five things where 230 knew of two -- and an
-- index over the old two forbids arrangements the specification requires:
--
--   s7.2   a rule may name a SESSION. A Friday clinic rule and a Monday clinic rule at one hospital,
--          for the same appointment type, are two ordinary rules. The old index calls them a duplicate.
--   s7.3   a rule may name a CHANNEL. "Staff may book this at two hours' notice, patients at two days"
--          is one scope with two policies, and is the example s7.3 exists for.
--   s11    "At equal specificity, explicit priority determines the winner." That sentence PRESUMES two
--          active rules can share a scope and differ only in priority. Under the old index they cannot,
--          so the clause described a state the database forbade.
--
-- Phase 3 worked around this by writing card rules with `active` FALSE and treating `status` as the
-- authority. That kept the index satisfied and had a real cost, stated on screen at the time: the
-- calendar's quick-book path (availability-config.ts resolveBookingRule) filters on `active`, so it
-- could not see card rules at all. This migration removes the reason for the workaround.
--
-- WARNING: PRIORITY IS IN THE KEY, AND THAT IS THE INTERESTING PART.
--
-- Including it is what makes the database enforce s11's LAST clause rather than merely permit it: "At
-- equal specificity and priority, activation is blocked until the conflict is resolved." Two active
-- rules with the same scope and DIFFERENT priorities are legal and the higher wins. Two with the same
-- scope and the SAME priority are the ambiguity 230 was protecting against, and they are still refused
-- -- now by the same index, for the same reason, at the right granularity.
--
-- Plain idempotent statements, ASCII only, no plpgsql, no do-blocks, and no semicolon anywhere except at
-- the end of a statement -- the runner splits on them, and a semicolon inside a comment silently drops
-- the statements around it while still reporting success. That happened on migration 238.
-- ============================================================

-- ---- 1. THE WIDER SCOPE ----------------------------------------------------------------------------
--
-- coalesce on every nullable part, because in an index NULL is distinct from NULL: without it, two rules
-- that both leave `channel` empty would not collide, and "no channel" is the most common scope of all.
-- That is 230's own device, extended to the three columns 244 added.
--
-- THE PREDICATE MOVES FROM `active` TO `status`. 244 made `status` the four-state authority
-- (draft/active/paused/archived) and `active` a two-state legacy mirror. A DRAFT rule must not collide
-- with the live rule it is being drafted to replace -- which is the whole point of having a draft state
-- -- and under `where active` it would, the moment somebody set the flag.
drop index if exists ux_practice_booking_rule_scope;

create unique index if not exists ux_practice_booking_rule_scope
  on practice_booking_rule(
    workspace_id,
    coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(appointment_type, '*'),
    coalesce(session_template_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(channel, '*'),
    priority
  )
  where status = 'active';

-- ---- 2. THE LEGACY FLAG STAYS, AND STAYS HONEST ----------------------------------------------------
--
-- `active` is NOT dropped. availability-config.ts, the legacy availability console and the slot
-- generator all read it, and migration 241 is a recent reminder that removing a column with live
-- readers is its own piece of work rather than a tidy-up at the end of somebody else's.
--
-- What this does is let the two agree again. With the index no longer keyed on `active`, the booking
-- rules engine can set it true alongside `status = 'active'` -- so the calendar's quick-book path sees
-- card rules, which is the behaviour Phase 3 had to give up.
--
-- The backfill below is deliberately NARROW: only rules the card engine wrote (they have a name, which
-- nothing before 244 set) and only where status already says active. A blanket update would resurrect
-- rules somebody had deliberately switched off before any of this existed.
update practice_booking_rule
set active = true
where status = 'active' and active = false and name is not null;

-- ---- 3. RLS ----------------------------------------------------------------------------------------
alter table practice_booking_rule enable row level security;

notify pgrst, 'reload schema';
