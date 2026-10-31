# Migration 751: build record (stable learning-outcome ids, evidence bound to them, F4)

- **Authority:** owner GO FRAMEWORK-DESIGN-STUDIO-01, 31 Oct 2026, implementation only (rulings 1, 4, 5 in `STATUS.md`).
- **Branch:** `hq/framework-design-studio-01`, from main `500df4d4`.
- **File:** `supabase/migrations/751-competency-outcome-stable-ids.sql`, sha256 `622d97fa5aa219b79bbf87c44be701c400eb20e00774a1ddd60cc3744101a39e` (the file staged, to be merged and applied).
- **Rollback (staging):** `ROLLBACK-751.sql`, sha256 `9f1aa6e3ac406ca3e111bac378afa1f49135311cc93e6f2736a282fe2b1419d1`. It restores the 640 body of `clinical_review_decision_sod_guard` byte for byte.
- **PRECHECK / VERIFY:** `PRECHECK-750-751.sql`, `VERIFY-750-751.sql` (shared with 750, both always roll back).
- **House rules:** ALL CLEAR (409 lines, 143 statements, 3 constraints, 4 warnings = the APPLY-WHOLE constructs).

## State

**State 2: applied and verified on staging. Production does NOT have it.** It needs a separate owner GO and is applied by the owner. Dependent code (slice B) must stay behind a server gate that defaults OFF and fails closed while 751 is absent.

## What it adds

**1. Stable outcome ids (ruling 5).**
- **Column:** `framework_competencies.learning_outcome_ids` jsonb NOT NULL, a uuid-string array parallel to `learning_outcomes`.
- **Check:** `framework_competencies_learning_outcome_ids_check` = `competency_outcome_ids_valid(ids, outcomes)`. This means the same length, uuid strings, none nil, none repeated.
- **Trigger:** `framework_competencies_outcome_ids` (BEFORE INSERT OR UPDATE OF learning_outcomes, learning_outcome_ids).
  - On insert, every outcome gets a new id.
  - On a change of outcomes, each new outcome takes the id of the first unused old outcome with the identical text, else a new id (`competency_outcome_ids_match`).
  - A write of the ids alone is refused.
- **Not in `competency_content_hash`.** 670 is untouched, and the staging content fingerprint is identical before and after.
- **Backfill:** every competency got ids.

**2. Evidence by id.**
- **Request columns:**
  - `competency_verification_request.outcome_map` jsonb NOT NULL: `[{"id": uuid, "text": string}]`, the outcomes when the request was made, in snapshot order;
  - `competency_verification_request.outcome_ids` uuid[] NOT NULL.
- **Evidence column:** `competency_verification_evidence.outcome_ids` uuid[] NOT NULL.
- **Checks:** `competency_verification_request_outcome_ids_check` and `competency_verification_evidence_outcome_ids_check`. Each requires one id per `outcome_indexes` entry and no null.
- **Index -1** (the competency as a whole) maps to the nil uuid.
- **Triggers:**
  - `competency_verification_request_outcome_ids` (BEFORE INSERT) runs after the 510 and 690 request guards. It builds the map from the live outcomes and ids, which equal the snapshot the 510 guard just took (it refuses if they differ).
  - `competency_verification_evidence_outcome_ids` (BEFORE INSERT OR UPDATE) runs after the 680 guard. It resolves against the request's `outcome_map`.
  - Both refuse ids that do not match the indexes, and an index outside the map. The evidence trigger also refuses any rewrite of stored ids.
- **Backfill:**
  - Each request's map comes from its own `competency_snapshot` (the live outcomes if no snapshot exists). Each text takes the live id of the same text, else a new id.
  - Request and evidence ids come from their indexes against that map.
  - The 510 and 680 append-only guards are disabled only around this update, inside the one transaction, and only when a row needs it. Production has 0 rows, so on production there is no DDL and no pause.

**3. F4 (ruling 4).**
- **New audit action `reorder_layout`.** It is for every presentation-only order write: a direct reorder of a never-published draft framework, and saving or clearing a layout draft.
- **Governance actions reused:**
  - submitting a layout uses the existing `submit_review`;
  - applying a layout at publication uses the existing `publish`, which both guards already treat as governance.
- **`clinical_review_decision_sod_guard` (640) redefined.** `reorder_layout` is added to the list of actions that are not authorship. Nothing else changes (diff below).
- **`frameworks_sod_publication_guard` (640) is NOT changed.** It already counts every action outside its governance list, so `reorder_layout` counts as contribution.
- **`clinical_review_decision_guard` (395/690) is NOT changed.** It reads the `authored_by` that the app computes (`authorsOf`). Slice B adds `reorder_layout` to `NOT_AUTHORSHIP` in `clinical-review.ts`, and must NOT add it to `GOVERNANCE` in `framework-publication.ts`.

### Function body diff (640 to 751), `clinical_review_decision_sod_guard`

The staging body before 751 was proven identical to the 640 source (text diff of `pg_get_functiondef` against the file: IDENTICAL). The diff from 640 to 751:

```
35c35,36
<            'clinical_review_submitted', 'clinical_review_decided', 'clinical_scope_added', 'clinical_scope_ended', 'framework_specialty_set'));
---
>            'clinical_review_submitted', 'clinical_review_decided', 'clinical_scope_added', 'clinical_scope_ended', 'framework_specialty_set',
>            'reorder_layout'));
```

| Function (staging md5 of `pg_get_functiondef`) | before 751 | after 751 |
|---|---|---|
| clinical_review_decision_sod_guard | 6e631f1fe58ed216c227aca328456ba9 | d6b8147c168d0985665315aea531d30f |
| clinical_review_decision_guard | b91b8e90... | unchanged |
| frameworks_sod_publication_guard | 9f551b00... | unchanged |
| competency_verification_request_guard | 7dd68646... | unchanged |
| competency_verification_evidence_guard | f30856f9... | unchanged |
| competency_content_hash | d00f12ea... | unchanged |

## Reading outcome ids (for slice B)

- **Resolve an id to its words through the request's `outcome_map`,** never the live competency. This applies to the request and to all of its evidence. The map is the history.
- **Position of evidence:** an evidence index is a position in its request's `outcome_map`. This is already true in the app: `addRequestEvidence` resolves against `competency_snapshot.learning_outcomes`.
- **Writes:** send `outcome_indexes` and, optionally, `outcome_ids`. If both are sent, they must agree.
- **Live competency:** the current id of the outcome at position `i` is `learning_outcome_ids[i]`.

## Order and dependencies

- **Apply after 750** (independent, but they ship together). It depends on 384, 395, 640, 510, 680 and 690, all in production.
- **A later migration that replaces `clinical_review_decision_sod_guard` must start from this file.**

## Staging (ezhvpgtcqcdsgylrxgdb), 31 Oct 2026, by the agent with the guarded runner

- **PRE:** as in `750-build-record.md`. Verification tables: requests 2 (both with a snapshot), evidence 1, decisions 1. Outcomes: 30, no duplicates, all strings. `reorder_layout` audit rows: 0.
- **Run 1 and run 2:** both committed.
- **Post:**
  - all 349 competencies have valid ids;
  - the 2 requests got maps from their snapshots, sharing the live ids of the same text;
  - the request indexes were `{0}` and `{-1}`, giving ids `{<id of outcome 0>}` and `{nil}`;
  - the evidence index `{0}` gave the same id as its request;
  - the content fingerprint was unchanged (`9ee1991c...80b3`);
  - the guards were re-enabled.
- **Rollback rehearsal:** `ROLLBACK-751` restored every function md5 and the triggers and columns to PRE exactly.
- **Final:** re-applied, and the final state equals the post-apply state.
- **VERIFY 751:** A1-A6, B1-B8 and C1-C4, **18/18 ok**, on the applied state and again on the final state.

| Check | Proved |
|---|---|
| A1 | a reorder moves each id with its text |
| A2 | the hash still changes on an outcome reorder (ruling 1) |
| A3 | an edit mints a new id only for the edited outcome |
| A4 | restoring the order and wording keeps the unchanged ids |
| A5 | writing the ids alone is refused |
| A6 | duplicates get distinct ids, matched in order on reorder |
| B1 | the real `competency_verification_submit` stores the request ids for indexes `{1,2}` and the evidence id for `{2}` |
| B2 | after a live reorder plus edit, the stored ids are unchanged and resolve to the same words |
| B3 | the live competency carries that id at its new position |
| B4 | the backfilled pre-751 evidence still resolves to its original words after the live change |
| B5 | evidence with mismatched ids is refused |
| B6 | an out-of-map index is refused |
| B7 | matching ids (with -1 mapped to nil) are accepted |
| B8 | a request with mismatched ids is refused |
| C1 | a reviewer whose only audit row is `reorder_layout` on the framework may decide |
| C2 | the original 640 refusal stands: an authoring audit row on the competency is refused, "not independent" |
| C3 | a publisher whose only audit row is `reorder_layout` cannot publish a revision |
| C4 | control: an independent publisher can |

## Production

**Not applied.** Before applying it needs:
- an owner GO and a recovery reference;
- a read-only pre-check showing `clinical_review_decision_sod_guard` md5 = `6e631f1fe58ed216c227aca328456ba9` (the 640 body, which the rollback restores) and 0 `reorder_layout` audit rows;
- a count of verification requests and evidence (expected 0, which means no backfill DDL).

After applying, check the verification block at the end of the file (`competencies_with_ids` = `competencies_total`, `triggers 3`, `guards_enabled 2`).

**Rollback note:** rolling back drops the ids. Re-applying mints new ids and re-derives request and evidence ids from the stored snapshots, so the evidence still resolves to the same words.
