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

## Wave 1 (LEARNING-CLOSE-2026-11, WS01 CYU-01..04, owner decision D01, 4 Nov 2026)

Branch `scholar/cyu-wave1-01`. Migration 950 (`docs/evidence/SCHOLAR-CYU/950-build-record.md`): state 2, staging only.

**Model (reuse, no second engine).** A check question is an `individual_scholar_question` of the section it cites (416 kind `short`;
the extended format where the judgement gave three or more key learning points, which are its rubric; `answer.check.source =
"lesson"`), written once per section and stem. An answer is an `individual_scholar_attempt`: `response` holds the typed text and
the judgement (`learn-check-record.ts checkResponse`) and, for an AI judgement, the written-feedback copy the study session already
reads; `marking` is `ai_evaluation` (the clarify model and prompt), `self_graded` (the learner's own grade against the key
points) or `unmarked` (950). The clarify learning event references the attempt (950 `attempt_id`). A missed check (not yet, or
"I missed most of them") makes or resets the question's 372 card, so Revise and My Plan see the gap as they see a missed
practice question.

- **CYU-01** `placeChecks` + policy `scholar_learn_check_placement` (default distributed): on a substantial lesson (two
  questions, teaching paragraphs of 160+ words) the first check is shown after the teaching paragraphs and the second after the
  lesson; a short lesson, one question, an older lesson or the lesson_end policy keeps them at the end. Never one per paragraph
  or slide; every check optional.
- **CYU-02** the check question is a governed question kind (416 short / extended) and its answer is marked by the kind's rules:
  judgement where AI is allowed (clarify, `ai_evaluation`), else the learner's own grade (`self_graded`) or none (`unmarked`);
  a typed answer never matches the key by code. The quick MCQ check (`learn-inline-check.tsx`) is unchanged.
- **CYU-03** the act route keeps a judged answer under the same gate as its event (recorded session, shown, grounded, history on);
  `POST /api/individual/scholar/learn/checks` keeps a self-graded or unmarked answer (the question must be one the lesson's
  saved teaching wrote; screened for identifiers); `GET` lists a lesson's or session's kept checks. The Learn page loads the
  session's kept checks on the server, so they survive refresh, sign-out and a change of device.
- **CYU-04** "Your previous checks" in the lesson (each attempt its own, Try again reopens it with the answer); the Saved
  learning page lists the latest kept checks with a way back to the lesson and the section; the kept checks of a lesson join
  TAUGHT SO FAR as prior checks for every later lesson action (any device); the written-feedback copy reaches the study-session
  block and the Personal AI through the existing readers; a missed check reaches Revise / My Plan through the existing card.
- **Harness** K24 updated deliberately: the kept check is written only inside the D01 block under its full gate; 414 and 950
  hold no conversation column; P41 goes red when the gate loses `shown`/grounded or history-on, or when the event row carries
  anything beyond `attempt_id`.

Not done in Wave 1 (stays for later increments): checks of other kinds (true/false, cloze, scenario) offered inside a lesson;
restructuring-safe re-keying of kept checks (LE-03 / LE-05); competency evidence views beyond what `competency_id` on the
question row already feeds.
