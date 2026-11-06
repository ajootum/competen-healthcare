# SCHOLAR-GUIDE-ME-001: Guide Me as a responsive educator

Owner instruction, 6 Nov 2026 (P1). Final directive: "Guide Me must guide learning, not merely guide learners through the wording of their notes." Branch `scholar/guide-me-001`, stacked on SCHOLAR-GO-DEEPER-001 because it reuses that work's source labels and checks. Default off behind server policy `scholar_guide_me_adaptive`. Evidence is in `docs/evidence/SCHOLAR-GUIDE-ME-001/`.

The three styles stay and now differ: Explain teaches thoroughly. Guide Me teaches, listens and adapts. Challenge Me is not changed: it tests with progressively harder questions.

## 1. How Guide Me worked before

- A hint at a time at "rung 1 of 3", with no teaching first. The counted run opened: "You have not tried yet, so there is nothing to confirm", and then asked "what do your notes say the very first physical milestone is".
- "Continue (guidance 3 of 3)" counted hints, not learning.
- A `[!MEMORY]` callout carried a navigation instruction.
- Nothing kept the answers, and each turn was a new call.

## 2. What it does now, with the policy on

The cycle is explain, question, response, feedback, adapt, progress.

| Owner's point | How |
|---|---|
| 1, 2 Teach first | A step is a concise, substantive explanation, then the question. |
| 3 One meaningful question | The prompt asks to explain, compare, interpret or apply. The check keeps one question. |
| 4 Response decides | Understood: confirm, go on. Partly: try again. Not yet: corrective feedback and a new question that applies it. "I don't know": help, never a verdict. Blank: cannot be sent, so no false feedback. |
| 5 Scientific depth | Sections are marked From your notes or Scholar's explanation, under Go Deeper's checks. Research reaches a step through the existing research mode and evidence seam. |
| 6 Human factors | One concept, one question, the answer box directly under it, feedback beneath, a progress line, labelled controls. |
| 7 Progression | "Step n of N" is the lesson's own size. The progress line says only what happened (understood, answered not yet understood, explained to you, moved on). Hint, example, check and next step are separate controls. The panel renders once and adds nothing to the lesson's thread. |
| 8 Just explain it | A structured explanation with more room than a step, not the plain Explain. The learner can go back to the question. |
| 9 Memory aids | A `memory` section kind, rendered as a memory aid only for an analogy, comparison, mnemonic or cue. The prompt forbids instructions in it and forbids mentioning buttons. |
| 10 Notes | **Not yet.** `SectionNote` is in place for each step; `MyIdeasBox` goes there when COMPETEN-NOTEBOOK-001 lands. |
| 11 Cost and data | One call a turn, nothing behind it. Saved turns reopen free. Answers and feedback go through the existing check storage. |

## 3. Decisions

**One saved kind, no migration.** A teach, hint, example or explain turn is saved as the existing `explain` kind, under its own prompt version (`scholar-guide-me-v1:<turn>`) and key (`guide:<turn>:<step>:<of>`, and for help, the question it was for). A step or an explanation counts as taught ground, told as "Guide me". A hint or an example does not: it is help with a question. None is opened or listed as an Explain or a saved lesson (`isGuideTurnVersion`). 415's check on action names means a new kind would need a migration, with nothing gained.

**Judging is the existing check.** A real answer goes to `clarify` with `guided: true`, which adds one instruction: judge understanding rather than wording, credit sound science beyond the notes, and write a new question in NEXT when the verdict is not yet. The verdict and parts are the same, and it is kept the same way. A guided check that fails on one word loses that line rather than all the feedback (`checkGuidedFeedback`), unless it carries a dose or an invented number in a safety context.

**Metered and routed as Go deeper, not Explain.** The first counted run used the Explain route (Sonnet on staging). It wrote that a sleeping brain crosses a threshold more easily, which is doubtful science stated with confidence. A turn may carry Scholar's own science, so accuracy decides this. It costs about two to three times a plain Explain turn (table in the evidence). Production routing still follows HQ's eligibility rows.

**What counts at lesson level (owner decision SCHOLAR-TEACHING-P1-RELEASE-001, item 3).** Each step's answer is kept as it is judged, and is that step's result. The lesson-level guided check counts only when the activity is complete: the learner reached the end and every step has been taught. The server decides this from its own records (`learn/guide-complete`, no AI), never from the page. The lesson's result is understood only if every step was understood, partly if any step was answered, and no check if nothing was. Until then no turn marks the lesson taught, read or checked. A lesson with Teach Me saved is taught by that, as before.

**Steps come from the lesson.** About three headings a step, at most three. The server decides, from the lesson's own headings. It is the lesson's size, not a fixed script.

**The clinical-risk question stays, and moves.** If the gate asks whether this is study or a real patient, it asks inside the panel and the panel carries on. No request is treated as study without the learner saying so.

## 4. What changes with the policy off

Nothing. Guide me is the hint form as it was, and an Explain stays an Explain.

## 5. Known limits

- Progress returning after a reopen is read from the kept checks, following the new questions feedback offered.
- Moved-on and explained states are held by the page for the visit: on reopen those steps read as not answered, and the saved teaching still returns with no AI call.
- A learner can reach "understood" on a retry after the feedback showed a model answer. This follows from showing that answer, and it is said as an informal check.
- A lesson that spans several materials is not saved (the existing rule), so its steps do not reopen free, and its guided activity cannot be counted as complete.
- A step the learner moved past because it could not be taught leaves the activity not complete. The panel says so.
- A library page may show fewer items than its size where Guide Me turns are hidden.
- Guide me needs Explain offered as well, because a turn travels as that kind.
- A learner's answer is judged against the lesson and what was taught, so an accurate point far from both can be under-credited. The instruction asks for credit, and a model decides.
- The notes test compares words and a few sense words, as in Go Deeper.

## 6. Rollback

Set `scholar_guide_me_adaptive` to off. No migration. Guide me returns to the hint form. Saved turns stay as taught ground.
