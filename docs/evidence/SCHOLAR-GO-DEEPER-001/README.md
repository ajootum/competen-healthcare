# SCHOLAR-GO-DEEPER-001: evidence

Staging only (`ezhvpgtcqcdsgylrxgdb`), the fixture learner, the owner's Growth and Development deck, lesson 3 of its session (slides 23 to 38: motor development, reflexes, head control through to walking). The lesson has 16 sections. Staging policy was left **off**.

## Files

- `side-by-side.md`: Teach Me and every Go Deeper level, as generated, unedited, with the measures below.
- `walk-result.txt`: the browser walk, line by line. `shots/` holds its pictures at desktop, tablet and phone, and in dark mode.
- `ledger.json`: the capped ledger of the counted test (cap 24 calls, USD 2.50).
- `go-deeper-gen.mts`, `compare.mts`, `walk.mts`, `walk2.mts`: what produced them. Keys are read inside the scripts and never printed.

## Cost: before and after

Each is one real call through the metered runner on the same lesson with the same taught ground. Input tokens exclude the cached system prompt.

| Request | Model calls | Input | Output | USD | Words |
|---|---|---|---|---|---|
| Go Deeper as it was (v2) | 1 | 1,753 | 1,009 | 0.0340 | 423 |
| Understand | 1 | 1,696 | 967 | 0.0327 | 501 |
| Explore | 1 | 1,696 | 1,030 | 0.0342 | 513 |
| Advanced | 1 | 1,696 | 1,201 | 0.0385 | 552 |
| A second Explore round on the first | 1 | 2,163 | 1,150 | 0.0396 | 572 |
| Reopening saved rounds | **0** | | | 0 | |
| Moving the level control | **0** | | | 0 | |
| Past the round limit (three, across all levels and forms) | **0** | | | 0 | |
| Answering a check (existing `clarify`) | 1 | | | 0.0231 | |

So no extra calls, and about the same cost per round: 4% below to 13% above the old version at the three levels. The ceiling per lesson is unchanged. Whole test: 24 calls, USD 0.79, the cap on calls, including the runs used to tune the prompt. The three levels were measured after the independent review's fixes. The second Explore round was measured just before them, on the same prompt: only the checks changed. Separately, the walk made its own metered calls.

One limit of these figures: the meter's `cost_usd` counts input and output tokens only, not the cached system prompt, for old and new alike. The new system prompt is about 400 tokens longer (about 1,830 to 2,240, estimated from its length). At usual cache rates that adds roughly USD 0.0002 on a cached call and USD 0.0025 when the cache has to be written. This was estimated, not measured.

## Does it deepen, rather than lengthen?

| | Go Deeper as it was | Understand | Explore | Advanced | 2nd Explore |
|---|---|---|---|---|---|
| Sentences repeating Teach Me | 11 of 21 (52%) | 3 of 21 (14%) | 5 of 21 (24%) | 4 of 25 (16%) | 5 of 23 (22%) |
| Sections of Scholar's explanation beyond the notes | 0 | 4 | 4 | 5 | 4 |
| Misconception | no | yes | yes | yes | yes |
| Limits | no | no | no | yes | yes |

A sentence counts as repeated when at least 70% of its content words appear in one Teach Me sentence. Notes sections state the notes on purpose, so this cannot reach zero. It is a word measure, not a judgement of meaning: read `side-by-side.md` for that.

## Acceptance, as measured

| Item | Result |
|---|---|
| Explains developmental mechanisms beyond the notes | Yes, in sections marked Scholar's explanation (for example the insulating sheath around nerve fibres, and control maturing from the head down). |
| Introduces genuinely new understanding | Yes. A second round chose a different concept. |
| Uses research when authorised and available | **Tested with a labelled stand-in abstract, not a real paper.** The round and its FROM RESEARCH part work together and pass the existing check. Real evidence depends on SCHOLAR-RESEARCH-TEACH-001. Staging has no active research. |
| Does not repeat Teach Me | Much less than before, not zero. See above. |
| Explains complex ideas clearly | Short sections, terms explained in context, tables and flows. |
| Highlights limits and misconceptions | Misconception in all four final rounds; a limits section in two. Sections are not forced, and every round's footer states the evidence limit. A round's check left out a takeaway or a question in some runs, and the page says when it has. |
| Clinical application | Application sections where the topic touches care. One sign read with others, no patient-specific recommendations; those rules are enforced by checks. |
| Active learning | Answer options and open questions, judged by the existing check and kept (`marking ai_evaluation`, score 0.5 in the walk). |
| Immediate note capture | **Not yet.** It waits for COMPETEN-NOTEBOOK-001's `MyIdeasBox`; the place for it is ready. |
| Mobile and tablet | No sideways scroll at 390, 820 or 1440 wide. Tables stack below the md edge. |
| Clinical safety and source integrity | See the programme document, section 2. Safety sections come only from the notes. Scholar's words never become a passage. |

## Walk notes

- One walk line reads FAIL for "the judged answer is kept": the walk's query named a wrong column. The second pass reads the row and passes.
- The first pass used the answer options as first built. After the review they changed: choosing only marks an option, and a button opens the check. The second pass tested that without sending an answer. So the option path has not been sent end to end since that change, but what it sends is unchanged. The first pass's kept answer was sent through it.
- "Explain it a new way" and "Helpful" are the existing controls, 25 to 30px on a mouse. They grow to the touch size on a touch screen, as elsewhere in Learn. Not changed here.
- A real generated round (the head-control one) was stored on the fixture under the Understand level so pictures could be shown, because the walk's own rounds cited slides with no pictures. Its label on the page is therefore Understand, though it was written at Advanced.
- Its sticky bars appear across the middle of tall screenshots. That is how a tall element is captured, not how the page looks.
