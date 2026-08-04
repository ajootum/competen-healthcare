-- ============================================================
-- MIGRATION 225: STRUCTURED NAME PARTS (CPR-PRM-001 s4)
--
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
-- THE PARTS ARE OPTIONAL STRUCTURE OVER AN AUTHORITATIVE WHOLE. display_name STAYS NOT NULL.
--
-- s4 asks for "Identity (First, Middle, Last Name)", and the obvious reading -- replace display_name
-- with three columns -- would break this product in two ways, one technical and one that matters more.
--
-- TECHNICAL: name_normalised is GENERATED from display_name and duplicate detection keys on it
-- (migration 193). Three separate columns would need three generated columns and a rewritten matcher,
-- and every existing patient would have a null name until somebody split it by hand.
--
-- THE ONE THAT MATTERS: MONONYMS ARE REAL. A patient known only as "Nakato" has one name, not a missing
-- middle and a missing surname. So do people with two names and no middle, people whose family name
-- comes first, and people whose legal name simply does not decompose the way a form expects. A
-- registration form that REQUIRES three parts cannot register those people at all -- and the failure
-- lands on the person at the desk, who then types something untrue into a box to get past it.
--
-- So: display_name remains the authoritative single field and stays NOT NULL. The parts are recorded
-- when they are known, display_name is composed from them when they are supplied, and a patient with
-- one name is registered with one name.
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
--
-- NOTHING ELSE IS NEEDED FOR WHAT THE FORM NOW COLLECTS. practice_appointment.reason has existed since
-- migration 192, and the guardian details go to practice_patient_relationship (migration 221) -- so
-- "reason for visit" and "set an appointment" required no schema at all, only wiring.
--
-- Plain idempotent statements, ASCII only, no do-blocks, no plpgsql -- survives any splitter.
-- ============================================================

alter table practice_patient add column if not exists given_name text;
alter table practice_patient add column if not exists middle_name text;
alter table practice_patient add column if not exists family_name text;

-- Searchable on the parts as well as the whole, so "find every Okello" works whether the name was
-- entered as three fields or as one.
create index if not exists idx_practice_patient_family_name
  on practice_patient(workspace_id, lower(family_name)) where family_name is not null;
create index if not exists idx_practice_patient_given_name
  on practice_patient(workspace_id, lower(given_name)) where given_name is not null;

-- NO CHECK REQUIRING THE PARTS TO AGREE WITH display_name. They are composed from the parts on the way
-- in, and a later correction to one should not be refused because it disagrees with a string assembled
-- months earlier -- the record is what somebody typed, not a derivation nobody can override.

notify pgrst, 'reload schema';
