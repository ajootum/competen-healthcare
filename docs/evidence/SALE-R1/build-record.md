# SALE-2026-11 R1 (Adaptive Core) — build record

Branch `scholar/sale-r1-adaptive-core` from `origin/main` 661caf17. **No migration.** No production write. Staging only (ezhvpgtcqcdsgylrxgdb).

## What was built (rows SALE-04..07)
- **SALE-04** `learning-state.ts` (pure) + `learning-state-data.ts` (read): per topic, nine dimensions (exposure, understanding, misconceptions, independent recall, delayed recall, application, stated confidence, activity, evidence quality and recency). Derived each time from 414 events (+event sources), 416 attempts (CYU 950 checks and practice), 372 reviews, 720 OSCE runs; same topic join as Progress by topic. Word states only (No evidence yet / Not enough evidence / Some evidence / Stronger evidence), never a percentage or score; one right answer is "not enough evidence"; never competence. Learner view on Progress ("What your evidence shows, by topic") with the answers behind it and the existing topic correction (`/api/individual/scholar/topics`) plus a link to My competencies for competency links.
- **SALE-05** `learning-need.ts identifyNeed`: rules N1..N6 from the rubric parts of the judgement (right / missing / misconceptions), repeated misses across DIFFERENT questions on the same sections, and known misconception tags (`misconception.ts sameMisconception`).
- **SALE-06** `TEACHING_RULES` T1..T6: understood→Challenge me (Apply where the question was application and a case exists), misconception→Explain my mistake, factual gap→Simplify, reasoning error→Guide me, prerequisite gap→the earlier lesson (no AI), unclear→continue. Fallbacks are said in the reason. AI unavailable → only no-AI moves.
- **SALE-07** `decideNext` + lesson UI (`learn-adaptive.tsx`): corrective rounds capped by `scholar_adaptive_reteach_max` (then "Save for review", the missed check already being a 372 card); a DIFFERENT question next (lesson's own unanswered, then an earlier kept check of the same sections, then the existing Ask me action); the decision kept on the same 416 attempt `response.adaptive` (rule, reason, evidence, round, the step it followed and whether the question differed). Always skippable; nothing runs until chosen. Model eligibility and routing unchanged; question generation untouched.
- Optional learner-stated confidence on a check (`response.confidence`), never counted as understanding.
- Policy keys (HQ, code defaults): `scholar_learning_state` (on), `scholar_learning_state_min_evidence` (2), `scholar_learning_state_distinct_questions` (2), `scholar_learning_state_delay_days` (3), `scholar_learning_state_stale_days` (30), `scholar_adaptive_teaching` (on), `scholar_adaptive_reteach_max` (2), `scholar_adaptive_prerequisite_misses` (3).

## Defects fixed on the way
1. `mastery-data.ts`: a 950 `unmarked` check attempt was read as an app-marked WRONG answer in Progress by topic / Study next. Now skipped.
2. Found by the staging walk: the judgement's misconceptions part can say "Nothing to correct — …" with a trailing clause (`learn-check.ts isNonePoint` drops only the bare phrase). `learning-need.ts isNoMisconception` stops that being read as a misconception (unit-tested both ways).
3. `progress-parts.tsx Fold` / topic details: `suppressHydrationWarning` on native `<details>` (the browser restores an open disclosure before hydration on a revisit).

## Staging walk (fixture learner, phone width 390, dev server 3181 → staging)
Script `walk/sale-r1-walk.ts`; logs and JSON per run in `walk/`; shots in `walk/shots/`.
- Run `walk-390-run-transient500` (session 71c00aeb, lesson 8): wrong answer → **misconception → Explain my mistake** (T2) with its reason shown; corrective step ran; **different question** ("Why might a change go through several PDSA cycles rather than just one?"); right answer → **understood → Challenge me**, reason "After explain my mistake, you answered a different question well. That is stronger evidence than the same question again."; Progress understanding **14 → 15 different questions answered well**, "latest answer not fully right" gone. One transient 500 on the follow-up (server log: connect timeout to staging, then a JSON parse error in the AI step); the identical retry succeeded.
- Run `walk-390` (final, same lesson): all product checks PASS, **0 console errors, no 5xx**; with the lesson's own questions used, the different question came from **Ask me**; the follow-up was missed again and the decision was **prerequisite gap → the earlier lesson** (N3/T5, three different questions missed), round 2, linked to the step it followed. (Its one FAIL line is the script not reading an Ask-me question's text; fixed in the script afterwards.)
- Run `walk-390-cap-reached` (session 2b9fccd2): third corrective round on one lesson → **"Save for review and carry on"** (cap 2), no further explanation.
- Every run: Progress fits 390px, no percentage in the learning state, the not-verified-competence note shown, topic correction offered.
- Staging rows left for the fixture: kept check attempts (with `response.adaptive` / `confidence`) and teaching events on sessions 2b9fccd2 (step 1), 8b37b80b (step 6), 71c00aeb (step 7); AI calls for Explain my mistake, Ask me and judgements.

## Checks
See the PR body for the final gate results (clean tsc, ci-harnesses, full vitest, eslint).
