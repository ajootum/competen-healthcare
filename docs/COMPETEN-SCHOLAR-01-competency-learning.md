# COMPETEN-SCHOLAR-01: Scholar S2–S4, competency-driven learning (build record)

Owner GO "COMPETEN-SCHOLAR-01", 2026-10-23. Development is authorised. Production activation is **not**.

This record covers three slices, built on the Scholar MVP (COMPETEN-IND-004, migrations 372 and 375):

- **S2, Upload Intelligence.** Concepts are found in each section of a student's own notes, and competency mappings are **proposed** (several per section) against the competencies of their programme. Accepting or rejecting a mapping adds a new row to an append-only trail.
- **S3, Personal Learning Workspace.** Grounded explanations in five modes: explain, summarise, simplify, go deeper, and tutor. Background that goes beyond the notes is visibly separate.
- **S4, Revision and Clinical Reasoning.** Questions are tagged to a competency. Multi-step practice cases are generated from a section. Progress is shown by competency.

The S1 dependency (IND-007's shared competency foundation, PR #39) is in §6.

## 1. Migrations: state, order and dependencies

| # | File | Tier | sha256 (LF file, as merged) | State |
|---|---|---|---|---|
| 387 | `387-individual-scholar-programme.sql` | Low | `95751d6bf9af3348745ab72799696a46e0d902407d0360c859d3d26ccdd7556a` | Applied and verified on **staging** (twice). **Not on production.** |
| 388 | `388-individual-scholar-competency-mapping.sql` | Medium (APPLY WHOLE) | `1f40e437a7f6cacb7361f77ff6c6d56b90a35dbe422473d98b8ef4ae39c56224` | Applied and verified on **staging** (twice), with the rollback rehearsed. **Not on production.** |
| — | `docs/evidence/COMPETEN-SCHOLAR-01/ROLLBACK-387-388.sql` | — | `6aef5c2fd88458d59ff5990d180e157a811b70cf8ecc37cc661a0d690ec892f9` | Rehearsed on staging |

**Application order:** 387, then 388.

**Dependencies:**
- 387 depends on `profiles` (001) and `frameworks` (003).
- 388 depends on 372 (the Scholar tables and their `(id, user_id)` unique indexes), 387 (programmes) and 003 (`framework_competencies`).
- Neither depends on 375, 384 or 391.

**House rules:** `scripts/migration-house-rules.ts` reports ALL CLEAR for both. 388 has three construct warnings, all for the declared APPLY WHOLE function.

### 1.1 Staging verification

Project `ezhvpgtcqcdsgylrxgdb`. The owner-authorised apply was run by the coordinating session, via `scripts/apply-migrations.ts --only`.

| Step | Scholar tables | Fingerprint (coordinating session) |
|---|---|---|
| Pre-387 (this session, `ind004-snapshot`) | 8 | scholarSchema `c8ae46709b8a8d7d` |
| 387 applied (×2) | 11 | `757371b2…` |
| 387 + 388 applied (each ×2) | 14 | `4007cd40…` |
| ROLLBACK-387-388 | 8 | `b6bc7680…` = the pre-387 state |
| 387 re-applied | 11 | `757371b2…` (identical) |
| 388 re-applied | 14 | `4007cd40…` (identical) |

This session ran an independent read-only check afterwards (`fp388.mts`, label H1-applied):
- All six new tables are present with RLS on.
- Own-row SELECT policies exist on `learner`, `chunk_analysis`, `competency_map` and `competency_decision`. There is no policy on the two configuration tables, and no write policy anywhere.
- The four `individual_scholar_question` columns are present.
- `individual_scholar_decision_append_only` is present (search_path pinned) with its BEFORE UPDATE OR DELETE trigger.
- All new tables have 0 rows. The existing 3 questions are untouched.

## 2. What production needs, and what protects it meanwhile

`main` will hold 387 and 388 before production does. The code that uses them **fails closed** while they are absent:

- **The MVP question path is unchanged.** `QUESTION_COLS` selects only 372 columns. The 388 columns are read by a separate query that returns nothing on error. They are written only when a competency or a case exists, and that can only be true where 388 exists.
- **Every competency surface reads 387/388 first.** That covers the programme chooser, topic finding, suggested links, the case player and progress by competency. A *not provisioned* error hides the surface; any other error says it could not be read.
- **The whole of Scholar is still behind the `individual_app` release gate** (server-enforced, default OFF), and AI behind the consent and legal-documents gate.

Production application needs a separate owner GO under COMPETEN-OPS-001 (recovery reference, this rollback, post-application verification), applied by the owner in the SQL editor.

## 3. Design decisions

1. **Code against an interface, not a catalogue.**
   - `src/lib/individual/scholar/catalogue.ts` defines `CompetencyCatalogue`. S2–S4 never read the framework tables themselves (harness K2).
   - A competency id **is** `framework_competencies.id`, stored as a typed foreign key and never copied.
2. **A programme is configuration.**
   - `individual_scholar_programme` holds the profession, country and level.
   - `individual_scholar_programme_framework` says which catalogues a programme uses, and in which layer.
   - A new profession is rows. No code names a profession (harness K9).
3. **The model never sees an id.**
   - Competencies are shown to the model as `[C1]…` and sections as `[S1]…`. A tag outside the list given is dropped.
   - Concepts must appear in the section. Rationales are grounding-checked.
4. **Corrections are records.**
   - Accepting or rejecting is a new decision row. The trigger refuses UPDATE and DELETE except by cascade (`pg_trigger_depth() > 1`).
   - A person can add a link the AI missed. The route checks the competency against their programme's catalogue first.
5. **Beyond the notes is separate.**
   - "Go deeper" and "Tutor me" may add background after a marker. It is split off before the notes check and checked on its own: no figures, units, dosing language, citation tags or identifiers.
   - It is shown in a separate box labelled *Beyond your notes*.
   - Summarise and Simplify are notes-only.
6. **Cases are held to the question rules.**
   - Every step passes `checkQuestions`, the quality layer and the blind verification. A case with fewer than 2 surviving steps is not stored.
   - The title is grounding-checked and identifier-checked.
   - Cases are labelled as unreviewed practice scenarios.
7. **Progress by competency is practice, not competence.**
   - Unmeasured is shown as unmeasured, never as 0%.
   - Rejected links are not counted.

## 3a. Built on S1 (IND-007, PR #39, migration 384)

This branch merges `origin/s1/competency-foundation` (d32eaac5), so it must merge **after PR #39**.

- **One gate, and it is HQ's.** `scholarCatalogue()` reads S1's `loadCatalogueFor(admin, "scholar")`. That is the HQ allowlist for Scholar (Individual policy `scholar_catalogues`, empty by default), already restricted to shared, active and published catalogues.
  - The student's programme then **narrows** it, and never widens it.
  - The interim adapter over the framework tables was removed, so no Scholar file reads `frameworks`, `framework_domains` or `framework_competencies` (harness K2).
  - A programme row that names a catalogue HQ has not allowed offers nothing from it.
- **S1 owns the layer and the profession.** A catalogue's layer is 384's `frameworks.competency_layer`. The programme's layer only fills a catalogue HQ has not classified.

### 389: align the Scholar layer checks with S1

| # | File | Tier | sha256 | State |
|---|---|---|---|---|
| 389 | `389-individual-scholar-layers-align-s1.sql` | Low | `c8b98bc9bac657f803dc8575bd7afcc8dd0597075060177507d2eafcaa679780` | Authored. Sent for the staging apply (×2). |
| — | `docs/evidence/COMPETEN-SCHOLAR-01/ROLLBACK-389.sql` | — | `e3e37bd8ce3c4de95714461c6737778708636b5b51436e325b325906363cbc6c` | — |

- **What it does:** 384 has five layers (foundational, profession, advanced, specialty, context), while 387/388 allowed three. 389 replaces the two layer CHECKs with exactly the 384 list, and nothing else changes (harness K13 counts the statements).
- **Dependencies:** it depends on 387 and 388, and repeats 384's values without depending on 384.
- **Application order for the whole set:** 384 (S1), 387, 388, 389.

### 389 and 390 on staging

- **389:** applied ×2 by the coordinating session; sha `c8b98bc9…` matches.
  - Scholar fingerprint: `4007cd406923` before, `a4977fb6f3e3` after.
  - Only the constraints hash changed (`046681c5` → `b542981a`).
- **390** (`390-individual-scholar-mapping-provenance.sql`, Low, sha `e9f5c7f99ff29e4d58124c419e7d0946392c7ff7d17efd7a25d9d2c17638cd8f`; rollback `7b290f87…`, which only loosens the check).
  - **Found by staging acceptance D5:** 388's provenance CHECK enforced only the AI direction, so a person's link could carry a confidence and read as an AI judgement.
  - Applied ×2 by the coordinating session; the sha matches.
  - Scholar fingerprint: `a4977fb6f3e3` before, `3512368e69b8` after. Only the constraints hash changed (`b542981a` → `8d57a4a4`).
  - This session's read-only check shows the live constraint text identical to the file.

**Application order:** 384, 387, 388, 389, 390. **None is on production.**

## 3b. Staging viewing configuration (owner GO, 2026-10-23)

- **What:** `scripts/seed-staging-scholar-viewing.ts` sets the Scholar allowlist to CF-FOUND + NUR-RESP and adds the programme `nursing-ug-diploma`, "Nursing (Uganda), diploma", using both.
  - It goes through the governed WCE path (`setOverride` then `publishScope`, audited), so the actor is recorded by name only.
  - It refuses production, and refuses while any other Individual policy draft is pending.
  - `--remove` undoes exactly this.
- **Who ran it:** this session's permission check refused the write, so the **owner ran it themselves**.
  - Audit `set` at 20:22:23Z and `publish` at 20:22:25Z created version `16fce05a`.
- **Incident:** the owner's `--verify` then read the allowlist as null.
  - **Cause:** acceptance run 3, started about 20:32Z, deleted the shared allowlist for its N1 step ("empty offers nothing") and re-inserted it (row created at 20:32:28Z). Its end-of-run restore puts back whatever it found.
  - **Fix (harness):** the run now never removes or changes a set allowlist.
    - N1 runs only when none is set.
    - The run adds its own allowlist only where none exists.
    - At the end it removes that row only while it is still the run's own, unchanged.

## 3c. Staging acceptance: `scholar-competency-acceptance-harness`, on 384, 387, 388, 389 and 390

| Run | Result | Notes |
|---|---|---|
| 1 | 30/33 | Found the 390 gap (D5), a harness bug (D6) and an over-reaching go-deeper prompt (L2). |
| 2 | 29/33 | Prompt version label, and withheld AI answers. A diagnostic traced every withheld answer to counting ("three signs"), "significant" and change words ("again"). |
| 3 | 32/33 | Tutor turn 2 was withheld for counting. Its end-of-run restore also deleted the owner's allowlist (§3b), and the harness was fixed. |
| **4** | **ALL GREEN, 32 passed, 0 failed, 1 PEND** | N1 pends because a Scholar allowlist is set, and the run never removes one. Run against the owner's allowlist **read-only**: the viewing-config `--verify` output was byte-identical before and after the run. |

**Run 4, the slice end to end:**
- A real PDF of respiratory notes split into 3 sections.
- The sections mapped as follows: section 1 to COMP-OXY-001, COMP-RESP-002, CF-CR-001 and COMP-RESP-001; section 2 to COMP-OXY-002, COMP-OXY-001, COMP-OXY-003 and COMP-RESP-002; section 3 to CF-IP-001, CF-CM-002, CF-CR-001 and CF-CR-002.
- Accept, reject and change of mind are recorded as rows. The trail refuses UPDATE and DELETE. The 388 and 390 provenance CHECKs both refuse.
- A student's own link is stored. Isolation holds in the store, under RLS and through the composite keys.
- Simplify was shown. Go deeper was shown, with its background separate. Both tutor turns were shown.
- Questions are tagged to the accepted competency. A 3-step oxygen case was stored in order.
- Progress by competency was built.
- Every AI call is in `plat_ai_requests` with person attribution.
- Erasure cascades through the trail. Fixtures and programmes are removed.

## 4. Verification (this branch)

- Vitest: `src/lib/individual/scholar` 6 files, 78 tests (the new file, `competency.test.ts`, has 16).
- `scripts/scholar-learning-harness.ts`: 99/99. New checks K1–K12, with planted reds P21–P30. A1 and D2 were adjusted for the configuration tables and the split explanation. P12 still goes red.
- `scripts/individual-foundation-harness.ts`: 59/59.
- `tsc --noEmit` and eslint (Scholar lib, API, pages) are clean.
