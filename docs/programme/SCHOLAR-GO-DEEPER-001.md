# SCHOLAR-GO-DEEPER-001: Go Deeper as a structured teaching round

Owner instruction, 6 Nov 2026 (P1). Core rule: "Simplify the presentation, not the science." Final directive: "Go Deeper must deepen understanding, not merely lengthen the answer." Branch `scholar/go-deeper-001`. Default off behind server policy `scholar_go_deeper_structured`. Evidence is in `docs/evidence/SCHOLAR-GO-DEEPER-001/`.

## 1. How Go Deeper worked before

- `deeper` action, `scholar-learn-deeper-v2`: Teach Me's parts (OVERVIEW, UNDERSTANDING, KEY POINTS, EXAMPLE, CHECK) with a TAUGHT SO FAR block, plus an optional BEYOND THE NOTES part (background, under 170 words, no figures).
- It looked like a second lesson. Everything beyond the notes had to fit one background paragraph, so the mechanisms the owner asks for had almost nowhere to go.
- The grounding verifier reads numbers, finding words and named terms. Anything else in the notes part only needed a citation, so a general statement of science could carry an [S n] it did not rest on.
- Questions on a Go Deeper round could be read but not answered.

## 2. What it does now, with the policy on

One model call a round, as before. The call decides what adds value from TAUGHT SO FAR and writes a structured round (`deeper-format.ts`):

- a focus question and one line on what it covers;
- three to seven sections, only the kinds the topic earns: principle, science, compare (a table), application, misconception, safety, limits, advanced (folded away);
- a reasoning check, optionally with answer options;
- key takeaways;
- a "Sources and evidence" footer that always states what the round rests on.

**Every section says where it comes from.** This is the centre of the design, because a round's purpose is to go beyond the notes without pretending otherwise.

| Marked | What it is | Held to |
|---|---|---|
| From your notes | What the learner's sections say | Every sentence cites, shares enough content words with what it cites (`sentenceSupported`), and passes the grounding verifier. It adds no firm conclusion or instruction the passages lack. |
| Scholar's explanation | General science beyond the notes | No tags, digits, counts, doses, identifiers, medicines by name or class (a closed list; hormones as physiology are allowed), or urgent-action or danger wording. Never presented as research ("studies show", "the evidence suggests", a name and year). No firm conclusion from a finding, no instruction about treating someone. Classified by the published risk rules, same as research text. |
| From published research | Existing FROM RESEARCH part | The existing `checkResearchPart`, unchanged. |

Words that turn a statement false or add a cause (before, after, not, because ...) must also be in what is cited. A flow or table is judged as one claim. Headings, question stems and options answer to the same rules; a heading that fails is replaced by a neutral one. A reply not in this form, or one that does not read back as what was checked, is withheld.

A sentence in a notes section that fails its test is not lost. It **moves** to a Scholar section after it, tags removed, and is judged by the stricter Scholar rules. If it fails those it is left out and counted. So the "From your notes" label stays true and a round is not thrown away for one sentence of inference. A safety section can only come from the notes. At least one notes section must survive or the round is withheld. Dosing, or an invented number in a safety context, withholds the whole round, as lesson salvage already does.

## 3. Decisions

**Levels map to the existing depth.** Understand = `brief`, Explore = `standard`, Advanced = `detailed`.
Why: depth is already stored on each saved round, is already in the saved key and already has a learner preference that says where to start. So there is no migration and no second selector behind the first. Rounds were rejected as the mapping because a learner must be able to go straight to Advanced, and a new `level` column would hold the same three values. What a level adds beyond word room is its instruction, and Understand is plainer, not thinner: it keeps the mechanism and explains each term.

**Moving the level control never spends AI.** A level with a saved round links to it. A new level is asked for by a button that names it. The first Go Deeper click starts at the learner's own depth, so the common path stays one click.

**Round limit is shared.** The existing `scholar_learn_deeper_rounds_max` (default three) counts all rounds at all levels and of both forms, so the cost ceiling per lesson does not change.

**Answer options carry no key.** Options make the learner commit: choosing only marks one, so arrow keys can compare them, and "Answer with this choice" opens the existing check with the choice written in. The learner adds reasons and the existing `clarify` judges them. Stored and scored through the existing mechanism; no second marking path. An option's own citation is removed so it cannot point at its answer.

**Pictures.** The learner's own originals through `SectionPictures` (SCHOLAR-VISUAL-001), under a notes section that cites that page, each page once. Original diagrams are tables and `FLOW` chains drawn as text, so they are accessible and cost nothing. No generated images.

## 4. Saved rounds are not lost

The prompt version is **added**, not replaced. `learnDeeper` stays v2, and `learnDeeperStructured` is v3, used only with the policy on.

- Saved v2 rounds keep opening with no AI (`findSavedLesson`, `alsoSaved`) and are drawn exactly as before, because the page chooses by the content's labels, not by policy.
- Rounds of both forms count as taught ground and towards the limit.
- With the policy off again, saved v3 rounds stay readable. They just have no level control.
- Nothing saved is rewritten.

A structured round's Scholar sections are stripped wherever a saved round becomes a passage (`savedLearningPassage`), so Ask across saved learning cannot rest on the model's own words as if they were notes. Saved learning and the PDF export both show each section's source.

## 5. What changes with the policy off

One thing, and it is a bug fix, not the new behaviour. 415 stores at most ten sources for a saved answer, while a lesson can now hold sixteen (LESSON_MAX_SECTIONS, raised by SCHOLAR-CUMULATIVE-TEACHING-01). So every lesson over ten sections found none of its saved teaching:

- Go deeper and Explain again ran with no TAUGHT SO FAR, so they repeated the lesson;
- a reopen did not bring back the lesson's other rounds;
- on a reopen, a citation of [S11] or later was a dead tag.

From this change such a lesson finds teaching saved for it, identified by the row's own session and step (820), and rounds already saved count towards the limit at once. Rows with no session and step stay unmatched, as they were. This was the acceptance lesson's own condition: it has sixteen sections. Without the fix, the first run of the walk reached the model with no taught ground. No migration. It takes effect on deploy.

## 6. Known limits

Found by the independent read and left, as notes rather than defects:

- The notes test compares words and a few sense words, so it is not a check of meaning. The wording rules are closed lists. A sentence can pass while saying more than the notes do: the section's label is a strong signal, not a proof, which is why the round states that it is AI-generated and not clinically reviewed.
- On a lesson with more than six saved teachings, a reopen shows the newest six (`alsoSaved`), so an older round may be hidden while still counting.
- "Try again" on a Go Deeper check loses the question's tag, so its self-review uses the lesson's points.
- A table is flattened into a paragraph in the PDF export.

## 7. Seams with other work

- **Evidence packs (SCHOLAR-RESEARCH-TEACH-001).** Not built here. A pack is one more source of `ResearchEvidence` in the route's `evidence` array, and everything downstream exists. With no pack the round works and says no research was consulted. When a pack lands, its id must join `context` in the saved key.
- **Automatic research.** Unchanged and not used: Go Deeper consults research only through the existing Learn-from research mode and its controls. Production stays off until the owner's separate activation GO.
- **My Ideas & Notes (COMPETEN-NOTEBOOK-001).** No second capture is built. `SectionNote` in `go-deeper-view.tsx` draws `MyIdeasBox` after each section, with the section's own anchor (question, section, level and title), so two sections citing one slide keep their notes apart. It follows `scholar_personal_notebook` and draws nothing with it off.

## 8. Rollback

Set `scholar_go_deeper_structured` to off. No migration. Saved rounds stay readable.
