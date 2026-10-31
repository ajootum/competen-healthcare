# Migration 771: build record (the structure of a published framework in its revision draft)

- **Authority:** owner GO FRAMEWORK-DESIGN-STUDIO-02, 31 Oct 2026, ruling D3 ("published frameworks: ALL changes pass through revision drafts and independent publication"), closing the S5 open item (framework name/description, domains, practices and CPUs of a published framework still saved live). Implementation only. 770 not edited (fix forward).
- **Branch:** `hq/framework-studio-02a` (on 8c860439).
- **File:** `supabase/migrations/771-framework-revision-structure.sql`, sha256 `53e7bcaf59bfd007f5e22a4a6b6e6e7537934a08d769aa3ab535add2ea52106d`.
- **Rollback (staging):** `ROLLBACK-771.sql`, sha256 `3481a45ad346b4a1639319eda87a8c7f2ea96df283fd23d5f302bcb9d7b83e62`. Restores the six replaced bodies verbatim from 770 (extracted from the 770 file by script) and the three foreign keys, drops everything 771 added. Refuses while any proposed label, revision domain, practice or CPU exists.
- **PRECHECK / VERIFY:** `PRECHECK-771.sql` (sha256 `33d3d56a...4d7f`, read only), `VERIFY-771.sql` (sha256 `a62defd8...623b`, always rolls back).
- **House rules:** ALL CLEAR (747 lines, 244 statements). Warnings only for the APPLY WHOLE constructs.

## State

**State 2: applied and verified on staging. Production does NOT have it.** Separate owner GO, applied by the owner. Without 771 the server refuses (409, nothing written) every structure action on a published governed framework. It never writes live there.

## Order and dependencies

- **Application order: 750, 751, 752, 760, 761, 770, then 771.** The file refuses (nothing changed) without 770 (revision tables, apply and problem functions) and 760 (`framework_areas`).
- **Depends on:** 011 (practices, CPUs), 640 (publication guard, unchanged; floor body via 770), 760 (domain Area scope trigger, unchanged), 770 (every replaced body is the 770 body, extended).
- A later migration that replaces any of the six bodies below must start from THIS file.

## Design

| Piece | What |
|---|---|
| `framework_revision` + `framework_proposed`, `proposed_name`, `proposed_description` | The proposed label (false = no change). Check: name 3-200, description up to 2,000. `framework_revision_proposal_guard`: changes only while open, moves `updated_at` (the publication request compares it). |
| `framework_revision_domain` | A rename of a live domain (`origin_domain_id = domain_id`, name, code) or a NEW domain (pre-allocated id, checked unused live and in any revision, name, code, place, optional Area of the same framework). |
| `framework_revision_practice` / `framework_revision_cpu` | Rename of a live practice / CPU of the framework, or a NEW one (pre-allocated id) under a live or new parent of the same revision. A new CPU carries risk, complexity, reassessment. A rename never changes risk. |
| `framework_revision_structure_guard` | One guard for the three tables: open revision only, identity never changes, origin of the same framework, new ids unused, parents of the same framework (live or new in the same revision). A new row is withdrawn only while nothing of the revision sits under it. |
| `framework_revision_competency` FKs | `domain_id`, `practice_id`, `cpu_id` foreign keys to the live tables replaced by a check in the competency guard (770 body, extended): a live row, or a NEW row of the same revision. Checked on insert and on change. A new competency may change domain within the revision. |
| `clinical_scope_covers_domain` (770 body) | A NEW domain of an open revision is covered by a framework, profession or specialty scope of the revision's framework. |
| `clinical_content_version_sod_floor` (770 body) | The proposed CPU's risk may be a NEW CPU's risk, read from the revision. |
| `clinical_review_decision_sod_guard` (770 body) | The seven `cfca_revision_*` structure actions are not authorship (as the 760 Area actions). |
| `framework_revision_problem` (770 body) | Also refuses: a new domain/practice/CPU whose id was taken or whose parent is gone, a new competency outside the live or new domains, a revision competency naming a practice or CPU that no longer exists. |
| `frameworks_revision_apply_on_publish` (770 body) | In the same publication statement, before 466 and 640: sets `new.name` / `new.description` (the row being published), inserts new domains, practices, CPUs (parents first, pre-allocated ids, CPU `pub_status` draft as `createCpu`), renames by id, then the 770 steps. Nothing deleted. |

**Not clinical content.** None of this is in `competency_content_hash`, so no competency goes stale and none needs clinical review again. Organisational for review (not authorship, DB guard and `NOT_AUTHORSHIP`), still contribution for publication (640 unchanged, `GOVERNANCE` unchanged): whoever made the change cannot publish it. Linking a competency to a CPU stays a content change of that competency (in the hash, authorship).

## Guarantees kept

| From | Guarantee | How it holds |
|---|---|---|
| 466 | published only when every competency is approved at current content | guard unchanged, runs after the apply; apply keeps its own 466 predicate (P1) |
| 640 | publisher independent | guard unchanged; structure actions are recorded on the framework, which 640 reads (P2) |
| 640 | approvals floor by risk | floor reads a NEW CPU's risk (R1, planted high = 2) |
| 395/640/760 | reviewer independence | content authorship unchanged (770 V2); only the seven structure actions are excluded (R3) |
| 751 | stable outcome ids | untouched (no outcome field here) |
| 752/760 | layout applied whole in the statement | unchanged AFTER triggers; new domains exist before they run |
| 770 | atomic apply, refused publish applies nothing, ids stable | same statement (P1, P3, S1, S2), pre-allocated ids (P3), never deletes |
| 761 | active-criteria hash | unchanged |

## Staging (ezhvpgtcqcdsgylrxgdb), 31 Oct 2026, by the agent with the guarded runner (`judgeDbTarget`)

- **PRE:** the six live bodies equal the 770 file (md5 of prosrc: competency guard `ffc709f7`, scope `88b887a6`, floor `40a01d83`, SoD guard `18a3c323`, problem `0eede1fa`, apply `add7ae07`). 22 frameworks, 100 domains, 18 practices, 4 CPUs, 349 competencies, 458 criteria, 13 versions, 5 decisions, 4 framework versions, 0 revisions. `framework_fp 2a631a86`, `domains_fp 92ca86cd`, `practices_fp 9decf922`, `cpus_fp 661398a0`, `hash_fp 9ee1991c` (as 760/770), `content_fp 62812c49`, `criteria_fp 30d5cc92`, `versions_fp e3716f8c`, `evidence_fp 8a1e8350`.
- **Run 1** applied, **VERIFY 13/13** (first attempt), **run 2** applied (idempotent). Post-apply PRECHECK: only the six replaced bodies, the four new functions, the triggers, the revision constraints, the three FKs, the three columns and the three tables differ. Every data fingerprint identical (no row changed).
- **VERIFY 13/13 ok:** E1 label, new domain in an Area, domain rename, new practice and high risk CPU, practice/CPU renames, new competency naming them, a new competency moved within the revision; I1 invisible (live rows, new ids absent, signed-in read sees none); G1 schema refusals (live id reused, foreign rename, foreign Area, foreign practice parent, foreign CPU parent, ghost CPU, withdrawing a used new domain, id rewrite, short label, move to a foreign domain); R1 new CPU risk raises the floor; R2 new domain scoped by framework, refused for a D1-only scope; R3 structure actions not authorship; P1 refused publication applies nothing (label, domains, practices, CPUs undone); P2 structure editor cannot publish; P3 applied as the app role (label, new rows with their ids and parents, renames, hashes as reviewed, counts +1/+1/+1/+2, nothing deleted, 1.0.1); K1 closed revision immutable; S1 a new domain id taken live refuses; S2 a CPU deleted live refuses; D1 discard leaves live untouched.
- **Plant-fail:** practice guard disabled + 770 SoD body -> G1, R3 RED and the stray foreign practice refused every publication by the problem check (P1-P3, S2 RED). 770 apply body alone -> P1, P2, P3 RED (FK on the new domain).
- **Rollback rehearsal:** ROLLBACK-771 committed. PRECHECK then equals PRE exactly (every line, constraint md5 included).
- **Final:** re-applied, VERIFY 13/13 again, PRECHECK equals the post-apply state. Staging is left with 771 applied.

## Code (server)

- `framework-revision.ts`: `STRUCTURE_ACTIONS` routed first (`routeStructure`); `structureReady`; `newInRevision`; writers for the label, domains, practices, CPUs and the move of a new competency; `revisionCpuFor` (a competency may name a new CPU); `loadRevision` returns `structure`; `overlayRevision` lays the label, renames and new domains over the diff; review grouping lists new domains; `submitRevisionVersion` reads a new CPU's risk.
- `authoring.ts`: label parsers shared; live `update_framework`, `create_domain`, `rename_domain`, `create_practice`, `create_cpu` refuse a published governed framework (REVISION_ONLY) if ever reached; new `renamePractice`, `renameCpu` (drafts live).
- `clinical-review.ts`: `REVISION_STRUCTURE_ACTIONS` in `NOT_AUTHORSHIP`. `clinical-review-hq.ts`: a new competency in a new domain is placed in the queue by the revision domain.
- Route: `rename_practice`, `rename_cpu`; `revision_view` adds `framework`, `domains`, `practices`, `cpus`.

## Tests

vitest `framework-revision.test.ts` 21 (9 new: draft path unchanged, fail closed without 771, label, new domain and Area, live domain rename, new practice/CPU and a competency linked to the new CPU, new competency move and refusals, not authorship, diff overlay) plus authoring, criteria-authoring, clinical-review, clinical-review-hq, review-batch, framework-areas: 67/67. Plant: routing and the 771 fail-closed check removed -> 6 RED, restored -> 21 green. tsc clean, eslint clean on changed files. `competency-foundation-harness` ALL GREEN 33/33.

## Not done / open

- UI (S6) for the new actions and `revision_view` fields. Not browser-walked.
- A published competency is not moved into a NEW domain within the same revision (409): publish the revision first, then move it with the layout draft.
- A new revision competency is placed at the end of its domain (a `position` is refused, 422).
- CPUs are also editable live by `/api/content/cpus` (pre-existing, outside the HQ authoring route): not changed here.
