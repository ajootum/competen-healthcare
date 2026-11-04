# SALE-2026-11 R2 (Retention) — path map (4 Nov 2026)

Base: `origin/main` ab25a09e (prod app 6e679c29, DB head 997; 998 pending). What R2 reuses, and the gap it fills.

| Need | Exists (reused) | R2 adds |
|---|---|---|
| The learner's evidence per topic | R1 `learning-state-data.ts` join (416 attempts incl. CYU 950 checks, 372 card reviews, 720 OSCE, 414 exposure) | the join is now `readStateInputs`, shared by the learning state and all three R2 reads (one read, one topic rule) |
| Spacing rule | the shared SM-2 `delivery/reinforcement.ts sm2` via `revision.ts scheduleReview` with the policy's SRS bounds (`scholar_srs_*`) | `retrieval-schedule.ts` replays a topic's answers (one per day) through the SAME `scheduleReview`; no second algorithm |
| Cards | 372 cards and their own schedule; the missed-check card path | topics known only from cards follow the cards (rule S7); the action is "review the due cards" |
| Study time, exam, priorities | 780/840 study plan (`getStudyPlan`: exam date and label, days a week, session minutes, priorities) | read only (S4-S6); nothing is written to My Plan |
| Surfaces | Revise page, Progress "Study next" (`mergeStudyNext`), R1 "What your evidence shows" | "Due for retrieval" on Revise; due items in Study next (where My Plan is off); per-topic lines in the learning state |
| R3 consumption | — | `retention-data.ts loadRetrievalSchedule(admin, userId, policy, now, { today, sources?, inputs? })`: null while off; items name an action (kind, label, href), minutes and reasons |
| Framework prerequisites | Holdings-scope `competency_dependencies` read by `competency/foundation.ts` (`links.prerequisites`) for the offered, published, allowlisted catalogue | carried through the Scholar projection (`catalogue.ts prerequisites`, additive, only when present); `prerequisite.ts` rules P0-P4 |
| Section-to-competency links | 388 maps + decisions, accepted only (`listMappings`) | read only |
| Earlier-lesson rule | R1 `learning-need.ts` N3/T5 (foundation = the earlier lesson of the session) | unchanged; where the framework lists a prerequisite, `learning-need-service.ts adaptiveDecision` adds it to (or, with no earlier lesson, makes it) the foundation step; "Your next step" shows the link |
| Transfer questions | revision sessions route (saved questions, then the governed library, then generation through the same gate, allowance and routing); `library-questions.ts`; `insertLibraryCopies`; 417 sessions; the ordinary answer route and runner | `transfer.ts` (lesson context, "outside" labels, rule X1), `api/individual/scholar/transfer` (offer with no AI; or hand the generation to the existing sessions route, then record); migration 970 records the check |
| Transfer evidence | R1 learning state "Applying it" (A1) | rule A2: a transfer answer counts as application evidence and is said apart ("Transfer checks: n of m answered well"); the evidence line says "(transfer check)" |

## Not changed
Model routing, eligibility, prompts and question generation; the answer route and its marking; My Plan; competency stages; Passport; the 372 card schedule.
