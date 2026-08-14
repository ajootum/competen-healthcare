-- ====================================================================================================
-- 299  FOLLOW-UP OWNERSHIP, TYPE, PLACE AND PROVENANCE  (CPR-FUP-HFE-008 s11, s6, s18, s21)
-- ====================================================================================================
--
-- WHAT THIS DOES
--   s21's data model against what practice_follow_up actually carried. An obligation could say what
--   needs to happen, in which category, by when and how urgently -- and could not say WHO OWNS IT, how
--   it is meant to be fulfilled, where, or which piece of clinical work raised it. s11 opens with
--   "every trackable follow-up should have an accountable owner" and there was no column to put one in.
--
-- WARNING: THE TABLE IS EMPTY AT THE TIME OF WRITING, probed before this file was authored -- so every
--   default below lands on new rows only and no backfill is doing hidden work. If this is applied to a
--   database that has since gained rows, `follow_up_type` defaults them all to 'review', which is the
--   honest reading of a follow-up raised before the field existed: somebody intends to look at
--   something, and nothing has been arranged.
--
-- WARNING: TWO OF s21's ITEMS ARE DELIBERATELY REFUSED, AND THE REASONS MATTER MORE THAN THE COLUMNS.
--
--   1. NO GENERIC source_object_type / source_object_id PAIR. s21 asks for one. This table already
--      carries TYPED foreign keys for provenance -- origin_encounter_id, problem_id, diagnosis_id,
--      plan_id -- with real referential integrity and real delete behaviour. A polymorphic (type, id)
--      pair beside them would be a SECOND way to answer "what raised this", enforced by nothing: the
--      database cannot check that a row named 'investigation' points at an investigation, and cannot
--      cascade when that investigation is deleted. So the three missing origins get typed columns in
--      the same shape as the four that exist. s18's actual requirement -- "cross-tab creation should
--      reference ONE follow-up object rather than duplicate copies" -- is about not duplicating
--      follow-ups, and typed keys serve it better than a pointer nothing validates.
--
--   2. NO SEPARATE completed_by/at AND cancelled_by/at COLUMNS. s21 lists them. The table has
--      closed_at/closed_by plus `status`, and practice_follow_up_event holds an APPEND-ONLY row for
--      every transition with its note, protected by practice_follow_up_event_immutable(). Between them
--      they already answer who closed it, when, into which state, and why. Adding four more columns
--      would create a second place recording one fact, and the second place is the one that drifts --
--      this repository has the scars. A cancellation reason lives in the event note, which is the only
--      copy and cannot be rewritten.
--
-- WARNING: AN APPOINTMENT TYPE IS NOT A BOOKING. s10 and s13 are emphatic that Raised and Booked are
--   different states, and s22 makes "booking does not imply clinical completion" an acceptance
--   criterion. `follow_up_type = 'appointment'` says how somebody INTENDS this to be fulfilled. The
--   column that says a visit exists is `appointment_id`, it is set only by scheduleFollowUp, and
--   migration 196's trigger clears it if that appointment dies.
-- ====================================================================================================

-- ---- 1. OWNERSHIP -- s11 ----------------------------------------------------------------------------
--
-- Two columns because s11 permits two kinds of owner: "practitioner, permitted team member, role/queue
-- or configured owner". A person and a queue are different answers to "who is accountable", and one
-- text column holding either would need parsing to tell them apart.
--
-- No foreign key on assigned_to, matching created_by / closed_by / updated_by on this same table: user
-- identities live outside this schema and every uuid actor column here is unconstrained for that reason.
alter table practice_follow_up add column if not exists assigned_to uuid;
alter table practice_follow_up add column if not exists assigned_queue text;

alter table practice_follow_up drop constraint if exists practice_follow_up_assigned_queue_len;
alter table practice_follow_up add constraint practice_follow_up_assigned_queue_len
  check (assigned_queue is null or char_length(btrim(assigned_queue)) between 1 and 80);

-- WARNING: ONE OWNER, NOT TWO. An obligation assigned to a person AND a queue has no answer to "whose is
-- this", which is the only question the column exists to settle. Either, or neither, never both.
alter table practice_follow_up drop constraint if exists practice_follow_up_one_owner;
alter table practice_follow_up add constraint practice_follow_up_one_owner
  check (assigned_to is null or assigned_queue is null);

-- ---- 2. HOW IT IS MEANT TO BE FULFILLED -- s6, s10 --------------------------------------------------
alter table practice_follow_up add column if not exists follow_up_type text not null default 'review';
alter table practice_follow_up drop constraint if exists practice_follow_up_type_check;
alter table practice_follow_up add constraint practice_follow_up_type_check
  check (follow_up_type in ('appointment', 'review', 'contact', 'other'));

-- ---- 3. WHERE -- s6 ---------------------------------------------------------------------------------
--
-- Nullable and set null on delete: a facility that closes must not take its obligations with it, and a
-- follow-up with no location is the ordinary case for a practice with one site.
alter table practice_follow_up add column if not exists location_id uuid
  references practice_facility(id) on delete set null;

-- ---- 4. SUPPORTING INSTRUCTIONS -- s6 ---------------------------------------------------------------
--
-- Separate from `reason`, which s6 defines as the concise description of the owed action and migration
-- 196 caps at 400 characters. Instructions are what somebody should do about it, and squeezing both
-- into one field is how a 400-character limit starts truncating clinical detail.
alter table practice_follow_up add column if not exists instructions text;
alter table practice_follow_up drop constraint if exists practice_follow_up_instructions_len;
alter table practice_follow_up add constraint practice_follow_up_instructions_len
  check (instructions is null or char_length(btrim(instructions)) between 1 and 2000);

-- ---- 5. WHAT WAS CHOSEN, NOT ONLY WHAT IT RESOLVED TO -- s9, s21 ------------------------------------
--
-- The composer offers an interval and the engine turns it into a date. Only the date was kept, so
-- "in two weeks" and "on the 28th" became indistinguishable the moment they were saved -- and s9 asks
-- for the interval to be part of the record.
--
-- WARNING: A SNAPSHOT, WITH NO FOREIGN KEY, DELIBERATELY. practice_follow_up_interval is a catalogue somebody
-- may edit or prune, and migration 196 writes the LABEL down rather than joining for exactly this
-- reason elsewhere. A key here would let a deleted interval row rewrite or block a historical record.
alter table practice_follow_up add column if not exists target_interval_code text;
alter table practice_follow_up drop constraint if exists practice_follow_up_interval_code_len;
alter table practice_follow_up add constraint practice_follow_up_interval_code_len
  check (target_interval_code is null or char_length(btrim(target_interval_code)) between 1 and 20);

-- ---- 6. THE THREE MISSING ORIGINS -- s18 ------------------------------------------------------------
--
-- Typed, in the same shape as origin_encounter_id / problem_id / diagnosis_id / plan_id. See the second
-- warning at the top for why these are not a generic pointer.
--
-- on delete set null throughout: deleting the investigation that prompted a review must not delete the
-- obligation to do the review. The follow-up loses its provenance and keeps its meaning.
alter table practice_follow_up add column if not exists investigation_id uuid
  references practice_encounter_investigation(id) on delete set null;
alter table practice_follow_up add column if not exists procedure_id uuid
  references practice_procedure(id) on delete set null;
alter table practice_follow_up add column if not exists treatment_id uuid
  references practice_treatment(id) on delete set null;

-- ---- 7. INDEXES -------------------------------------------------------------------------------------
--
-- "What is assigned to me" is the question s11 exists to make answerable, so it gets the index. Partial
-- on purpose and NOT unique -- the house rule bans partial UNIQUE indexes because they are silent
-- upsert targets. A partial ordinary index is just a smaller index.
create index if not exists idx_practice_followup_owner
  on practice_follow_up(workspace_id, assigned_to, status) where assigned_to is not null;
create index if not exists idx_practice_followup_queue
  on practice_follow_up(workspace_id, assigned_queue, status) where assigned_queue is not null;
-- Provenance lookups: "did this investigation raise anything", asked from the tab that created it.
create index if not exists idx_practice_followup_investigation
  on practice_follow_up(investigation_id) where investigation_id is not null;
create index if not exists idx_practice_followup_procedure
  on practice_follow_up(procedure_id) where procedure_id is not null;
create index if not exists idx_practice_followup_treatment
  on practice_follow_up(treatment_id) where treatment_id is not null;

notify pgrst, 'reload schema';
