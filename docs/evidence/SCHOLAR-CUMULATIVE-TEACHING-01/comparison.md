# SCHOLAR-CUMULATIVE-TEACHING-01 — before and after on Bed bath (staging, 3 Nov 2026)

Material "Essential Nursing Care of the Critically Ill" (PPTX, 75 sections) uploaded to staging for the pilot fixture learner;
learning session 2b9fccd2 (document scope, 8 lessons as the planner stood on main). Lesson 2 "Bed bath" = slides 10–19: Skin &
Tissue Assessment, Bed Bath (x2), Skin Tears, Eye Care (x2), Eye Care Assessment (x2), Eye Care Essential Care Grade 1 and
Grade 2. The same lesson, the same passages and the same learner answers before and after; every request through the real
`learn/act` route on a staging dev server (main @ c15b6a04 for BEFORE, this branch for AFTER). Transcripts in this folder:
`before-bed-bath-A-B-D.md`, `before-bed-bath-C-D.md`, `after-attempt-1-bed-bath.md`, `after-attempt-2-bed-bath.md`,
`after-final-bed-bath-*.md`. Cost from `plat_ai_requests` (model, tokens, cost_usd per call).

Model routing was the same throughout (staging eligibility): Teach me, Guide me and Challenge me on claude-sonnet-4-6, Go deeper
and the clarification on claude-opus-4-8. No model was changed.

## Test A — Explain

| | Before (main) | After (branch, final run) |
|---|---|---|
| Form | OVERVIEW (1 sentence) + 8 KEY POINTS bullets + 2 check questions | OVERVIEW (2 sentences) + UNDERSTANDING (7 connected paragraphs) + 11 KEY POINTS + EXAMPLE + 2 reasoning questions + "Beyond your notes" |
| Words | 273 | 985 |
| Headings taught | bed bath, skin tears, eye care in bullets; the heat-loss / vasoconstriction mechanism (slide 12) absent | every heading in order, each said to lead to the next; heat loss → vasoconstriction → cardiovascular instability; tear film → blink response → complications; assessment grade → matched care |
| Source gaps | not named | named in the lesson ("the detail of what it involves is not in these passages") and in Beyond your notes (attempt 2: "The notes do not say why vasoconstriction from heat loss leads to cardiovascular instability …") |
| Grounding | shown, 1 part salvaged (+partial:1) | shown, nothing salvaged |
| Cost | USD 0.0137 (1929 in / 526 out) | USD 0.0285 (1040 in / 1691 out) |

## Test B — Go deeper, three rounds

| Round | Before (main) | After (branch, final run) |
|---|---|---|
| 1 | 251 words on EYE CARE only (nothing of the bed bath), free text, Opus, USD 0.0225 | OVERVIEW names what was taught and what remains ("the hands-on detail: how Grade 1 care is carried out and how it differs from Grade 2"); teaches the Grade 1 sequence and why, Grade 2 taping and why the lashes face outwards; Beyond your notes names the gap. 405 words, USD 0.0365 |
| 2 | the SAME saved answer, `cached: true`, 0 new words, USD 0 | a new round (keyed by the taught ground): bed-bath timing and length as physiology, pain and movement, skin tears as the same handling risk, and the tear-film physiology. Largely a re-development of ground the lesson had covered, with a few new links. 484 words, USD 0.0408 |
| 3 | the same saved answer again, USD 0; "Explain it a new way" regenerated with no context and was withheld ("the term positive") | see `after-final-bed-bath-BDO.md` (run after the hourly quota freed) |
| 4 | the same saved answer again | "depth reached": no AI call, the next activities offered (Challenge me, Practise, next lesson) |

Attempt 2 (before the block told each round in full) had rounds 1 and 3 additive (assessment system; Grade 2 taping and the Grade 1
examination) and round 2 a restatement of the Explain; attempt 1 (before the block was told round by round) had three rounds on
the same Grade 1 steps. The block's shape decided additivity more than the model did.

## Test C — Guide me (attempt with "it does not matter if the patient is cold", then "heat loss is only a comfort problem", then the right reasoning)

| | Before (main) | After (branch) |
|---|---|---|
| Availability | unavailable on staging until `explain` had an approved model ("AI help isn't available for this yet"); a saved Go deeper was listed under it as "guide" | available (staging fixture rows), label bug fixed |
| Step 1 | a 64-word hint: "You're on the right track that cleanliness is part of a bed bath — but your notes highlight something about heat loss …" The misconception (cold does not matter) was not named. | "Where you are": what is right (cleanliness), the misconception named and corrected from [S3] (heat loss → vasoconstriction → instability, so cold does matter), then "Next step" and ONE question (attempt 2, 153 words) |
| Step 2 | a pointer to [S3] | withheld for the word "again" in both attempts (fixed in c9486e97: "again" as the dialogue's once-more is excused); final run in `after-final-bed-bath-C.md` |
| Step 3 | scaffold, "so the last step is …" | confirms the mechanism is right, names what the reasoning has not yet considered (planning), one question (189 words) |

## Test D — Challenge me (reasoning rung) and the judgement of the answer

| | Before (main) | After (branch) |
|---|---|---|
| The question | withheld three times out of three ("the term positive": the model wrote "positive pressure ventilation" for the notes' PPV) | shown: "A patient who was Grade 1 on assessment is found during the examination step of Grade 1 care to have chemosis: given what your notes say about both the causes of chemosis and the grading system, why might this finding alone not be enough to move the patient to Grade 2, and what specific finding would justify that move?" — a reasoning question linking two ideas |
| The judgement | never reached | attempt 2: withheld for "[S7, S8, S9]" read as the numbers 7, 8, 9 and for "again" (both fixed in c9486e97); final run in `after-final-bed-bath-BDO.md` |
| The next rung | never reached | asked with the first check as context (attempt 2: "why should this finding prompt you to reconsider the grade assigned rather than simply continuing with ointment application?") |

## Scoring (spec section 12; 0 = absent, 1 = weak, 2 = adequate, 3 = strong)

| Criterion | Before | After | Note |
|---|---|---|---|
| 1 Educational depth | 1 | 3 | bullets → connected teaching of every heading |
| 2 New understanding introduced (per Go deeper) | 0 | 2 | round 1 new; round 2 partly new; round 3 pending |
| 3 Accuracy | 2 | 3 | every sentence cited and checked; nothing salvaged in the final Explain |
| 4 Source grounding | 3 | 3 | unchanged control; false positives reduced (PPV, "again", one-bracket citations) |
| 5 Mechanistic explanation | 0 | 3 | tear film, blink, heat loss → vasoconstriction, grade → care |
| 6 Conceptual relationships | 1 | 3 | assess → act, grade → matched care, skin → eyes |
| 7 Clinical application | 1 | 2 | timing, pain relief, matched care; a worked example |
| 8 Reasoning quality (Challenge me) | 0 (withheld) | 3 | questions require linking two ideas and deciding |
| 9 Repetition | 0 (identical cached rounds) | 2 | each round new text; round 2 re-developed taught ground |
| 10 Adaptation to learner responses | 1 (hint only) | 3 | misconception named and corrected; next step built on the attempt |
| 11 AI cost | 2 | 2 | see below |

## Cost

| Run | AI calls | Input tokens | Output tokens | USD |
|---|---|---|---|---|
| Before (A, B x3, C x3, D) | 8 | 13,488 | 2,287 | 0.093 |
| After, attempt 1 (A, B x3, C x3, D) | 8 | 17,502 | 4,761 | 0.167 |
| After, attempt 2 (A, B x3, C x3, D x4), incl. the regression lesson | 18 | 35,103 | 13,295 | 0.429 |
| After, final (A, B x2 so far) | 3 | 5,705 | 3,852 | 0.106 |

Per interaction: Explain USD 0.014 → 0.029 (twice the output, 3.6x the words); a Go deeper round USD 0.022 → 0.037–0.041 (Opus; the
block adds ~900 input tokens); Guide me USD 0.007 → 0.009–0.011; a Challenge question USD 0.006 → 0.007; a clarification on
Opus USD 0.027. A full A–D journey costs about USD 0.25 after against USD 0.09 before, but the before journey produced one lesson
and two zero-cost repeats; the after journey produces a complete lesson, three distinct rounds and judged reasoning. No model
change is recommended: the gains came from the prompt, the context block and the orchestration.

The hourly limit of 30 AI requests per learner (`aiPreflight`) stopped the final run after Go deeper round 2 at 15:21 UTC; the
remaining stages were run as the window freed.
