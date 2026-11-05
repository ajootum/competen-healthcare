# Evaluate and My Progress: evidence

Owner directives, 5 Nov 2026: goal-first Evaluate redesign, final alignment of Evaluate and My Progress, and the two HTML mock-ups as design references. Walks ran on staging with the fixture learner, never on a real learner. No migration.

## Files

- `walk.txt`: results on staging. `walk.json`: what was recorded. `shots/`: screens at 1440, 820 and 390 px.

## The split

| Evaluate: where an evaluation is taken | My Progress: read-only report |
|---|---|
| My Plan goals (default), beside Start an evaluation | Overview: goals, coverage, accuracy, cards due, activity, confidence, evidence, framework coverage, priorities |
| My Competencies | My Goals: planned activity beside outcome checks, and saved evaluations over time |
| My Learning: a topic, material or outcome | Competencies: learning evidence beside self-assessment, approved stage and verification |
| Clinical Reasoning: case, OSCE, adaptive exam, or a clinical context | Learning: evidence by dimension, and the full detail |
| Monthly Review | History: search, reopen, compare |
| Evaluation history, next steps to accept, put off or dismiss | Practice & achievements: the earlier page, unchanged |

## What reuses what

Both screens read through `evaluateScope` and the same records, so a completed evaluation shows in My Progress without being repeated. There is no second scoring engine and no new table.

| Need | Existing record or service |
|---|---|
| Goals | My Plan settings and the learner's own calendar entries, read only |
| Evidence by dimension | `evaluation.ts`, its rules unchanged |
| Competencies | The learner's catalogue, accepted links, self side, stage side, Passport verification |
| Snapshots | `individual_scholar_evaluation`, with its results, evidence references and confidence |
| Recommendations | Next best actions, with accept, later and dismiss on the existing plan events |
| Fresh checks, cases, OSCE, monthly reviews | Their existing routes and records |

## Rules

- Planned activity, an outcome supported by evidence, a learning gap and insufficient evidence are four separate states.
- An outcome counts as supported only with two supported dimensions, one of them application or reasoning, and more than insufficient confidence. Reading alone can never reach it.
- Not assessed, and too little evidence, are never shown as low results.
- A review of existing evidence is labelled as adding no new evidence. It creates no attempts, so it cannot move any figure.
- No overall percentage and no stage is worked out here. Practice accuracy stays on its own tile, and the page says measures are not averaged.
- Sections are named by topic or heading, with the exact link kept.

## Not verified

- Pilot learners' own records and plans: agents do not sign in as them.
- Competency rows on real data: the fixture has no framework applied, so only the no-framework state was walked. The rows are covered by reading the code and by unit tests of the status rules.
- A fresh check run end to end from a goal. The walk fills in the goal and the form, and saves reviews of existing evidence. Fresh checks use the existing route, which was not changed.
- Self-assessment, stage and verification values shown against a real competency, for the same reason.
- A real phone or tablet, and load time with a large record.

## Limits

- A goal is a My Plan priority, or the goal text where there are none. My Plan has no separate list of goals with intended outcomes.
- A goal is matched to learning by a text search of the notes, and to calendar entries by the words in their titles.
- Competency detail shows the first 8 with evidence, and links to My Competencies for the rest.
- Saved evaluations from before this change still name sections by page or slide.
