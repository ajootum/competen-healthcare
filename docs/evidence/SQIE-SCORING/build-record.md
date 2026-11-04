# SQIE-CLOSE-2026-11 scoring gaps: WS-B, WS-C, WS-A (build record)

**Branch:** `scholar/sqie-scoring` (from `main` @ `661caf17`). It includes WS-B's evaluator branch `scholar/sqie-ws-b-unsafe-responses` @ `6737c1f0`, merged.
**Tracker rows:** SQIE-02, SQIE-03, C-04 (`docs/programme/SQIE-CLOSE-2026-11-TRACKER.md`, ranks 1, 4 and 7).
**Directive:** SQIE-CLOSE-2026-11 §3 and §5; the owner decisions of 4 Nov 2026, item 1 (calculation scoring); the owner release decision of 4 Nov 2026 (clinical scoring caps).
**Migration:** none. Every new field lives inside the existing `answer` jsonb (the 416/710 CHECKs allow extra keys) and the attempt `response` jsonb (416: an object of at most 8000 bytes). The seeded staging questions were stored through those CHECKs unchanged.
**Production:** not touched.

## The contracts (one shared module)

`src/lib/individual/scholar/scoring-rules.ts` is a single, dependency-free module. It documents the answer-key contracts and marks them. The HQ library form (WS-E) can import it, and `calculationProblems(answer)` returns a field-by-field list of errors for an author. The shapes were sent to the HQ library session for migration 996; see `SQIE-SCORING-format-contracts.md` in the shared notes.

| WS | Where | Field (all optional; absent means the behaviour before) |
|---|---|---|
| B | plain short | `answer.safetyCritical: boolean`, `answer.unsafe: string[]` (0..6, matched by code by normalised equality) |
| B | structured part | `parts[i].safetyCritical`, `parts[i].unsafe` |
| B | extended | `answer.safetyCriticalPoints: number[]` (indexes into `rubric.keyPoints`), `answer.unsafe` |
| B | scenario stage | `stages[i].safetyCritical`, `stages[i].unsafe` (option texts for an mcq/mrq stage) |
| B | case decision | the stored `RubricCriterion.weight` / `safetyCritical`, now scored |
| C | structured | `answer.variant: "answer_justify" \| "interpretation"`, `answer.findings: [{label, value, unit?}]` (1..12) |
| C | structured part | `role: "answer" \| "justify" \| "interpret"`; a choice part `options` (2..6) + `correct` (its option = `accepted[0]`); `criteria: [{text, weight 1..5, safetyCritical}]` (1..8) |
| C | case decision | `askReason` + `rubric` criteria: the reason is scored |
| A | `short` + `answer.format = "calculation"` | `value`, `unit` ("" = unitless), `equivalentUnits?`, `rounding?: {mode: decimal_places \| significant_figures, places}`, `tolerance?: {kind: absolute \| percent, amount}`, `safetyCritical?` (default true), `working?`; `accepted` holds the answer in words |

## The rules (versioned)

### Versioning
Every attempt marked now records `response.rules = "sqie-scoring-v3"`.
- `v2` (whole-attempt caps, superseded before release by the owner's decision) and legacy `v1` attempts render exactly as stored.
- Markers added later never re-judge an attempt (tested).
- A change to a cap is a new version string.

### WS-B: unsafe answers (owner release decision 4 Nov 2026)
- **The evaluator** is the WS-B branch's (evaluate v3 / case reasoning v3): it requires an `UNSAFE` line, quote-checked against the answer.
  - Here the line is a **flag**: the verdict stands as judged.
  - What the flag does to the marks is the gated cap below.
- **Always detected, recorded (`response.safety`, with `capped`) and shown:**
  - authored unsafe answers, recognised by code (a known wrong answer, so it scores 0 at its part);
  - the AI flag;
  - safety-critical failures (a safety-critical part, key point, stage or criterion missed or wrong).
- **The caps (rules v3)** apply at the scope the approved rubric defines: the structured part, the scenario stage, the criteria-marked part or case decision, or the item for a single-answer item. They never apply to unrelated components; one unsafe part leaves the other parts' marks untouched.
  - Unsafe response: at most `UNSAFE_SCORE_CAP = 0.5` of that scope, and never correct.
  - Safety-critical failure: `CRITICAL_MISS_SCORE_CAP = 0` of that scope, and never correct.
- **Gated:** the caps change marks only where HQ policy `scholar_clinical_scoring_caps` is `on`. It defaults to `off` until the safety-critical classifications are clinically approved. While it is off, the flag is explained without claiming a cap.
- Case criterion `weight` and `safetyCritical` are scored for written decisions.

### WS-C: rubric-based partial credit
- The same evaluator lists the numbered criteria met (`MATCHED:`), and code computes the weighted share and the whole part marks.
- Five-part feedback is unchanged, and the criteria met are kept on the attempt.
- The prompt version gains `+scholar-evaluate-criteria-v1` only where criteria are used.

### WS-A: calculation (owner decision 4 Nov 2026)
Marking is by code only, in this order:
1. The number is parsed strictly, keeping the sign and the decimal point (`+250` is not `-250`). An ambiguous `2,5` is refused. `.5` and `5.0` get safety-writing warnings without losing marks.
2. The unit must be the key's, or one of the item's validated `equivalentUnits`: recognised units of the same kind. Any other unit, or none, is wrong, with the amount shown in the key's unit where it is of the same kind.
3. **Safety, independent of tolerance:** a tenfold or greater error in the amount is unsafe (rules v2: no marks, said plainly), whatever any tolerance would accept. An item may set `safetyCritical: false` (a score rather than a dose).
4. **Question-defined rounding:** an answer not rounded as the question says is wrong, with the rule named.
5. **Exact match by default.** Absolute and percentage tolerances are built in full but are **inactive** until HQ policy `scholar_calculation_tolerances` is `on`. It defaults to `off`, pending approval of the clinical calculation policy.

For generated calculation items:
- the format is off by default;
- every stem figure must be in the passage;
- a tolerance written by the model is dropped;
- the key is always blind-solved by a second reader, whatever `scholar_verify_formats` says.

## Owner and clinical decisions (recorded, not taken)

1. **Approval of the clinical calculation policy.** Only that approval may turn `scholar_calculation_tolerances` on.
2. **Clinical approval of the safety-critical classifications.** Only that approval may turn `scholar_clinical_scoring_caps` on and activate the v3 caps.
3. **Turning the `calculation` revision format on** in `scholar_revision_formats`.

## Proof

- **Unit tests:**
  - `scoring-rules.test.ts` (30):
    - number parsing, including the sign;
    - units and validated equivalence;
    - rounding;
    - the tolerance edges, and the gate off and on;
    - the tenfold check, independent of tolerance;
    - caps and criteria;
    - the pilot batch's eight calculation items as fixtures.
  - `sqie-scoring.test.ts` (28):
    - the v3 caps at each scope (part, stage, decision, item), gated off and on, with the other parts untouched;
    - a v2 attempt rendered exactly as stored;
    - criteria partial credit, answer + justify, and interpretation;
    - calculation tolerance gating and unit mismatch;
    - generation grounding and the forced blind solve;
    - an old-snapshot render: legacy attempts unchanged, and a calculation read against its kept key after an edit.
  - WS-B's own `unsafe-response.test.ts` passes on the merged branch.
- **Staging walk** on the merged branch (`staging-walk-findings.txt` and the screenshots in this folder): 22 PASS / 0 FAIL (rules v3).
  - The fixture learner was used on the staging-pointed dev server.
  - Four fixture questions were seeded (`model = fixture-sqie-scoring`) and answered through the real answer route and the revision UI.
  - Every attempt records `sqie-scoring-v3`, and safety/calculation are kept.
  - A 791 snapshot is beside each attempt (10 of 10 in the v3 run).
  - A tenfold calculation error is unsafe, and `-10 mL` is not `10 mL`.
  - With the caps off (the default), an unsafe structured part scores 0 at that part only; the other part keeps its marks (3 of 4). The flag is recorded with `capped: false` and explained without claiming a cap.
  - There were no 5xx responses and no console errors.
