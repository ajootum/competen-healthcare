# CFCA-STUDIO-P1: migration 660 build record (29 Oct 2026)

- **Instruction:** owner instruction CFCA-STUDIO-P1, over the baseline `CFCA-REVIEW-01-REPORT.md`.
- **Branch:** `cfca/studio-p1`, from main `c761215d`.
- **Migration:** `supabase/migrations/660-cfca-studio-p1.sql`, sha256 `c8e0bb4d015fbff4ee568de16da1451ddc18b357121e543c3581a11526bb995c`.
- **Rollback (staging only):** `docs/evidence/CFCA-STUDIO-P1/ROLLBACK-660.sql`, sha256 `6bbcafed991dcedce0576e902ac911ae68de96b3290fd2b039aca2296e25984b`.

## State
- **State 2: applied and verified on staging.**
- **Production: NOT applied.** It needs a separate owner GO, the recovery reference, and the owner applying it by hand.
- **Code with 660 absent:** every new page says "migration 660 is not applied here" and offers nothing. The Scholar read and the publication snapshot fall back to the entry columns they read before 660, so main is safe on a database without 660.

## Application order and dependencies
- **Order:** 660 alone. It is numbered after 650 because it adds to tables from 007, 013, 384, 387 and 394. All of those are in production.
- **Dependencies:** none on 640, 641 or 650.

## What it adds (additive only)
1. **Qualification levels.** A `qualification_level` taxonomy with 5 terms. A nullable `individual_scholar_programme.qualification_term_id`, with a guard trigger that refuses any term of another kind.
2. **Programme overlay.** `competency_catalogue_entry.requirement` (required / recommended / optional, default required) and `expected_level_id`. These are frozen outside draft by the existing 394 trigger.
3. **CCHU components:**
   - `competency_assessment_component` (Clinical Skills, Knowledge, Knowledge Application).
   - `competency_catalogue_entry_component` (pass level, mandatory, safety-critical, weight). A safety-critical component must be mandatory (CHECK), and the guard trigger freezes the rows with their catalogue.
4. **DACUM 0-6.** A new scale with 7 levels, not the default. Benner 0-6 is untouched and stays the default.
5. **Stages and mappings:**
   - `competency_stage` (6 stages).
   - `competency_stage_mapping` (versioned: draft, published or retired, hashed when published).
   - `competency_stage_mapping_band`.
   - **Triggers:**
     - Bands are frozen outside draft.
     - A level must belong to its mapping's scale.
     - The author cannot publish.
     - Every level must have a stage before publication.
     - Publishing retires the previous version.
     - A published or retired version is never edited or deleted.
   - **DACUM v1** is seeded as the owner approved it and published on that recorded approval: 0 Unstaged, 1-2 Novice, 3 Advanced Beginner, 4 Competent, 5 Proficient, 6 Expert.
6. **NUR-FOUND.** A draft shared catalogue (profession layer, Nursing) naming every Core Nursing competency as an unreviewed reference. It copies nothing, and Core Nursing is not written.

RLS is on, with no policy, for all 5 new tables. No existing row is updated or deleted.

## Staging (ezhvpgtcqcdsgylrxgdb)
- **Pre-state:** 20 frameworks (4 classified), 319 competencies, 4 framework versions, 1 scale with 7 levels, 14 catalogue entries, 24 taxonomy terms.
- **First apply:** committed. Verification:
  - 5 qualification terms
  - 7 DACUM levels
  - Benner still the default
  - 6 stages
  - DACUM v1 published, hash `23525c25898da74d89a653c446571b05`
  - 3 components
  - NUR-FOUND draft with 93 entries
  - 5 tables with RLS and no policy
- **Rollback rehearsal:** `ROLLBACK-660.sql` committed. The pre-state counts above returned exactly.
- **Apply twice:** both committed. Identical verification, including the same DACUM v1 hash. This shows it is idempotent.
- **Acceptance:** `scripts/staging-cfca-studio-p1.ts` (output in `staging-acceptance-output.txt`): ALL GREEN.
  - F1-F3: programme-specific filtering through the HQ preview.
  - G1: the safety-critical CHECK.
  - G2: freeze in review.
  - G3: mapping SoD, completeness and immutability.
  - The script removes what it creates.

## Tests
- **New vitest:**
  - `src/lib/competency/studio-p1.test.ts`: the roll-up rule, the DACUM mapping, `pickOverlay`, and the 660 guards read from the file.
  - `src/lib/individual/programme-framework.test.ts`: filtering over one shared catalogue, and the not-offered reasons.
- **Affected suites:** 30 files, 330 tests, all passing.
- **Harnesses:** `scripts/ci-harnesses.ts` 67/67. Plus competency-foundation 33/0, individual-foundation 74/0, scholar-learning 160/0, plane-boundary 35/0, auth-boundary green, clinical-review 25/0, hq-nav-registry 32/0.
- **K2 change in scholar-learning:** it now pins the overlay-aware narrowing (the programme's own catalogues only), with a new planted violation that goes red.
- **Other checks:** `tsc` clean, eslint clean on the changed files.
