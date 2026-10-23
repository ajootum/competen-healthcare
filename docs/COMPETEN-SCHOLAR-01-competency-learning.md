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

## 4. Verification (this branch)

- Vitest: `src/lib/individual/scholar` 6 files, 78 tests (the new file, `competency.test.ts`, has 16).
- `scripts/scholar-learning-harness.ts`: 99/99. New checks K1–K12, with planted reds P21–P30. A1 and D2 were adjusted for the configuration tables and the split explanation. P12 still goes red.
- `scripts/individual-foundation-harness.ts`: 59/59.
- `tsc --noEmit` and eslint (Scholar lib, API, pages) are clean.
