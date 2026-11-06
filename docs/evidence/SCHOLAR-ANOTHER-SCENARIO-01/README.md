# SCHOLAR-ANOTHER-SCENARIO-01: evidence

Owner decision of 6 Nov 2026: "Permit user-initiated generation of additional clinical scenarios, subject to existing AI and safety controls." **No migration.**

## What changes

After a scenario, the learner can press **Try another scenario on this**. Scholar writes a new scenario from the same section, about a different decision, starting from a sentence the others did not start from. It says it uses AI and their allowance, and the model is called only on that press.

It goes through the same route, preflight, allowance, sufficiency check and scenario checks as every scenario. A section can hold one scenario for each of the five kinds of decision, and after that the learner is told so.

## Staging test, real route and real model

`route-test.txt` holds the last run. Real HTTP as the fixture learner. Staging does not offer scenarios by policy, so each run offered them for one request through its own policy row, then removed that row.

| Check | Result |
|---|---|
| A scenario id that does not exist | 404 |
| A question that is not a scenario | 404 |
| Another scenario on a section | 200, 1 written, 0 reused |
| First question, before and after | "What should the clinician use to combine this person's observations?" (NEWS2 sentence), then "How should the clinician escalate the concern about this person now?" (SBAR sentence) |
| A non-clinical section | No scenario forced: "Your notes don't have enough clinical detail for an evolving scenario on this topic." |
| Same short section again, where the checks kept nothing | Same honest message, nothing stored |

**A bug this test found:** the first version wrote and stored the new scenario, then answered "no questions" because it excluded its own new scenario. Fixed, then retested.

## Not verified

- **The button in a browser.** The route was tested over real HTTP; the button and the move to the new session were only type-checked.
- **Model calls per press** weren't metered in this test. By design it is one generation with the existing retry, at most two calls and the same as any scenario write.
- **No clinician has reviewed these scenarios.**

## For the owner to know

- In production the button only appears after a scenario, and scenarios appear only where the `scholar_revision_formats` policy offers them. If scenarios are off there, this changes nothing until that policy includes them.
- Each press spends the learner's AI allowance. If the checks keep nothing, the press may still have cost a call, as with any scenario write.
