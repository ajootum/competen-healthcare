# Apply connected to longitudinal learning, and My Practice Library: evidence

Owner directive, 5 Nov 2026. Walks ran on staging with the fixture learner, never on a real learner. No migration.

## Files

- `walk.txt`: 45 PASS, 0 FAIL, with real AI calls. `walk.json`: what was recorded. `shots/`: screens at 1440, 820 and 390 px.
- Walk script kept in the working tree only: it reads staging with the service role and is not part of the app.

## What reuses what

| Need | Existing record reused |
|---|---|
| What was studied | Attempts, reviewed cards, lesson steps the learner reached, case debriefs |
| What sections are about | Chunk analysis concepts, competency links, and the section's own text where neither exists |
| Learner priorities | My Plan settings, read only |
| Generating the case | `runCaseBlueprint` and `checkPrivateCase`, unchanged rules, with one added instruction |
| Stored activity | `individual_scholar_case`, `_case_source`, `_case_competency` (435) |
| Attempts and feedback | `individual_scholar_case_session`, `_case_answer`, attempt snapshot (435, 810) |
| OSCE, papers, scenarios | Existing OSCE, examination paper and case-question records |

## Verified on staging

- An integrated case written from 3 related sections the learner studied, with the reason shown, and stored with its sources and generation version `scholar-case-blueprint-v4+connected-v1`.
- Completing it keeps every submitted response. Its feedback reopens with the exact case.
- Practising again is a new attempt. The first attempt's answers are unchanged, the stored case's hash is unchanged, no new case appears, and no AI outcome is recorded.
- Search by title and by source finds it. Format and gap filters work.
- Another learner's attempt is not found, their case cannot be played, and it is not in this library. Signed out is refused.
- A topic with nothing studied says so, with no AI.
- No sideways scroll at 820 and 390 px.

## Found by the walks, and fixed

- A recommendation first led with a quality-improvement section with no patient in it. The engine's own readiness check now decides what can lead a case.
- Relating sections by text first pulled in unrelated material. Related now means a shared competency, 2 shared concept words, or 4 shared words of text.

## Not verified

- **A case across two materials, on real data.** The fixture has no second material related to its clinical notes, so its cases drew on one. The rule that reaches across materials is covered by unit tests only. It needs a learner who has studied related topics in two documents.
- **A real material deletion.** Agents do not hard delete. On staging, read only, each case was found through its source sections for withdrawal and deletion, and another learner's material returned nothing. The delete itself is covered by reading the route, not by running it. Backups follow the existing retention policy, which is still with counsel.
- Pilot learners' own records: agents do not sign in as them.
- A real phone or tablet.
- Time to load with a large record.

## Limits

- Scholar only reads the 80 most recent studied sections for what they say on one request. Older ones can still be chosen by their concepts and competency links.
- A section that was never analysed has no concepts. It is related to others by the words in its text, which is less precise.
- Materials have no archived state, so nothing is hidden by age.
- A learner gap is what a finished case's debrief recorded: findings never asked for, safety events, and choices marked wrong. Written answers are not counted, because code does not mark them.
- Compared with the mock-up: no time estimate, because none is measured. No "Mixed integrated practice", because no engine produces it. OSCE and papers are reached from the format cards, not generated from all learning. A library case still comes first when one fits, as policy requires.
