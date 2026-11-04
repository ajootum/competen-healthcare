# SQIE-CLOSE-2026-11 scoring gaps: WS-B, WS-C, WS-A (build record)

**Branch:** `scholar/sqie-scoring` (from `main` @ `661caf17`). **Tracker rows:** SQIE-02, SQIE-03, C-04 (`docs/programme/SQIE-CLOSE-2026-11-TRACKER.md`, ranks 1, 4 and 7).
**Directive:** SQIE-CLOSE-2026-11 §3 (formats) and §5 (scoring and rubric intelligence).
**Migration:** none. Every new field lives inside the existing `answer` jsonb (the 416/710 CHECKs allow extra keys) and the attempt `response` jsonb (416: an object of at most 8000 bytes). The seeded staging questions below were stored through those CHECKs unchanged.
**Production:** not touched.

## The contracts (one shared module)

`src/lib/individual/scholar/scoring-rules.ts` is the single, dependency-free module that both documents the answer-key contracts and marks them. A client component can import it, so the HQ library form (WS-E) can author the same fields against the same rules. Its header documents each field. In summary:

| WS | Where | Field (all optional; absent means the behaviour before) |
|---|---|---|
| B | plain short | `answer.safetyCritical: boolean`, `answer.unsafe: string[]` (0..6, matched by code, normalised equality only) |
| B | structured part | `parts[i].safetyCritical`, `parts[i].unsafe` |
| B | extended | `answer.safetyCriticalPoints: number[]` (indexes into `rubric.keyPoints`), `answer.unsafe` |
| B | scenario stage | `stages[i].safetyCritical`, `stages[i].unsafe` (option texts for an mcq/mrq stage) |
| B | case free-text decision | the stored `RubricCriterion.weight` / `safetyCritical`, now scored |
| C | structured | `answer.variant: "answer_justify" \| "interpretation"`, `answer.findings: [{label, value, unit?}]` (1..12) |
| C | structured part | `role: "answer" \| "justify" \| "interpret"`; a choice part `options` (2..6) + `correct` (its option must be `accepted[0]`); `criteria: [{text, weight 1..5, safetyCritical}]` (1..8) |
| C | case decision | `askReason` + `rubric` criteria: the reason is scored |
| A | `short` + `answer.format = "calculation"` | `value: number`, `unit: string` ("" = unitless), `tolerance?: {kind:"none"} \| {kind:"absolute", amount} \| {kind:"percent", amount ≤ 10}`, `units?: "exact_unit" \| "convert"`, `working?`; `accepted` holds the display answer |

## The rules (versioned)

- Every attempt marked under these rules records `response.rules = "sqie-scoring-v2"`. An attempt without it was marked under `sqie-scoring-v1` (legacy). Its feedback is built exactly as before, and nothing is re-judged by markers added later (tested). A change to a cap is a new version string.
- **Unsafe** (an authored unsafe answer, matched by code, or the evaluator's `UNSAFE:` line quoting the learner's own words): the score is capped at `UNSAFE_SCORE_CAP = 0`. It is never correct and never "partly", and the feedback names the statement. An `UNSAFE:` line that quotes words the learner did not write withholds the evaluation (self-mark) rather than mark them on it.
- **Critical missed** (a safety-critical part, key point, stage or criterion not earned in full, judged by code or AI, never by the learner's own grade): the answer is never correct, and the score is capped at `CRITICAL_MISS_SCORE_CAP = 0.5`.
- **Rubric-based partial credit:** the evaluator lists the numbered criteria met (`MATCHED:`, the same mechanism extended responses already use). Code computes the weighted share and the part's whole marks (rounded down). Five-part feedback is unchanged.
- **Calculation:** marked by code only. Numbers are parsed strictly: an ambiguous `2,5` is refused, not guessed, and `.5` and `5.0` get safety-writing warnings without losing marks. Common clinical units are normalised and converted by dimension: mg/micrograms/g, mL/L, mmol, units, drops, per hour/minute/day, per kg; a dose per kilogram is never a mass, and tablets are never capsules. The tolerance is the item's own, else the policy's, else exact. Under `exact_unit` the same amount in another unit is wrong, and the feedback says so. A unit of another dimension, or a missing unit, is always wrong.
- **Evaluator prompts:** the base prompts are unchanged. The safety rule (and the criteria rule, where used) is appended, and the prompt version carries `+scholar-evaluate-safety-v1` / `+scholar-evaluate-criteria-v1`. Model routing is unchanged.
- **Generation** (`calculation` revision format, off by default): every figure in the stem must appear in the passage (`ungrounded_number` otherwise). The unit must be a recognised clinical unit, and a tolerance written by the model is dropped. The key is always blind-solved by a second reader, whatever `scholar_verify_formats` says; it must agree within 1%, with units converted.

## Owner and clinical decisions (flagged, not taken)

1. **Clinical tolerance policy for calculations.** Policy `scholar_calculation_tolerance` defaults to `exact` (options: exact, within 1%, within 5%). Policy `scholar_calculation_units` defaults to `exact_unit` (option: `convert`). An authored per-question tolerance overrides both.
2. **The two safety caps:** unsafe = 0, critical missed ≤ 0.5. These are code constants in rules v2, and changing either is a new rules version.
3. **Turning the `calculation` revision format on** (`scholar_revision_formats`), once (1) is decided.
4. **Evaluator prompt suffix:** D5-v4 eligibility was measured on the evaluate prompt without the `UNSAFE` line, so re-running the D5 evaluation set may be wanted.

## Proof

- Unit tests:
  - `scoring-rules.test.ts` (26): parsing, units, tolerance edges, unit mismatch, caps, criteria.
  - `sqie-scoring.test.ts` (28):
    - unsafe-capped and critical-missed for short, structured, extended, scenario and case;
    - partial credit by weighted criteria, and answer + justify and interpretation;
    - calculation tolerance edges and unit mismatch;
    - generation grounding and the forced blind solve;
    - an old-snapshot render (legacy structured and short attempts unchanged, a calculation attempt read against its kept key after the question is edited);
    - policy defaults.
- Staging walk (`staging-walk-findings.txt`, screenshots in this folder):
  - The fixture learner was used on the staging-pointed dev server (port 3186).
  - Four fixture questions were seeded (`model = fixture-sqie-scoring`).
  - They were answered through the real answer route and the revision UI.
  - Every attempt records `sqie-scoring-v2`, and safety/calculation are kept on the response.
  - A 791 snapshot is beside each attempt (40 of 40).
  - There were no 5xx responses and no console errors.
  - On staging, the justify part was self-graded (the evaluator withheld).
  - The AI `UNSAFE` path is covered by unit tests with a scripted evaluator.
