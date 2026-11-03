# SCHOLAR-UNDERSTANDING-CHECKS-01 — Check Your Understanding: feedback, and checks as a standard lesson capability

Owner instruction, 3 November 2026. Branch `scholar/understanding-checks-01`. Increment 1 of the series (one PR each).

## The defect (production, learner competenelisha, 3 Nov)

The learner answered a Teach Me check question and pressed **Check my answer**. Nothing appeared beneath the answer.

**Root cause (read from production, read-only).** Two `ai_gate_decision` rows at 11:08:10 and 11:20:16 UTC for
activity `clarify`: decision `clarify`, rule `intent:ambiguous_person:high.paediatric-deterioration`, reason
`clarify_purpose`. No AI call was made (no `plat_ai_requests` row, no `ai_assistant_query` row). The operating-mode layer
(SCHOLAR-RISK-01, `operating-mode.ts decideIntent`) read a named person in the answer with no case framing and, as designed,
put the clarify question to the learner instead of answering.

The question never reached the learner's eyes: the Learn workspace rendered every lesson-level clarify prompt at the **top
of the lesson card** (`learn-client.tsx`, the `ClarifyPurpose` line before the lesson thread), while the check form sits at
the bottom of the Teach Me answer, under the question. `act()` returned null on the prompt, `submitCheck` did nothing with a
null result, and the only sign was "Checking…" turning back into "Check my answer". The learner tried twice (the second
gate row); because the prompt was never answered, clarify-once never attached `purpose: education`.

The same placement hid a request error too (`setError` renders above the lesson list).

## What changed (this increment)

- **`learn-check.ts` (new, pure, client-safe)**: the labelled parts of a clarification (`RIGHT:`, `MISSING:`,
  `MISCONCEPTIONS:`, `KEY POINTS:`, `NEXT:`), `parseCheckFeedback`, the self-review's `referenceAnswer` (the saved
  lesson's key points and the sections the question cites, no AI), and the copy. Tests in `learn-check.test.ts`.
- **`generation.ts`**: the clarify instruction asks for the parts after the `VERDICT:` line, addressing what the learner
  wrote (what was right, what was missing, misconceptions or incorrect reasoning, key learning points as a model answer
  from the notes, what to revise next), each cited. Own prompt version `PROMPT_VERSIONS.learnClarify`
  (`scholar-learn-clarify-v2`); the artefact actions' versions and keys are untouched. Same grounding check
  (`checkLearnMain`), same risk gate, same metering and audit trail as before.
- **`learn-client.tsx`**: the check is a panel beneath the question that keeps the learner's answer through every outcome
  and shows one of: processing (live region), the AI judgement with its parts and citations, the withheld reason, the
  continuity message, the clarify question (now **in the panel**, with the self-review one click away), or the error.
  Then **Try again | Review source | Continue learning**. Try again keeps the answer editable and moves the judgement to
  the lesson thread as a previous check (revisitable, rendered with its parts); Review source shows the cited sections
  with excerpts and links; Continue learning closes the check, leaves its judgement in the thread and scrolls to What next?.
  Nothing else in the lesson, the sources or the study session changes.
- **Two pathways.** (b) AI-enhanced where the standing, allowance and clinical-risk gate allow it. (a) **Self-review with
  no AI call** whenever the judgement is not shown (unavailable, withheld, no new AI, error) or the learner chooses it:
  the saved lesson's key points and the question's sections, with the honest line that a written answer in the learner's
  own words cannot be marked by code and that nothing is recorded as a result. AI is never required to complete a check.

Not changed: the clinical-risk rules, the clarify-once rule, what is recorded (a `clarify` learning event with the
informal verdict, as 414 allows; nothing the learner typed or the AI wrote is stored), the MCQ practice path
(`learn-practice.tsx`, `/attempts`).

## Staging evidence (3 Nov, fixture learner, session "Quality Improvement Science and Methods", lesson 7)

Playwright walk against a port-3174 staging server of this branch; shots in the session's hand-over folder.

| Case | Answer | Outcome |
|---|---|---|
| A | a partial answer in the learner's words | processing line, then **Partly understood** with the five parts, [S n] links, three buttons; Review source lists the cited sections; Try again keeps the answer; the judgement stays in the thread |
| B | "Mr Okello was on my ward …" | gate `intent:real_patient` (refused, as designed): **No new AI judgement right now** with the refusal words, then the self-review |
| C | "Mr Okello's team planned …" (named person, no case framing) | gate `clarify` (the production path): the clarify question **in the panel**; "It's for my studies" resends and the judgement (**Not yet**, five parts) follows |

Trail: `ai_assistant_query` rows action `clarify`, outcome `shown`, verdicts recorded on the `clarify` learning events,
prompt version `scholar-learn-v3:clarify+scholar-learn-clarify-v2`; 0 console errors from this change, 0 5xx. Mobile
(375px): the panel fits the lesson column.

## Still AI-dependent

The judgement of what the learner actually wrote. Without AI the learner gets the self-review (reference key points and
sources), never a verdict.

## Next increments (owner's list, one PR each)

3. Checks as a standard lesson capability: a proportionate number per lesson by length, objectives and complexity;
   never one per slide; optional. The engine already writes at most two check questions per Teach Me answer and the
   inline-check policies (`scholar_learn_inline_*`) place recall and quick checks; the increment decides placement across
   a lesson's units.
4. Check types through the existing question kinds (short answer, explanation, application, clinical judgement, MCQ).
5. Saving the response and feedback for revisiting, gaps to My Plan and flashcards, the study-session block
   (`study-context.ts` already reads `not_yet` verdicts). Needs the owner's decision on storing what the learner typed:
   Learn's contract today stores nothing the learner types; the revision attempt table (416: `response`, `marking`,
   `evaluator_*`) is the existing place for a written answer and its marking.
