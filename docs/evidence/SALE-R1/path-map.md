# SALE-2026-11 R1 (Adaptive Core) — path map (targeted delta inspection, 4 Nov 2026)

Base: `origin/main` 661caf17 (prod app 09d9da09, DB head 960). What exists, and what R1 reuses.

| Need | Exists (reused) | Gap R1 fills |
|---|---|---|
| Exposure | 414 `individual_scholar_learning_event` (+ `_source` chunk links, 920 `read`) | per-topic exposure read (`store.learningExposure`, events joined to sections in memory) |
| Answers / marking | 416 `individual_scholar_attempt` (correct, score, marking, `content_version` 950, `response` jsonb) read by `store.masteryEvidence` | attempt `id` and rubric misconception tags added to that same read |
| CYU kept checks | 950 `event.attempt_id`; `learn-check-record.ts` (`checkResponse`, `parseCheckResponse`); `store.listCheckAttempts`; act route D01 block; checks route (self-graded) | optional learner-stated confidence + the adaptive decision kept inside the same `response` jsonb (no column) |
| Rubric snapshots | 791 `attempt-snapshot.ts` (revision/exam integrity) | not touched |
| Missed check → card | `recordCheckAttempt({missed})` → `missCard` (372) → Revise / My Plan | reused as the "review" (loop cap) step |
| Misconception next | `misconception.ts` (rubric misconceptions, recent misses, reorder) | reused (`same`, `signalsOf`) for repeated-misconception detection |
| Mistake notebook | `mistakes.ts` | not touched (reads attempts) |
| Topic progress / Study next | `mastery.ts` + `mastery-data.ts` (percent + status words) | NOT extended with a number. Defect fixed: a 950 `unmarked` check attempt was counted as an app-marked wrong answer |
| Spaced repetition | 372 cards/reviews (`individual_scholar_review`) | reviews read as recall evidence |
| TAUGHT SO FAR | `learn-context.ts` (prior checks, rounds) | unchanged; the follow-up check still joins it |
| Approaches | config `LEARN_ACTIONS` (teach, explain, simplify, deeper, examples, summary, ask) + teaching actions (ask_me, guide, challenge, mistake, teach_back, high_yield); Go deeper cap policy | the rule table selects among these only; routing/eligibility untouched |
| Saved explanations | 415 artefacts; act route opens a saved simplify/explain/examples before generating | "prefer saved" is the existing artefact path |
| Competency mapping | 388/390 maps + decisions (`decideMapping`), `setTopicCorrection` (408) + `/api/individual/scholar/topics` | the learner view offers the existing topic correction for the sections behind a topic |

## R1 build (no migration)
- `learning-state.ts` (pure) + `learning-state-data.ts` (read): SALE-04 dimensions per topic, word states only, "not enough evidence", never competence.
- `learning-need.ts` (pure): SALE-05 identification + SALE-06 rule table + SALE-07 loop (cap, different question, record).
- act route (clarify) and checks route (self-graded): compute the decision, keep it in `response.adaptive`, return it.
- Learn lesson check panel: "Your next step" with the reason, the approach button, a different question, and Skip.
- Progress "Learning progress by topic": "What your evidence shows" per topic, with the evidence and topic correction.
- Policy keys (HQ, code defaults): see PR body.
