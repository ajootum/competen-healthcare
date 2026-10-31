# SCHOLAR-SESSION-AI-02: staging acceptance, 31 Oct 2026 (slice D)

Harness `scripts/scholar-sessions-acceptance-harness.ts` (STAGING_ONLY in `scripts/ci-harnesses.ts`), run over HTTP against the dev server at `http://localhost:3100` (checkout `competen-p2` detached at f495a8c8 = slices A-C, before the Part 2 UI gaps), staging project `ezhvpgtcqcdsgylrxgdb`, migration 740 present. Fixtures: A (respiratory + renal text notes, topic session "respiratory distress"), B (second learner), browser fixture (kept).

Policy `scholar_study_sessions`: no override before the run; set ON (draft + publish) for the run; removed again in Z (Z1: platform/individual rows byte-for-byte as before).

Attempts: run 1 had 6 failing checks, all harness faults (Home is `/individual/scholar`, not `/study`; `individual_scholar_attempt.revision_session_id` column name; B pages echo the caller's own `?study=` parameter so the id check was wrong; OSCE filter form needs a station first). Run 2: 35/2 (OSCE filter ordering; one ask withheld `bad_citation` by the unchanged grounding check, model variance, run 1 had passed it). Run 3 (final): **ALL GREEN, 37 passed, 0 failed**. No product code was changed to make a check pass.

| Check | Result | Evidence |
|---|---|---|
| S0 start connected | PASS | Learn start `connected:true`, topic scope: row `connected=true`, `scope_kind=topic`, reply carries the 4-stage bar |
| H1a-g cross-stage | PASS | Learn, Revise, Apply, OSCE list, Evaluate with `?study=` each render `data-testid="study-session-bar"`; Revise `scope={kind:topic,topic:"respiratory distress"}`; OSCE `q` input `value="respiratory distress"`; Evaluate `defaultScope` topic; control pages without `?study=` have no bar/prefill; `last_space` learn > revise > apply > evaluate |
| H2a-c zero AI on navigation | PASS | `plat_ai_requests` for A 0 -> 0 over all page GETs and the second device's Home; B 0 -> 0 over six foreign-id GETs; A 3 -> 3 over the post-link GETs |
| H3a-d linking | PASS | OSCE attempt and revision session created with `studySessionId` give `osce_attempt` + `revision_session` link rows (owner A); B's attempt naming A's id is created, no link row (links 2 -> 2); unknown id links nothing; bar shows "1 activity" for Revise and Apply |
| H4a-b isolation | PASS | B GET `?study=<A id>` on Learn, Revise, Apply, OSCE, Evaluate, Home: 200, no bar, none of A's title/topic; page identical in length to the plain page |
| H5a-c resume | PASS | fresh sign-in; Home shows "Continue your study session", link `/individual/scholar/study/evaluate?study=<id>`; following it shows the bar and scope |
| H6a-d tutor context | PASS | one ask (attempt 1 of max 3): 200, not withheld, `[S1]` in text, `cited:[1]`; `audit_log.new_value.study_context = ["focus","sources","misconceptions","progress"]`; `prompt_version = scholar-learn-v3:ask+scholar-study-session-v1` (audit and reply provenance); one `plat_ai_requests` row `individual_scholar_learn:ok` sharing the audit's `action_id`. "feedback" absent because the OSCE run had no gaps yet (unit-covered) |
| H7a | PASS (partial) | the recorded study_context is section names only, from the five fixed names |
| H7b | unit-covered (not run) | `study-session-context.test.ts` (Professional / own_development / employer fields ignored). No Professional-need helper exists in the Scholar harnesses |
| H8 D5 | PASS | 16 tables (`individual_scholar_evaluation`, `competency_verification_*`, `individual_scholar_passport_*`, `individual_passport_share_*`, `passport_share_tokens`, `individual_professional_item_verification`) counts unchanged before/after |
| H9a-d end/delete | PASS | PATCH `status=completed` keeps the session readable ("Study session · ended"), links kept (2), no longer offered as Continue; deleting the session row removes its 2 links (cascade) and leaves the OSCE attempt, the revision session and the answer; `?study=<deleted id>` behaves as absent |
| BF browser fixture | PASS | `harness-sessions-browser@competen.test` kept: notes, ACTIVE connected session, 1 linked OSCE run; credentials in `sessions-browser-fixture.txt` (scratchpad) only |
| Z1, Z2 | PASS | policy removed/unchanged; harness fixtures gone |

## Unit-covered (not run here)
withStudy and all `*Prefill` mappings, `chooseOutcome`, stage marks: `study-carry.test.ts`. Loader gates, ownership, `last_space`: `study-context.test.ts`. Seven sources, words only, cap/drop order, determinism, identifier screen, Professional ignored: `study-session-context.test.ts`. Route wiring, prompt and version: `study-session-wiring.test.ts`. Store link functions, RLS/composite-FK shape: `study-session.test.ts`, `scholar-learning-harness`. Policy gate: `policy.test.ts`. Browser 375/768/1440 (check 12): slice E, coordinator.

## Findings
1. `learn/sessions/route.ts` normalised `objectiveText` with `/s+/g` (the letter s) instead of `/\s+/g`: it would have turned "Study this" into "Study thi ". Fixed in Part 2 by the pure `cleanObjectiveText` (unit-tested). The harness does not start a session with `objectiveText` and the staging server (f495a8c8) does not have the fix.
2. `flashcards-layout.test.ts` regex broke when slice B added `studyId` after `container`; test regex loosened (not a product change).
3. There is no delete-session route. A session disappears with its last material (`pruneEmptySessions`) or with the account; H9c deletes the row directly to prove the cascade.
4. The Personal AI `bad_citation` withhold can occur on an in-notes question (once in 4 asks over runs 1-3); it is the existing grounding check, unchanged by the study block.
