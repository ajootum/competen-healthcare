# SCHOLAR-GUIDE-ME-001: evidence

Staging only, the fixture learner, Growth and Development, lesson 3 of its session (16 sections, 3 steps). Staging policy left **off**.

## Files

- `transcript.md`: the old first turn beside every new turn, as generated.
- `walk-result.txt`, `walk-*.txt`, `shots/`: the browser walk at desktop, tablet and phone.
- `ledger.json`: the capped ledger (cap 20 calls, USD 1.50). Whole test: 20 calls, USD 0.36, including prompt tuning.
- `guide-gen.mts`, `walk.mts`: what produced them. Keys are read inside the scripts and never printed.

## Cost, one call each

| Turn | Calls | Model | Input | Output | USD | Words |
|---|---|---|---|---|---|---|
| Guide me as it was | 1 | claude-sonnet-4-6 | 1472 | 164 | 0.0069 | 119 |
| Teach a step | 1 | claude-opus-4-8 | 1967 | 448 | 0.0210 | 216 |
| A hint | 1 | claude-opus-4-8 | 2238 | 96 | 0.0136 | 46 |
| Example reasoning | 1 | claude-opus-4-8 | 2240 | 330 | 0.0194 | 158 |
| Just explain it | 1 | claude-opus-4-8 | 2235 | 632 | 0.0270 | 319 |
| Judge a wrong answer | 1 | claude-opus-4-8 | 2336 | 485 | 0.0238 | 220 |
| Judge a sound answer | 1 | claude-opus-4-8 | 2347 | 411 | 0.0220 | 177 |

Reopening a saved step, hint, example or explanation made **no model call** in the walk. A blank answer and "I don't know" send nothing. The meter leaves out the cached system prompt, for old and new alike.

**A turn costs about two to three times the old one, on purpose.** The old form ran on the Explain route and gave a hint of about 120 words with no teaching. On that same route, the first version of the new form wrote a confident and doubtful claim about sleep and thresholds, so teaching now routes as Go deeper does. A full step (teach, one answer judged) is about USD 0.045. Production routing follows HQ's eligibility rows.

## Acceptance

| Owner's item | Result |
|---|---|
| Teaches before questioning | Yes. |
| Questions assess understanding, not word recognition | The prompt asks to explain, compare, interpret or apply, and forbids finding or repeating wording. See `transcript.md`; the old first turn asked "what do your notes say". |
| Responses determine feedback and progression | Wrong: not yet, a correction and a new question. Weak: not yet, and another go. Sound: understood, next step. |
| Wrong answers get meaningful explanations | Yes: `walk-feedback-wrong.txt`. |
| Blank responses get no false feedback | A blank cannot be sent. "I don't know" is not judged. A hint and an example say they have seen no answer. |
| Progress reflects actual steps | Hints and examples leave it unchanged. Understood, answered, explained and moved on are said in words. |
| Duplicates removed | The question appears once on the page. The panel adds nothing to the thread. |
| Just explain it is substantial | About 300 words in sections, with mechanisms and a common mistake. The learner can go back. |
| Research-grounded expansion | **Not exercised.** It uses the same seam as Go Deeper, which was tested with a labelled stand-in; staging has no active research. Production research stays off. |
| Mobile and tablet | No sideways scroll at 390, 820 or 1440 wide. The answer box sits directly under the question. After a new step, focus moves to its heading, so a phone's keyboard does not open over the teaching. |
| Notes | **Not yet wired.** `MyIdeasBox` is not on main. `SectionNote` is in place for it. |

## Walk notes

- The final walk ran after the independent review's fixes, from a clean start on this lesson: 6 model calls, USD 0.13, each teach, hint, example and judged answer one call. On reopening it made no call and came back at "Step 2 of 3", "1 understood".
- It answered "not yet" to a wrong answer and "understood" to a sound one. The sound answer was the judge's own key points, which is a test of the path, not of how hard the judge is.
- The clinical-risk gate did not ask on these answers, so its question in the panel was **not exercised in the browser**. It is covered by reading the code path and by the review.
- The transcript and the cost table are from the counted test, before the review's fixes to the checks. The prompts for teaching did not change after it, except that a step or explanation now also asks for flags.
- Dev-server recompiles caused some 500s in earlier runs of the walk. The final run had none.
