# SCHOLAR-SCENARIO-VARIETY-01: evidence

Owner GO of 6 Nov 2026, section 6: meaningful variation in presentations, progression, nursing decisions, difficulty and formats, from existing material first. Grounded in source, no fabricated patient facts, no answer in the introduction, no unsupported deterioration, safety marking and staged disclosure kept, no superficial name or demographic changes, no model calls added by default.

## What changed

One guidance block on the call that was going to happen anyway.

Revise writes one scenario per section at the current prompt version (`planGeneration`), so a learner meets new scenarios across the sections of a scope, not on the same section. So the decision focus moves with how many scenarios the scope already has: recognise, prioritise, respond, escalate, prevent. The learner's other scenarios, including those written earlier in the same request, are passed as data so they are not retold.

If a section ever has a second scenario, it also starts from a sentence the first did not start from. **The live route does not reach this today**: the planner does not write a second scenario on a section. An independent read caught that, after my first test had run only on the same section. Whether to allow it is an owner decision, because it adds model calls.

The prompt and its version are untouched, so stored scenarios stay valid. Every existing check still decides what is kept. No migration, and no new database read.

## Counted staging test

Fixture learner, staging, real model, calling the real generator directly. 18 calls in all, recorded in a ledger. The first ten runs below are on one section and show the same-section path, which the live route does not reach. The last three are the path a learner takes.

| Run | Focus | Calls | Kept | Dropped by the checks |
|---|---|---|---|---|
| First design, short section | recognise | 2 | 1 | ungrounded_reveal |
| First design, short section | prioritise | 2 | 1 | reveal_plan |
| First design, short section | respond | 2 | 0 | ungrounded_opening twice |
| With a named starting sentence | prioritise | 1 | 1 | none |
| With a named starting sentence | respond | 1 | 1 | none |
| After excluding headings | respond | 1 | 1 | none |
| Longer section, first scenario (no steer) | recognise | 2 | 0 | ungrounded_number, answer_leaked |
| Longer section | recognise | 1 | 0 | stopped by the call cap |
| Longer section, second scenario | prioritise | 1 | 1 | none |
| Longer section | respond | 1 | 0 | stopped by the call cap |
| **Across sections:** section 1 | recognise | 1 | 1 | none |
| **Across sections:** section 2 | prioritise | 2 | 0 | ungrounded_number, ungrounded_reveal |
| **Across sections:** section 3 | prioritise | 1 | 1 | none |

**Cost.** It adds no model calls by design: the planner, the number of calls and the retry are unchanged. Calls per kept scenario did not get measurably worse: the earlier baseline was 24 calls for 9 kept (2.7 each), and the across-sections runs took 4 calls for 2 kept (2.0). The samples are too small to claim a saving. The added text is at most about a kilobyte per call.

**Across sections.** Section 1 asked which sign to notice first; section 3 asked what to do first and then what a new finding means. Section 2 was dropped by the checks, so the focus stayed on prioritise for the next section.

**Same section (not reached in the live route), first question and the sentence it rests on:**
1. "Which observation is often the first sign..." rests on the respiratory-rate sentence.
2. "What should the team use to bring together this person's observations now?" rests on the early-warning-score sentence.
3. "How should the team escalate their concern about this person now?" rests on the SBAR sentence.

Before the named sentence, the first two scenarios opened with almost the same question.

**Safety.** The existing checks dropped 8 weak drafts across these runs, including an answer leak.

## Known limits

- Openings stay similar ("A member of staff is caring for a person..."). The rules forbid invented facts, so a short note has little to vary them with.
- The model sometimes adds "on a ward" although the guidance asks for a setting only where the passage implies one. The existing checks allow it, and this change does not make it worse.
- Difficulty and format variety are not changed here. Difficulty already comes from the learner's level, and a scenario keeps its staged format.
- A clinician has not reviewed these scenarios. The earlier scenario pack for a clinician is still with the owner.

- **For a clinician to judge:** one kept scenario reveals "The patient is also taking medications that are causing the diarrhoea", from a note that says to stop diarrhoea-causing medications. The checks allowed it. It may be a fair teaching step, or it may be an added patient fact. The existing rules wrote it, and this change did not loosen them, but it should go in the clinician's review.
- **The live route was not run end to end.** The wiring in the Revise route is covered by the type check and by `scenarioContext` unit tests. The test learner cannot get AI through the app on staging, so the runs called the generator directly.

## Tests

`scenario-variety.test.ts` covers rotation across a scope, the planner writing one scenario a section, the "never add facts" wording, no answer given, the sentence choice, headings, questions, aims and references ignored, untrusted text passed as data, and stored scenarios found by what they are though stored as short answers. Independent read: one blocker and one should-fix, both fixed; the data label on the quoted sentence added.
