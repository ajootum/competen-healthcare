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
| Notes | One `MyIdeasBox` for each step, through `SectionNote`. Tested in `docs/evidence/SCHOLAR-GO-DEEPER-001/notes-walk-result.txt`. |

## Walk notes

- The final walk ran after the independent review's fixes, from a clean start on this lesson: 6 model calls, USD 0.13, each teach, hint, example and judged answer one call. On reopening it made no call and came back at "Step 2 of 3", "1 understood".
- It answered "not yet" to a wrong answer and "understood" to a sound one. The sound answer was the judge's own key points, which is a test of the path, not of how hard the judge is.
- The clinical-risk gate did not ask on these answers. The release walk below exercised it in the browser.
- The transcript and the cost table are from the counted test, before the review's fixes to the checks. The prompts for teaching did not change after it, except that a step or explanation now also asks for flags.
- Dev-server recompiles caused some 500s in earlier runs of the walk. The final run had none.

## Release tests (owner decision SCHOLAR-TEACHING-P1-RELEASE-001)

Run on staging as the fixture learner with `walk-release.mts`. Results are in `release-walk-result.txt`, the feedback text in `release-go-deeper-feedback.txt`, pictures in `shots/r*.png`. Both switches were off again afterwards. All walk runs together, including the runs the walk's own errors stopped: 19 model calls, USD 0.41.

| Owner's test | Result |
|---|---|
| Clinical-risk gating, real Guide Me route | A real patient is refused in the panel with no model call. An ambiguous request asks in the panel, with no call and the answer locked. "A patient I'm caring for" judges nothing and sends nothing. "For my studies" resends once, then gives one judged answer. |
| Go Deeper answer and feedback | Choosing an answer and checking it gives feedback under the question with a verdict and the check's own parts. It keeps one attempt and makes one model call. |
| Saved state, more than ten sections | The 16-section lesson brings back its rounds with no model call, a citation past [S10] links to its section (S11, slide 33), and the lesson list says "Review saved lesson". |
| Lesson-level completion | Answering step 1 records the step result with no lesson verdict. The lesson does not read as checked at steps 2 or 3. The lesson verdict is written only at the end. Finishing again adds no event and says so. |
| Existing teaching and revision | Policy off shows no panel and the old Guide me form. Revise, Saved and Learn open, saved learning shows no raw labels, and there were no server or page errors. **Challenge me failed, and not because of these PRs:** see below. |

**Challenge me is broken on main too.** The Teaching Style button sends `level: 1` (`learn-approach.tsx`), and `parseTeachingRequest` accepts only a level name, so the request gets a 400. Those lines are the same on main, and Ask me sends the same number. It was left alone here because Challenge me is not part of this redesign.

One run showed "Competen could not be reached" after the study answer, with a connection reset in the dev server log. The next run, on the same code, passed. It was not explained.

## Second read of the lesson-level rule

Run after the two independent reviews, because this rule came later. Fixed: "Counted" now follows the record. An unreadable section stops the request rather than overstating the result. Finishing again adds nothing and cannot put an older result over a later check. Answers that reached neither partly nor understood stay "not yet" rather than "partly". A step's best result is taken across its saved versions. Saved teaching rows are no longer cut off at 40. A second session on the same large lesson can finish it. A failed request has its own wording. One answer credits one step.

Left as is:
- Two truly simultaneous finishes could write twice, because there is no unique index. The panel sends one, and this is not worth a migration.
- "Reached the end" is the learner's request. A direct request counts only once every step's teaching is saved, and the result always comes from records.
- With migration 950 absent, kept answers read as none. The project's record has production past 950; that was not rechecked here, since agents do not read production.
