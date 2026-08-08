-- ============================================================
-- MIGRATION 266: NARROWING WHAT THE AUDIT CAPABILITY INVITES
-- docs/PLAT-OVERSIGHT-SURVEY-001.md, and the oversight decision of 2026-08-08
--
-- ----------------------------------------------------------------------------------------------------
-- Migration 264 seeded an HQ capability like this:
--
--   ('hq.platform.audit.view', 'platform', 'Global Audit Centre', 'Cross-plane audit trail')
--
-- It grants nothing today. There is no reader behind it, and no appointment holds it -- ogs_office_
-- appointments is empty. So this migration changes no access whatsoever.
--
-- WARNING: WHAT IT CHANGES IS AN INSTRUCTION. "Cross-plane audit trail" reads to the next engineer as a
-- brief: wire this to every audit store on the platform. One of those stores is practice_audit_event, and
-- its payloads are not metadata. They carry medication generic names beside patient ids, procedure labels
-- with laterality, and clinician free text. A single reader honouring that description would expose
-- clinical content across every practice on the platform, in one change, to whoever held a platform
-- position -- and it would look like implementing the spec rather than breaching it.
--
-- The decision behind the correction: platform staff see THAT a practice is being used, not WHAT was
-- written in it. Clinical content is reached by a practitioner-granted or break-glass path that records
-- itself, and neither of those exists yet. A capability whose description outruns the controls behind it
-- is how the gap gets closed in the wrong direction.
--
-- WARNING: A DESCRIPTION IS NOT A CONTROL, AND THIS FILE DOES NOT PRETEND OTHERWISE. Nothing here stops a
-- future reader joining practice_audit_event -- RLS on practice_* is enabled with ZERO policies and every
-- platform page holds the service-role client, so the database will not refuse it. What stops it has to
-- be an assertion over the import graph, which the survey specifies and which is not in this migration.
-- This narrows the invitation. The control is separate work and is not done.
--
-- Plain idempotent statements, ASCII only, no do-blocks, and no semicolon anywhere except ending a
-- statement -- including inside comments, which silently shredded two sections of migration 238 while the
-- editor still reported success.
-- ============================================================

-- ---- THE CORRECTION --------------------------------------------------------------------------------
--
-- An UPDATE rather than an amended INSERT: 264 seeds with `on conflict do nothing`, so editing that file
-- alone would leave the live row untouched and only affect a fresh replay. 264's text is corrected too,
-- so a replay and this database end up saying the same thing.
--
-- Keyed on the code and guarded on the old text, so re-running this file cannot overwrite a description
-- somebody has since improved.
update hq_capability
   set description = 'Platform-plane audit only: plat_audit_events, provisioning and access records. NOT practice_audit_event, whose payloads carry clinical content. Reading that needs a practitioner-granted or break-glass path that records itself.'
 where code = 'hq.platform.audit.view'
   and description = 'Cross-plane audit trail';

alter table hq_capability enable row level security;

notify pgrst, 'reload schema';
