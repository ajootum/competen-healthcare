-- ============================================================
-- MIGRATION 183: LEARNING COMPLETION PROVENANCE (XWI P2-8)
--
-- The gap: /api/learning/pathway-items lets a clinician set their own item to 'completed'. No evidence, no
-- second party, no timestamp, no audit row. That on its own is defensible -- reading a policy or watching a
-- video IS self-attested, and pretending otherwise would just push people outside the system.
--
-- What is NOT defensible is that the record cannot tell the two apart. src/lib/super-admin/gov-compliance.ts
-- reads exactly this column and publishes "Training (pathway items done)" as a COMPLIANCE PERCENTAGE, on the
-- same panel as audit compliance, which is externally measured. A number nobody has checked is presented
-- with the same authority as one somebody has.
--
-- So this migration does not restrict anything. It makes provenance recordable, so the compliance figure can
-- stop conflating "I ticked a box" with "someone verified it".
--
--   completion_method  HOW the learner completed it -- self_attested is a first-class, allowed value
--   evidence_id        optional link to the evidence store when the learner filed something
--   verified_by/at     the SECOND-PARTY check, deliberately separate from method: an educator verifying a
--                      self-attested item is a different fact from the learner having filed evidence
--
-- NULL completion_method means UNRECORDED, not self_attested -- "we do not know who checked" is its own
-- state and backfilling it to a specific method would be inventing a fact. No backfill is needed anyway:
-- both live pathway_items rows are 'pending', so there is no completed row whose provenance is unknown.
--
-- Plain statements, idempotent, no do-blocks, ASCII only.
-- ============================================================

alter table pathway_items add column if not exists completed_at       timestamptz;
alter table pathway_items add column if not exists completion_method  text;
alter table pathway_items add column if not exists evidence_id        uuid references evidence(id) on delete set null;
alter table pathway_items add column if not exists verified_by        uuid references profiles(id) on delete set null;
alter table pathway_items add column if not exists verified_at        timestamptz;
alter table pathway_items add column if not exists verification_note  text;

-- Constraint added separately from the column so re-running is safe on a table that already has it.
alter table pathway_items drop constraint if exists pathway_items_completion_method_check;
alter table pathway_items add  constraint pathway_items_completion_method_check
  check (completion_method is null or completion_method in ('self_attested', 'evidence', 'course', 'assessment'));

create index if not exists idx_pathway_items_completion on pathway_items(status, completion_method);
create index if not exists idx_pathway_items_verified   on pathway_items(verified_at) where verified_at is not null;

notify pgrst, 'reload schema';
