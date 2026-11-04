# SQIE-HQ: build record for migration 997 (the library form and format check for WS-A, WS-B and WS-C)

**Authority:**
- Owner directive SQIE-CLOSE-2026-11, WS-E: "widen the library authoring form and the 800 format check for the formats the
  scoring session adds".
- Owner decision of 4 Nov 2026, item 1 (calculation).

**Field contracts:** owned by the scoring session, in `src/lib/individual/scholar/scoring-rules.ts`. That module came from
`scholar/sqie-scoring` at `cdd9026b`, which is merged into this branch.

**State: 2, applied and verified on staging** (`ezhvpgtcqcdsgylrxgdb`), twice. **Not applied to production.**

**Merge order:** merge `scholar/sqie-scoring` first, then this branch. This branch already contains it.

## File, checksum, order

| Migration | sha256 (LF) | Depends on |
|---|---|---|
| `997-ckri-library-calculation-and-safety.sql` | `9ab80a428d985b9d483c01d35ec69c1d486e4b9832169f9ae1586e5fd4ee46b1` | 800 (both functions it widens) |

**Application order:** 800, then 997. It is independent of 995, 996, 801 and 802.

**What it replaces.** It replaces the two 800 functions with bodies that are the 800 bodies **plus additions only**:
- **`ckri_question_format_ok`:**
  - adds a `calculation` branch;
  - adds optional type checks on the WS-B/WS-C key fields of every format.
- **`individual_scholar_question_library_guard`:** maps `calculation` to stored kind `short`.

No other migration on any SQIE branch touches these functions. Checked on 4 Nov:
- WS-D 990/991 does not touch them.
- The staging bodies were the 800 bodies, md5 compared before application.

**Rollback:** `ROLLBACK-997.sql` restores both 800 bodies exactly. It refuses while any calculation version or calculation copy exists.

**House rules:** ALL CLEAR (warnings only: the APPLY WHOLE constructs).

## Verification

`VERIFY-997.sql` is **generated** by `scripts/sqie-hq/build-verify-997.ts` from the application's own validator
(`validateLibraryQuestion`) and copy builder (`libraryCopyOf`). The database check is therefore tested against exactly what HQ
saves and Scholar copies. For each planted bad shape, the generator also asserts what the application does with it:
- most are refused by the application too;
- three are normalised by the application before saving (a numeric string, a missing `accepted`, options on a calculation), so
  a stored shape like them can only come from another writer.

| Run | Result |
|---|---|
| VERIFY-997 against staging **without** 997 (rolled back) | **red**: "format check has no calculation"; with the object checks removed, "refused: calculation, exact" |
| 997 applied twice | 11:55:57Z and 11:55:59Z, committed both times |
| VERIFY-997 (11:56:02Z) | **pass=25 fail=0** |

The 25 checks:
- both functions carry the change;
- every stored revision question still passes (the 60 pilot drafts and every walk item);
- 7 samples built by the validator are accepted:
  - calculation, exact;
  - calculation with every field (rounding, percentage tolerance, working, unsafe);
  - calculation with equivalent units;
  - short with safety markers;
  - extended with safety-critical key points;
  - structured answer-and-justify with a choice part, criteria and markers;
  - structured interpretation with findings;
- 12 bad shapes are refused:
  - calculation value as a string;
  - calculation without accepted;
  - percentage tolerance of 20;
  - rounding to 7 places;
  - learner marking;
  - options on a calculation;
  - unsafe as a string;
  - safetyCritical as a string;
  - an unknown part role;
  - an unknown variant;
  - 13 findings;
  - a one-option choice part;
- for a planted published, approved calculation, with the copy guard enabled:
  - the exact copy (kind `short`) is stored;
  - a copy with another value is refused "stored exactly as published";
  - a copy without its safety marker is refused the same way.

## Staging walk, calculation item (`SQIE-HQ-walk.mts calculation`): 24 passed, 0 failed

The item is MAP = (102 + 2 × 48) / 3 = 66 mmHg, a whole number, safety-critical, with no tolerance. It was authored through
the HQ form fields, with programme, level and difficulty.

1. **Drafting.**
   - 995 accepted the item and refused a bad difficulty.
   - A typed competency id was refused, and one picked from the list was saved.
   - Educator review was recorded.
   - The duplicate check asked for confirmation: it matched the pilot's `sqie-pilot-cvs-04`, the same question.
   - The item was submitted.
2. **Approval and publication.**
   - An independent reviewer approved it.
   - The author's publication was refused: "not authorised".
   - A separate publisher published it.
   - It is approved on its exact content.
   - The catalogue filters found it.
3. **Learner reuse.**
   - It was offered to the matching learner, and not to a learner of another level.
   - Adaptive reuse leaves it out, because a calculation is not an adaptive exam format (the registry row says `adaptive: false`).
   - The exact copy was stored through the 997 guard, kind `short`, difficulty 3.
   - `calculationSpecOf` reads the copy.
   - `markCalculation` marks 66 mmHg right, 66 kPa wrong, and 660 mmHg wrong and unsafe.
4. **Analytics.** Item and per-format analytics (the format reads `calculation`) are suppressed below the floor.
5. **Cleanup.** Bulk retire.

## What the application does

- **Registry:** `question-formats.ts` gives the `calculation` row its library entry: rank 10, "Calculation", marking
  `deterministic`, copy kind `short`.
- **Validator:** `library-format.ts validateLibraryQuestion` handles each of the new fields:
  - **calculation:** the key goes through `calculationProblems`, and the accepted answer is built from value and unit;
  - **short:** `safetyCritical` and `unsafe`;
  - **extended:** `safetyCriticalPoints`, which must index key points, and `unsafe`;
  - **structured:** `variant` and `findings` (an interpretation question needs findings), and on each part `role`, a choice
    (via `partContractOf`), `criteria` (via `criteriaOf`) and the markers.
- **HQ form:** `KnowledgeControls.tsx` has:
  - calculation fields (value, unit, equivalent units, rounding, tolerance with a "recorded, NOT in use until the clinical
    calculation policy is approved" note, safety-critical on by default, working, live `calculationProblems`);
  - safety fields for short, extended and parts;
  - the structured kind, findings, and each part's role, choice and weighted criteria.
- **Reviewer view:** `question-present.ts` shows the answer, the accepted units, the rounding, the tolerance as NOT in use, the
  safety-critical status, unsafe answers, findings, roles, choices and weighted criteria. Reviewers see what they approve.
- **Unit tests:**
  - `src/lib/knowledge/question-format-meta.test.ts`: form round trips, refusals field by field, safety-critical by default, the
    reviewer view;
  - `question-formats.test.ts`: the library list now ends with calculation.

## Not changed

- **Tolerances stay inactive.** `scholar_calculation_tolerances` is the scoring session's policy key (default off, in both
  expected-defaults lists in their branch). Turning it on is an owner decision after the clinical calculation policy is approved.
- **The pilot batch.** Its 11 calculation items are stored as `short` with a top-level `calculation` block. That block is kept
  as provenance, and those items are marked as short answers until the pilot loader re-imports them as format `calculation`.
  For each item:
  - `answerKey.value` ← `calculation.value`;
  - `unit` ← `calculation.unit`;
  - `rounding` ← { decimal_places, `calculation.decimals` };
  - `safetyCritical` true;
  - no tolerance.
