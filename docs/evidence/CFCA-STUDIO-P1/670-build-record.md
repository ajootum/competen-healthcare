# CFCA-STUDIO-P1: migration 670 and the NUR-CCF draft import, build record (29 Oct 2026)

- **Instruction:** owner GO "CFCA-STUDIO-P1, Nursing Framework Criteria Import", over `WORK-FRAMEWORK-RECONCILIATION.md`.
- **Branch:** `cfca/criteria-import`, from main `7d6614ca`.
- **Migration:** `supabase/migrations/670-cfca-criteria-components.sql`, sha256 `9f8cc5e8b42b9390efd714dad1e2795e9e8116a5e5eb931094a871f282aac471`.
- **Rollback (staging only):** `docs/evidence/CFCA-STUDIO-P1/ROLLBACK-670.sql`.

## State
- **State 2: applied and verified on staging. Production: NOT applied.** It needs a separate owner GO, and the owner applies it.
- **Before 670:** the code reads skills without the new columns, and the review page shows the plain skill list as before.

## What 670 does (additive)
1. **Classifies criteria.** It adds nullable `competency_skills.component_code` (references `competency_assessment_component`, 660) and `source_ref` (at most 300 characters).
2. **Widens the 395 content hash.** A skill hashes as `name [component]` only when a component is set. Untagged skills hash exactly as before, so no existing hash or approval changes.
3. **Sets the DACUM 0-6 wording.** The level labels become the source descriptors ("Adapted from DACUM level of Achievement, Fearon 1998"). This applies only where a label is still the 660 seed. Scores, pass marks and the published DACUM v1 mapping are untouched.

## Code
- **`importDraftPackage`** (`src/lib/competency/authoring.ts`) now carries:
  - **criteria:** `{ component, text, sourceRef }`, each one skill row, in order, source wording kept (trimmed only), at most 300 per competency. Learning outcomes are not used.
  - **parents:** `{ framework, competency, frameworkId? }`, linked by a Holdings-scope `inherited` dependency, so the parent is never written.
  - **a profession named by value.**
- **Fail closed before any write.** Components, parents and the profession are resolved first, so an unknown or ambiguous one changes nothing.
- **Timeout.** The authoring route allows 60 seconds for the one-request import.
- **Authoring view** (`authoring-view.ts`, page): each competency's criteria, grouped by component.
- **Clinical review queue** (`clinical-review-hq.ts`, page):
  - The criteria by component are shown for CURRENT versions only. The hash, which covers each criterion and its tag, must still match, so they are exactly what is approved.
  - A stale version is not offered.
- **`scripts/build-nur-ccf-package.ts`** builds the package and the flag report from the workbook.
- **`scripts/staging-nur-ccf-import.ts`** is the staging rehearsal, with validation V1-V6.

## Source
- **File:** `CCHU Nursing Practice Competency Assessment.xlsx`, sheet "CCHU Competency Assessment", sha256 `18359bae...c301820`, Sep 2025.
- **Contents:** 30 areas and 458 criteria (Clinical Skills 194, Knowledge 174, Knowledge Application 90), in 13 domains, with 31 parent links to 18 existing shared competencies.
- **Cross-check:** an independent parse of the same sheet matches the package criterion for criterion (458/458, 0 mismatches).
- **Flags for clinical review:** `NUR-CCF-source-flags.md`, 15 flags and 12 sub-item joins. Nothing was rewritten.

## Staging (ezhvpgtcqcdsgylrxgdb)
- **670 rehearsal:** applied, rolled back, then applied twice. Each run was committed with identical results.
- **Hash neutrality:**
  - The 395 form and the 670 form of the hash agree on all 319 competencies (0 differ).
  - The staging content fingerprint moved once between the pre-read and the first apply. Staging has no skills, the two forms agree, and no audit or created row explains the move, so staging data changed outside this work. It was stable on every later read.
  - Production is checked by its own before/after fingerprint.
- **Import rehearsal** (the real `importDraftPackage`): 30 competencies, 458 criteria. **V1-V6 ALL GREEN:**
  - all 30 areas present as one draft framework;
  - every criterion exact, with its component and source;
  - links correct;
  - 0 of 319 existing hashes changed;
  - the authoring view shows all 458 criteria by component;
  - nothing offered, all "not clinically reviewed".
- **Staging limits on parent links.** Staging holds two "Core Nursing" frameworks and does not mirror production's specialty frameworks. The rehearsal settled Core Nursing to its oldest framework and linked the 7 parents that exist on staging. The production parents are proven read-only: all 18 resolve exactly once.

## Tests
- **vitest:** `authoring.test.ts` (criteria, parents, refusal before write, 39 criteria where 21 outcomes fail), `clinical-review-hq.test.ts` (criteria shown for a current version, a stale one not offered), and `studio-p1.test.ts` (670 guards). The affected suites pass 115/115.
- **Harnesses:** clinical-review 25/0, competency-foundation 33/0, CI subset 67/67.
- **Other checks:** tsc clean, eslint clean.
