# SCHOLAR-OSCE-01 s11 acceptance (Respiratory Assessment OSCE) + Adaptive Exams -- staging, 31 Oct 2026

Harness: `scripts/scholar-practice-acceptance-harness.ts` (STAGING_ONLY in `scripts/ci-harnesses.ts`).
Target: staging `ezhvpgtcqcdsgylrxgdb` (migrations 710, 720, 721), dev server `http://localhost:3100` at `97e9a493`
(`scholar/practice-exams-01`). Every check reads a real output: route replies, stored rows, rendered page HTML.

Three full runs were made. Run 3 is the record (49 passed, 2 failed, 1 pending). Runs 1 and 2 are cited where they
showed a behaviour run 3 did not.

## Result per acceptance point

| # | Point | Result | Evidence (run 3 unless stated) |
|---|-------|--------|--------------------------------|
| 1 | Select and start a respiratory station | PASS | OSCE page lists "Respiratory assessment and escalation"; POST stations (template) 200, a second select returns the same station (`existing: true`); POST attempts 200, `resumed: false`, `durationMinutes: 8`. |
| 2 | Instructions and clinical context | PASS | Station page HTML shows scenario, task, objectives, 8 minutes, the four headings, body system, "Any healthcare profession", the practice label, "Start the station". Assessment guidance and suggested responses are absent before a run. |
| 3 | Timer works, completion recorded | PASS | Server start + server clock returned; a reload resumes the SAME run with the start unchanged (465 s left); finish records `finished_at`, `duration_seconds` 21, `time_up` false. Time-up (start moved back 9 min, simulated): returning finishes the run with what was saved, `time_up` true, 480 s (capped); a late autosave is refused 409 and the run finished with the last save. |
| 4 | Structured written responses | PASS | Autosave keeps text under the station headings (an unknown heading dropped); an NHS number is refused 422 and not saved; reload returns the autosaved text; continue + finish keeps all four sections; a finished run cannot be finished again or overwritten. |
| 5 | Checklist criteria and critical flags | PASS | Run snapshot: version 1, 10 items, 5 critical. Self-check page shows all 10 criteria and the "▲ Critical" tag (word + symbol). |
| 6 | Self-review | PASS | Partial marking refused ("Mark every checklist item (9 not marked yet)"); full marking stored once: score 0.6 = 6/10 (done 1, partly 0.5), `critical_missed` 2; without AI it is `self_graded`, no evaluator. |
| 7 | Optional AI feedback through an eligible educational model | PASS on routing / FAIL on reliability | When shown: `claude-sonnet-4-6` (eligible for `evaluate`, tier clinical_educational), six parts, suggested ticks for checklist ids only, rate and SpO2 suggested missed (they were not written), no pass/mark/competence words; marking recorded `ai_evaluation` with the evaluator model. BUT the reply is withheld by its own grounding check about half the time (defect D1). |
| 8 | Strengths, gaps, revision activities | PASS | Strengths = done items; gaps critical first; `Learn:` links on each weak item (critical first) then "Go to Revise"; score explanation 4 lines ("A high score does not cancel a missed critical item", "not a pass or a fail"); guidance only after marking. Results page HTML shows the critical panel, the explanation and "Guidance for this station". |
| 9 | Attempt and learning history preserved | PASS | 4 runs kept (finished, time up x2, abandoned) with responses, snapshot and (marked) ticks, score, gaps, revision suggestions; station page lists "8:00 (time up)", "discarded", "Not marked yet", practice scores; station list shows "4 runs · last: Practice score ...". Note: OSCE runs are not part of the Scholar Progress history (only the OSCE pages read them). |
| 10 | No verified competency, DACUM grade or Passport-verified record | PASS | 28 tables counted before/after by SQL (competency_verification_*, assessments*, competency_assessment*, estate osce_*, individual_professional_item_verification, individual_scholar_passport_*, individual_passport_*, passport_share_tokens; no DACUM/rating table exists): no change. Stations are `review_status = private_formative`. |
| 11 | Unreviewed content clearly identified | PASS | Template stored and shown as "Competen practice template — not clinically reviewed"; AI station from the note stored and shown as "AI-generated from your notes, not clinically reviewed", each item quoted word for word from the note (run 1: the same request was withheld `ungrounded_brief`, nothing kept, recovery offered). No governed library station is published on staging (0). |
| 12 | Mobile / tablet | coordinator | Browser check by the coordinator (fixture below). |

## Adaptive Exams (programme-aligned, short respiratory note)

Setup: the note (1 section) uploaded, programme `nursing-ug-diploma` chosen, the section linked (accepted, by the
student) to `COMP-RESP-001 Performs a systematic respiratory assessment`. Scope `programme`, length 5, start standard.

- Exam 2 (mcq + short), answers right, right, right, right, missed: asked difficulty
  standard > standard > standard > harder > harder (finish harder) -- the rule moved it up after three right. PASS.
- Report label is exactly `Practice estimate from rule-based adaptation — not a calibrated exam score, not a formal
  examination result, and not verified competence.`; score measured 80% of 5; by competency COMP-RESP-001 4/5;
  strengths "Respiratory assessment lecture", "Performs a systematic respiratory assessment"; gap "Respiratory
  assessment lecture" with "Go over Respiratory assessment lecture". PASS.
- History: GET /revision/adaptive lists both exams completed, 5 answered, 80%. The report page (`?session=`) shows the
  label. The Adaptive list page itself returns 500 (defect D2). FAIL on the page.
- No correct index, rationale or accepted answer reached the browser before an answer. PASS.

## Defects (product code unchanged)

- **D1 (point 7) OSCE AI feedback withheld for faithful feedback.** `generation.ts:1139-1143` checks the feedback with
  the Practice-document `groundingViolations`; `osce.ts:622` withholds on any violation. Its ASSERTION_MARKERS
  (`src/lib/ai/grounding.ts:42,47`: "marked", "normal", ...) and number words (`grounding.ts:68`) collide with ordinary
  evaluative wording. Route asks: run 1 withheld (1/1), run 2 withheld then shown, run 3 shown. Three direct replays of
  the same prompt on `claude-sonnet-4-6`: 2 of 3 withheld, tokens `two` ("the two most time-sensitive objective
  measurements") and `marked` + `normal` ("Consent is marked critical", "rather than a general normal value"); the
  feedback itself was accurate in all three. 4 of 7 model replies withheld overall.
- **D2 (adaptive history) Adaptive list page 500 once a learner has any adaptive exam.** `study/revise/adaptive/page.tsx:119`
  (and `:56`) call `adaptiveHref()` from a Server Component; it is exported from the `"use client"` module
  `_components/adaptive-client.tsx:1,37`. Reproduced with a probe learner: 200 with consent, programme, material and
  links; 500 as soon as an exam exists (in progress or finished). The `?session=` report page is unaffected.
- **D3 (adaptive) no new questions once any exist at a section/format/difficulty, even if all are used in this exam.**
  `adaptive-service.ts:203` builds `existing` from the whole pool, not the unseen ones. Run 2 (mcq only, one section):
  exam stopped at 2 of 5 ("There were no more questions to offer ..."), so the path could not change. Run 3 completed
  only by offering the "nearest" difficulty (easy for a harder ask) with the same note.
- **D4 (adaptive report) questions written for the exam's first pick counted as "stored".**
  `adaptive-service.ts:286` counts `generated` from `session.createdAt`, but `revision/adaptive/route.ts:61` writes the
  first questions (chooseNext) before the session is created (`:67`). Run 3 exam 1: report generated 4 / stored 1;
  all 5 were written during the exam.
- Observation (low): the brief already carries the full checklist with critical flags in the page payload
  (`[stationId]/page.tsx` passes `stationView(...)` with the checklist to `OsceRunner` during the brief), although the
  copy says the checklist is shown after the station. Not visible on screen.

## AI routing and cost

Every AI call by the fixtures ran on a model eligible for its activity and on a configured route (plat_ai_requests;
metering off): A `evaluate` claude-sonnet-4-6 (feedback), `questions` claude-opus-4-8 (station from notes); B
`questions` claude-opus-4-8 (mcq / short generation + verify, 8 calls). No refusal, no failed call.
Cost: run 3 $0.1778, run 2 $0.1162, run 1 about $0.07 (stopped early), feedback replay $0.0279, D2 probe about $0.03.
Total about $0.42.

## Staging

No staging setting was changed (OSCE and adaptive exams are on by default); the platform/individual override rows are
byte-for-byte as before (Z1). Fixtures removed (Z2). Kept on purpose for the coordinator's browser check:
`harness-osce-browser@competen.test` with one respiratory template station; its password is only in the local
fixture file, never printed or committed. Remove it with `OSCE_REMOVE_BROWSER_FIXTURE=1` (same command).
