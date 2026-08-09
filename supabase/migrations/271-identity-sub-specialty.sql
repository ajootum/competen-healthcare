-- ============================================================
-- MIGRATION 271: SUB-SPECIALTY ON THE PRACTITIONER IDENTITY
-- PIS-000 s6, and the user's request of 2026-08-09
--
-- ----------------------------------------------------------------------------------------------------
-- The user, looking at their own published booking page: "can we add another fillable area apart from
-- Name etc, add sub-specialty".
--
-- A paediatric urologist is a paediatrician and a urologist and neither on its own, and `specialties`
-- alone cannot say that. It could be typed as one string -- "Paediatrics, Urology" -- and that is
-- precisely the thing worth avoiding: PIS-000 s9 resolves SEARCH by specialty, and two concepts in one
-- free-text box make that search progressively less useful as more practitioners join.
--
-- WARNING: THIS WIDENS WHAT A PUBLIC PAGE DISCLOSES, AND THAT IS THE ONLY REASON THIS FILE HAS A HEADER
-- THIS LONG. The identity screen tells a practitioner "These are the only fields your page shows", and
-- s6 is the list behind that sentence. Adding a field to it is a change to a promise, not a schema
-- convenience -- so it is done deliberately, in its own migration, rather than folded into another.
--
-- The sentence stays true because the field is added to the list the sentence describes. What must NOT
-- happen is a column that some other surface starts reading while the identity screen goes on claiming
-- its list is complete.
--
-- ---- WHY IT IS NOT `self_declared_sub_specialty` ---------------------------------------------------
--
-- Migration 270 introduced that prefix for five fields carried over from the retired profile table --
-- profession, registration number, registration body, expiry, practising since. They earned the prefix
-- because they sit BESIDE licence_verified_at and licence_verified_by, where an unprefixed
-- registration_number would read as verified.
--
-- Sub-specialty sits with `specialties`, `qualifications`, `biography` and `languages`: descriptive
-- prose a practitioner writes about themselves, next to other descriptive prose, with nothing verified
-- anywhere near it. Prefixing this one and not its four neighbours would suggest the neighbours are
-- verified, which is the opposite of true. Consistency with the row it joins is the safer signal.
--
-- Plain idempotent statements, ASCII only, no do-blocks, and no semicolon anywhere except ending a
-- statement -- including inside comments, which silently shredded two sections of migration 238 while
-- the editor still reported success.
-- ============================================================

-- ---- THE COLUMN ------------------------------------------------------------------------------------
--
-- Nullable and free text, exactly like `specialties` (218:65) which it sits beside. Not a closed
-- vocabulary: sub-specialty naming varies by country, college and decade, and a fixed list would be
-- wrong in Kampala within a year of being right somewhere else.
--
-- No length check, again matching `specialties`. The engine trims and the form bounds the input, and a
-- database limit that disagrees with the form limit produces a refusal a practitioner cannot act on.
alter table practice_practitioner_identity
  add column if not exists sub_specialty text;

comment on column practice_practitioner_identity.sub_specialty is
  'Self-declared, public. Shown on the practitioner booking page alongside specialties. Nothing verifies it.';

-- ---- WHAT THIS FILE DOES NOT DO --------------------------------------------------------------------
--
-- It does not make sub-specialty SEARCHABLE. PIS-000 s9 defines a search order -- exact handle, then
-- practitioner number, then display name, then surname, then specialty, then fuzzy -- and inserting a
-- new field into a ranked order is a decision about which practitioners surface first, not a column.
-- searchPractitioners is unchanged, and the field is stored and displayed only.
--
-- It also does not backfill anything. Every one of the 43 identities has a null sub-specialty, which
-- reads correctly as "not said" rather than as a blank somebody left.

alter table practice_practitioner_identity enable row level security;

notify pgrst, 'reload schema';
