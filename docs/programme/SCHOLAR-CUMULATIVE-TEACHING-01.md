# SCHOLAR-CUMULATIVE-TEACHING-01 — Cumulative teaching intelligence in the existing Learning Engine

Owner instruction and GO, 3 Nov 2026 (the spec's sixteen sections). Branch `scholar/cumulative-teaching-01`. An improvement
of the existing Scholar Learning Engine: no new engine, no fourth teaching style, no depth selector, no migration, no model
change. Acceptance case: "Essential Nursing Care of the Critically Ill", the Bed bath lesson, for the pilot fixture learner on
staging. Evidence under `docs/evidence/SCHOLAR-CUMULATIVE-TEACHING-01/`.

## 1. The engine as it was (spec section 13: where each thing lives)

| Item | Where | What it did on main @ c15b6a04 |
|---|---|---|
| Teaching prompts | `generation.ts` `EXPLAIN_SYSTEM` (rules 1–6, "Keep it under 250 words"), `LEARN_INSTRUCTION` (teach / explain / simplify / deeper / examples / summary / ask / check / clarify), `learn-teaching.ts teachingInstruction` (ask_me / guide / challenge / mistake / teach_back / high_yield) | Teach me = OVERVIEW (one or two sentences) + KEY POINTS (one line per idea) + optional EXAMPLE + CHECK; Go deeper = one free-text paragraph instruction on the same passages; Guide me = a hint at rung 1–3, "give ONLY a hint"; Challenge me = one question on a rung |
| Source retrieval | `act/route.ts` `ownPassages` (the lesson's own sections) + `relatedSections` for a thin or partly grounded lesson; Ask searches the session | unchanged |
| Context-window construction | `generation.ts learnUserPrompt`: learner context (`learner-context.ts`: programme, level, competencies, weak areas) → passages → references → research → `history` (Ask only) → the request | **No lesson brief** (title, objective, headings) and **no prior-teaching context** reached any prompt but Ask |
| Lesson objectives | `learn.ts lessonOutline` (title, objective, focus) from the lesson's headings | computed for research scoping and the reply's `lesson` field, **never given to the model** |
| Saved teaching records | `individual_scholar_artefact` (415/820): action, depth, content, background, flags, refs, model, prompt_version, dedupe_key, sources | one per dedupe key; read only to serve the same request again |
| Teaching-style routing | `learn-style.ts` (Explain = teach, Guide me = `guide`, Challenge me = `challenge` + ask_me / teach_back), `learn-approach.tsx` | each style's request carried nothing of the others |
| Go deeper routing | `deeper` action, `artefactKey(action, depth, chunkIds, promptVersion, refs, background, mode)` | **a second Go deeper on the same lesson returned the same saved artefact** (`cached: true`); the only alternative was `fresh: true` (a regeneration with no context) |
| Model eligibility | `ai-standing.ts activityState` over `allowance.ts` + `ai_model_eligibility`; routing per activity | staging had no model approved for `explain`, `examples`, `summary` → **Guide me (metered as explain) unavailable to the pilot learner on staging** |
| Response parsing | `teach-format.ts parseTeachAnswer`, `generation.ts checkTeachAnswer` / `salvageTeach` / `checkLearnMain` (Holdings grounding check) | fine-grained for Teach me only; Go deeper free text |
| Source-sufficiency rules | `evidence-recovery.ts groundingOutcome` (key terms covered), `TEACH_THIN_CHARS` related sections | a gap in the notes was never named in the teaching; background ("BEYOND THE NOTES") under 100 words, no figures |
| Research integration | `learn-research.ts`, `research-relevance.ts`, `checkResearchPart` (E-tags, every sentence cited, dosing / identifier / risk checks), `externalReferences` (evidence vs further reading) | sound: bibliographic-only items are "further reading", never cited as evidence |
| Output length and truncation | `DEPTH_WORDS` brief 120 / standard 220 / detailed 350 words; `maxTokens` 800 / 1100; teaching actions 250–600 tokens | the acceptance Explain was 273 words of bullets |
| AI allowance and cost | `scholarAiRunner` → `runMeteredAi` → `plat_ai_requests` (model, tokens, cost_usd, action_id) | teach on claude-sonnet-4-6 ≈ USD 0.014; deeper routed to claude-opus-4-8 ≈ USD 0.022 |

## 2. Root causes (evidence: the BEFORE run, `before-bed-bath-*.md`)

1. **Prompt design and length.** Teach me asked for an overview, bullets and a check under 220 words: the Explain of Bed bath was eight bullets with no mechanism (the vasoconstriction / heat-loss reasoning in slide 12 was never taught). Shallowness is by construction, not model weakness.
2. **Missing prior context (orchestration).** Go deeper, Explain, Guide me, Challenge me and the checks were each given the passages alone. Go deeper on Bed bath taught only the eye-care slides and nothing of the bed bath; it could not know what the lesson had covered.
3. **Caching made repetition exact.** The second and third Go deeper returned the identical saved answer (`cached: true`, 251 words, 0 AI cost, 0 new understanding). "Explain it a new way" regenerated without context and was withheld.
4. **Source fragmentation (planner capacity).** `planSteps` holds at most 8 lessons × 10 sections; the 75-slide deck was therefore packed nine or ten slides a lesson wherever the size balance fell: Lesson 2 "Bed bath" = Skin & Tissue Assessment, Bed Bath, Skin Tears **and half of Eye care** (slides 10–19); the rest of Eye care went with Oral care. Hygiene (slides 6–9) sat in Lesson 1 with the title and objective slides.
5. **A grounding false positive.** The verifier's finding-word list contains "positive"; the model wrote "positive pressure ventilation" for the notes' "PPV" and three answers in a row (Go deeper fresh, Challenge me twice) were withheld for "the term positive".
6. **Model eligibility on staging** (configuration, not code): no model approved for `explain` / `examples` / `summary`, so Guide me, Explain again, Examples and Summarise answered "AI help isn't available for this yet".
7. **A labelling bug**: a saved artefact listed under another action's continuity reply carried the request's action, not its own (a saved Go deeper shown as "guide").

The owner's PDF copy ("… print.pdf") carries no extractable text (image-only); the staging material is the PPTX (text intact).

## 3. What changed

### P0 — teaching quality
- **The lesson has an UNDERSTANDING part** (`teach-format.ts` v3, `generation.ts LESSON_PARTS`): OVERVIEW → UNDERSTANDING (connected paragraphs: concepts, mechanisms, relationships, application; for clinical topics the condition → mechanism → assessment → decision → intervention → reassessment chain where the passages support it) → KEY POINTS (revision) → EXAMPLE → CHECK YOUR UNDERSTANDING (questions that ask for explanation or reasoning). Prompt version `scholar-learn-teach-v3`; saved v1 and v2 lessons still open with no AI call (`LEARN_TEACH_LEGACY`).
- **Room to teach**: `LESSON_WORDS` brief 240 / standard 520 / detailed 760 words and `LESSON_MAX_TOKENS` for teach and deeper; Explain / Simplify / Summarise keep `DEPTH_WORDS`.
- **The lesson brief in the prompt** (`lessonBriefBlock`): title, objective and the lesson's own headings in order, so a lesson is organised around its sections and says where one leads to the next.
- **Go deeper is additive** (`scholar-learn-deeper-v2`): written in the lesson's parts; with a TAUGHT SO FAR block it must decide what has been explained, which mechanisms, relationships and examples were covered, what the learner's answers show, and what the passages hold that remains unexplored, then teach that — repeating nothing beyond one sentence of continuity. When the passages hold nothing further it replies `DEPTH_REACHED` and the page shows "depth reached" with the next activities (Challenge me, Practise, next lesson) instead of a restatement. `DEEPER_ROUNDS_MAX` = 3 rounds by AI per lesson; a fourth answers "depth reached" with no AI call.
- **Explain again ≠ Go deeper**: with a TAUGHT SO FAR block, Explain this and Simplify become "EXPLAIN AGAIN" (clarify the same ground another way; add nothing new).
- **Source insufficiency named**: a lesson's "Beyond your notes" part now starts by naming what the notes state but do not explain, then gives the general principle (up to `BACKGROUND_WORDS`), under the same rules (no figures, units, doses, drug names; never presented as the notes).
- **Grounding false positive**: `scholarNamedTerms` treats "positive pressure / end-expiratory / airway" as a named therapy term before the verifier runs; "positive" alone stays a finding word. The Holdings verifier itself is untouched.

### P1 — cumulative learning
- **`learn-context.ts` (new, pure, client-safe)**: `buildTaughtSoFar` reads the lesson's saved teaching (the artefacts written for the lesson's own sections) and this visit's checks into a concise representation — concepts, mechanisms and relationships, examples, questions asked, the learner's answers with what was right / missing / mistaken, and what is still open (lesson headings the teaching has not named). `taughtSoFarBlock` renders it under its own header, bounded (`TAUGHT_BLOCK_MAX` 2200 characters, lists trimmed from the end). `taughtHash` fingerprints the ground. No memory table: rebuilt per request from records the engine already keeps; what the learner typed reaches the prompt only for the request it was sent with and is never stored.
- **The route** (`act/route.ts`): for every lesson action but Teach me and Ask (`CONTEXT_ACTIONS`) it reads the lesson's artefacts (`listArtefacts` on the lesson's sections, `coversLesson`), builds the block, and passes it with the lesson brief and the learner's earlier check answers (grounding, as a clarify's answer always was). The saved-answer key carries the ground's fingerprint (`artefactKey.context`) and the prompt version the `+scholar-learn-cumulative-v1` suffix, so the same request on new ground is a new answer and a reopen of the same round is the saved one.
- **`priorChecks`** (page → route, bounded by `parsePriorChecks`, identifier-screened): the question, the learner's answer, the verdict and the clarification's labelled parts for the checks answered in this lesson during the visit.
- **Guide me is a dialogue** (`scholar-learn-teaching-v2`): the reply first responds to the actual attempt — confirms what is right, names and corrects a misconception from the passages, says what the attempt has not yet considered — then guides the next step at the rung and ends with ONE question. The page keeps the turns per lesson and sends them as `history` (bounded by `scholar_tutor_turns`); the conclusion is still the learner's to reach, and "Explain it directly" stays.
- **Challenge me demands reasoning** on its upper rungs (application: decide or prioritise and say why; reasoning: explain why, compare, justify or evaluate linking at least two ideas) and never repeats a question already asked. **The clarification** (`scholar-learn-clarify-v3`) judges reasoning as reasoning (does each step follow, is the conclusion justified, which consideration was left out) and, when the answer was understood, takes it a step further in NEXT.
- **Style switches keep the ground**: Explain, Guide me, Challenge me, Ask me, Teach back, Explain my mistake, the check and the clarification all receive the same block.
- **Continuity across visits**: an open of a saved lesson also returns the lesson's other saved teaching (`alsoSaved`: Go deeper rounds, examples, explanations, oldest first), and the page shows them in the thread — read, never generated.

### P2 — enrichment and cost
- Research attribution was found sound and is unchanged (verified abstracts only are cited as [E n]; records without an abstract are "further reading"; the research part says plainly when evidence is limited). The lesson's "Beyond your notes" part is now the explicit, labelled place for Scholar's own interpretation of what the notes leave unexplained.
- Cost: measured in section 5. Context and orchestration were changed; no model change is recommended (Go deeper already routes to Opus on staging by eligibility, Teach me to Sonnet).

### Lesson generation (spec section 5)
- `LESSON_MAX_SECTIONS` 10 → 16 (the character cap stays), so eight lessons no longer force ten slides each.
- **Heading families** (`headingFamily`: a heading's first content word): units of one family are at least 0.9 alike, a cut inside a family costs `CUT_WEIGHT` 1.5 × that, and a lesson that begins where a family run of three or more units begins is rewarded (`FAMILY_START_BONUS`). Words most of a material's headings carry ("care", "essential") are not compared (`commonHeadingStems`).
- A thin slide of its own family that matches neither neighbour ("Skin Tears") stays with the unit before it.
- A lesson is titled by the heading family carrying most of its text ("Eye care"), the other headings in the objective.
- Result for the deck (deterministic, `learn-cumulative.test.ts` and the offline plan of the staging material): Personal hygiene (slides 1–13: principles, hygiene, bed bath, skin tears) · Eye care (14–23) · Oral care (24–29) · Patient positioning and mobilisation (30–45) · VTE prophylaxis (46–49) · Bowel management and urinary catheter care (50–64) · Infection control (65–75). Saved sessions keep their steps (414); new sessions get the new plan.

Not changed: the clinical-risk rules and clarify-once, model routing and eligibility, what is recorded (a learning event per shown action, the verdict on a clarify; nothing the learner typed), the Holdings grounding verifier, the three teaching styles, the activity row, the reader, Mark as read, flashcards, saved lessons and every AI-off path.

## 4. Before and after (Bed bath, staging, fixture learner, lesson 2 of the saved session = slides 10–19)

See `docs/evidence/SCHOLAR-CUMULATIVE-TEACHING-01/` for the transcripts and the scoring table (section 5 below is filled from them).

## 5. Scoring and cost

Filled in `docs/evidence/SCHOLAR-CUMULATIVE-TEACHING-01/comparison.md`.

## 6. Owner decisions

1. **Model eligibility for the explain family.** Staging now has `explain`, `examples` and `summary` approved for the same models as `teach` (rows noted "SCHOLAR-CUMULATIVE-TEACHING-01 staging acceptance fixture"). Without them Guide me, Explain again, Examples and Summarise answer "not available yet". Production eligibility is the owner's decision (HQ AI governance), not part of this branch.
2. **Go deeper round limit** (`DEEPER_ROUNDS_MAX` = 3): a code constant; say if it should be a policy key.
3. **Storing the learner's check answers** (the checks increment 5 question) is unchanged: the block uses them for the visit only.
