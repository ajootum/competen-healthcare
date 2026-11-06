# SCHOLAR-SCENARIO-VARIETY-01: evidence

Owner GO of 6 Nov 2026, section 6: meaningful variation in presentations, progression, nursing decisions, difficulty and formats, from existing material first. Grounded in source, no fabricated patient facts, no answer in the introduction, no unsupported deterioration, safety marking and staged disclosure kept, no superficial name or demographic changes, no model calls added by default.

## What changed

One guidance block on the call that was going to happen anyway. `SCENARIO_FOCUSES` gives each new scenario on a section a different kind of decision: recognise, prioritise, respond, escalate, prevent. From a section's second scenario on, `startingSentence` also names the sentence of the passage the first decision should rest on: the one the other scenarios started from least. The learner's existing scenarios are passed as data, so the model does not ask the same first question.

The prompt and its version are untouched, so stored scenarios stay valid. Every existing check still decides what is kept. No migration. It reads the question pool already in memory, so it adds no database read.

## Counted staging test

Fixture learner, staging, real model. 14 calls, against a cap of 14, recorded in a ledger.

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

**Cost.** The earlier baseline, on a mix of sections with no variety, was 24 calls for 9 kept scenarios: 2.7 calls each. The final design's steered runs took 4 calls for 4 kept, with no retries. That's a small sample on two sections, so it shows no added calls and hints at fewer. It doesn't prove a saving. The added text is at most a few hundred characters per call.

**Variety, short section (4 sentences), first question and the sentence it rests on:**
1. "Which observation is often the first sign..." rests on the respiratory-rate sentence.
2. "What should the team use to bring together this person's observations now?" rests on the early-warning-score sentence.
3. "How should the team escalate their concern about this person now?" rests on the SBAR sentence.

Before the named sentence, the first two scenarios opened with almost the same question.

**Safety.** The existing checks dropped 6 weak drafts across these runs, including an answer leak, and none of them reached a learner.

## Known limits

- Openings stay similar ("A member of staff is caring for a person..."). The rules forbid invented facts, so a short note has little to vary them with.
- The model sometimes adds "on a ward" although the guidance asks for a setting only where the passage implies one. The existing checks allow it, and this change does not make it worse.
- Difficulty and format variety are not changed here. Difficulty already comes from the learner's level, and a scenario keeps its staged format.
- A clinician has not reviewed these scenarios. The earlier scenario pack for a clinician is still with the owner.

## Tests

`scenario-variety.test.ts` covers rotation, the "never add facts" wording, no answer given, the sentence choice, headings ignored, a section's first scenario having no steer, and untrusted text passed as data.
