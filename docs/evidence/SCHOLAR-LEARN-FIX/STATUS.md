# SCHOLAR-LEARN-FIX-01: STATUS (handover between slices)

- **Branch:** `scholar/learn-grounding-01`
- **Worktree:** `C:\Users\elish\Documents\Competen\competen-learn-fix`, base main 500df4d4
- **Owner instruction:** "Improve the Learn Experience and Source Grounding" (31 Oct 2026). Smallest safe implementation; reuse Learn, Classify, Knowledge, Research and Personal AI. No new subsystem. Production deploy needs a separate owner GO.

## Regression scenario (production, read-only diagnosis)

**The material**
- "Quality Improvement Science and Methods.pptx": 49 slides, 47 sections, slides 33 and 38 have no text, 277 distinct topics.
- A byte-identical local copy is at `C:\Users\elish\Desktop\Quality Improvement Science and Methods.pptx` (sha256 190ab742..., same as production). Use it on STAGING only.

**What the learner saw**
- The Learn session gave 8 steps covering 9 of 47 sections.
- Step 1 was "quality improvement, patient safety, science of improvement" and contained ONLY slide 1, the title slide.
- Teach replied "This isn't in your notes".
- Recovery then showed slides 13, 23, 28 and 6, plus TWO sections of ANOTHER document ("recognising-deterioration-notes", unrelated).
- It finished with "Not found in any of these sources yet: quality, improvement, patient, safety, science".

## Root causes found (coordinator)

1. **Step planning** (`src/lib/individual/scholar/learn.ts`, `planSteps` ~63).
   - A step breaks whenever the next section shares no EXACT topic string. With many fine-grained topics, almost every section becomes its own step, and `maxSteps` truncates coverage (9 of 47).
   - Title or agenda slides with almost no text become a step on their own.
2. **Step titles** (`stepTitle` ~81) are the first three stored topics joined by commas. They are not learner-friendly.
3. **Teach on a thin step** grounds only on that step's sections, so it refuses. Related sections of the SAME selected material are not used.
4. **Recovery sufficiency** (`evidence-recovery.ts` `assessSufficiency` ~293, SQIE D-4) requires an approved library reference for `canExplain`. Production has none. As a result:
   - `covered` is empty;
   - EVERY key term is listed as "unanswered", even when the displayed notes contain them;
   - the learner is told the opposite of what is on screen.
5. **Recovery notes evidence includes OTHER materials** in "My notes only", even when the session is scoped to one material.

## Owner requirements (binding)

- **Fix causes, not refusal text.**
- **Steps**
  - Coherent, learner-friendly lesson titles and objectives, supported by the material. Prefer deterministic, from the material's own headings or slide titles, with no added AI call.
  - Suggested lessons must be supported by available material.
- **Grounding**
  - Three grounding outcomes: sufficient / partial / insufficient.
  - Teach the supported content, name the specific gaps, and offer additional sources (the existing recovery tiers) where appropriate.
  - Prioritise passages from the selected material. Use other uploads only when clearly relevant AND permitted by the selected source mode.
- **Teach Me and its supporting actions**
  - Default Teach Me: a structured explanation with citations, examples where supported, and a brief understanding check.
  - Long source excerpts go behind an expandable "View sources" control. Citations stay accessible beside the explanation.
  - Progression: Teach, then Check understanding, then Continue. Preserve learning history and saved sessions (414 rows; do not rewrite existing sessions' steps).
  - Keep Explain, Simplify, Go deeper, Examples, Summarise and Ask Scholar as supporting actions.
- **Safeguards:** keep clinical-risk safeguards, source provenance, `verifyGrounded`, model eligibility, allowance and cost controls intact.

## Slices

| Slice | Scope | State |
|---|---|---|
| L-A | Server root causes: `planSteps`, deterministic titles and objectives, Teach retrieval within the selected material, three-outcome sufficiency, recovery scoping and accurate covered/unanswered | **done** 31 Oct (32fe4802, fd7ee490; unpushed) |
| L-B | UI: Teach, then Check, then Continue; View sources disclosure; inline citations; structured Teach prompt (prompt version bump) | **done** 31 Oct (3272346b, ab0a3bfe; unpushed) |
| L-C | Staging regression with the QI pptx (sonnet) | pending |

## Token rules

- Targeted vitest only.
- `scholar-learning` harness once.
- tsc once.
- No full suites and no re-runs. On a fix, re-run only the failed case.

## Log

### 31 Oct - L-A done (server; 2 commits 32fe4802 + fd7ee490 on scholar/learn-grounding-01, not pushed; no migration)

**Changed**
- `learn.ts` `planSteps(sections, topics, maxSteps, profiles?)`: thin sections (< `LESSON_THIN_CHARS` 160) join the next section (or the previous one when their heading carries it on, or at a material's end); capacity `maxSteps x LESSON_MAX_SECTIONS (10) / LESSON_MAX_CHARS (7200)` taken contiguously from the start; then a deterministic DP cuts into <= maxSteps lessons, never across materials (cut cost = heading-stem overlap / topic Jaccard of the neighbours; size cost = squared distance from max(1500, run chars / maxSteps)). Coverage stays honest. On the real QI deck (local dry run, maxSteps 8): 7 lessons, 47/47 sections, title slide inside lesson 1.
- `lessonOutline(step, topics, profiles)` -> `{ title, objective, focus }`, no AI: title = the heading carrying most of the lesson's text (never Objectives/Agenda/...; bracketed citations dropped; sentence-cased only where the notes write the word in lower case; acronyms kept; <= 80 chars), else top 1-2 topics, else the place in the notes. Objective = "Describe ..." (tool/model/process headings) or "Explain ..." + up to two other headings/topics. `stepTitle(step, topics, profiles?)` kept compatible. `sectionProfiles()` reads headings in batches of 100 (via `chunksByIds`).
- `sessionView` steps now carry `objective`; sessions POST, sessions/[id] GET and the Learn page pass profiles (existing sessions keep their stored steps; only their displayed titles improve).
- `learn/act`: unrecorded steps now take up to `LESSON_MAX_SECTIONS` ids (was `STEP_MAX_SECTIONS` 3); recovery merge cap `LESSON_MAX_SECTIONS + RETRIEVAL_LIMIT`.
- Teach retrieval (`act` + `evidence-recovery.relatedSections`): for teach/explain/simplify/deeper/examples/summary (not Ask, not an explanation from recovery), when the lesson's own text < `TEACH_THIN_CHARS` 400 or its grounding is not sufficient, add up to `RETRIEVAL_LIMIT` (5) sections: the session's own materials first (any section adding an uncovered key term); another upload only when the source mode is library/research AND it holds >= `OTHER_MATERIAL_MIN_SHARE` 60% and >= 2 of the key terms; examination papers excluded (unreadable paper list: no other uploads). Added after the lesson's own sections, so [S n] tags of the lesson come first; `passageCitation`, `verifyGrounded`/checks, risk gate, eligibility, allowance unchanged (risk is classified on the final passages).
- Three outcomes: `groundingVerdict` / `groundingOutcome(terms, passages)` (>= 60% sufficient, > 0 partial, 0 insufficient), the same rule `assessSufficiency` now uses.
- Recovery scope: `RecoveryInput.scopeMaterialIds`; in `notes_only` the notes reader searches only those materials and runRecovery filters to them; wider modes keep other materials, selected ones ranked first. Recover route takes `sessionId` (materials read on the server from the learner's session) or `materialIds` (browser-held session, <= 10); paper questions never scoped. Learn client sends them (one wire field; no UI change). act's rederive passes the session's materials. Revision, papers and OSCE are unchanged (unscoped).

**Response fields for L-B** (learn/act: AI replies, saved-artefact replies, continuity, recovery no-evidence)
- `lesson: { title, objective } | null` (null for Ask).
- `grounding: { outcome: "sufficient"|"partial"|"insufficient", keyTerms, covered, uncoveredTerms, related: { sameMaterial, otherMaterials }, wider: "notes_and_library"|"notes_and_references"|null }` - `wider` is the next recovery mode to offer when not sufficient.
- `sources` unchanged (now may include the related sections, after the lesson's own). Sessions: `steps[].title`, `steps[].objective`.
- Recover request body accepts `sessionId?` / `materialIds?`; recover response `sufficiency.covered/unanswered` are now accurate.

**SQIE D-4 adjustment (owner instruction "teach supported content", 31 Oct)**: `assessSufficiency.covered/unanswered/verdict` now count every shown evidence item including the learner's notes (a term in a shown note is never "unanswered"); notes holding a key term count as reading, so state is `reading_only`, not `unanswered`. The approved-reference requirement is kept ONLY for explanations from recovery (`canExplain`/`explainable`, the wider tiers beyond the selected notes). Learn's own Teach may explain from the learner's selected material (its lesson + related sections of the same material) without an approved reference, as it always could for the step itself.

**Tests** - learn.test.ts 24/24, evidence-recovery.test.ts + wiring + sqie-close 94/94, learn-integration + learn-research-quality 21/21; scholar-learning harness 160/0; tsc clean.
- Updated (old behaviour encoded): learn.test "groups consecutive sections..." (3+1 -> 2+2), "starts a new step where the topics change..." (capped 2: 4/5 -> 5/5 coverage), "names a step by its topics" ("Airway, Larynx" -> "Airway and larynx"); evidence-recovery.test "SQIE D-4: notes alone..." (covered [] / unanswered all / state unanswered -> covered all / unanswered [] / reading_only, canExplain still false), "an external source that fails..." (verdict insufficient -> sufficient, canExplain false).
- New: QI-shaped deck (47 sections, title merged, all covered, <= 8, runs kept together, deterministic, capacity overflow contiguous), titles/objectives, sessionView objective, three-way grounding, covered-never-unanswered, relatedSections thresholds, recovery scoping.

**Not done / for later slices**: no prompt text changed (no version bump; L-B owns prompts and the partial/insufficient rendering). `learn/assistant` still slices step ids to `STEP_MAX_SECTIONS` (personal AI, out of scope). Sentence-casing is heuristic (a Title-Case word stays capitalised unless the notes write it in lower case). Not exercised against a database or staging (L-C).

### 31 Oct - L-B done (prompt + UI; 2 commits 3272346b + ab0a3bfe, not pushed; no migration; act/route.ts untouched)

**Prompt**
- `PROMPT_VERSIONS.learnTeach = "scholar-learn-teach-v1"`; `learnPromptVersion("teach")` = `scholar-learn-v3:teach+scholar-learn-teach-v1` (research: `...+research-v2`). Other actions unchanged (`scholar-learn-v3:<action>`). Old free-text Teach artefacts are no longer served by key (new key); still listed by continuity and render as written.
- Teach reply = labelled parts: `OVERVIEW:` / `KEY POINTS:` (`- ` lines, cited) / `EXAMPLE:` (only when the passages describe a situation; never invented) / `CHECK YOUR UNDERSTANDING:` (1-2 questions ending `? [S n]`).
- `generation.checkTeachAnswer` (teach only, in `runLearn`): overview + key points through `checkLearnMain` unchanged (fail = whole answer withheld, same reasons); the example checked alone by `checkLearnMain`, DROPPED if it fails; each question must cite given [S n], end in `?`, 8-300 chars, no [R]/[E], no identifier, pass `groundingViolations` on the passages, else DROPPED; max 2. `OVERVIEW: NOT_IN_NOTES` -> `not_in_notes`. Unlabelled answers checked whole as before. Shown/saved text is the canonical form (`teach-format.composeTeachAnswer`).

**UI** (`learn-client.tsx`; pure helpers in `src/lib/individual/scholar/teach-format.ts`)
- Step header: lesson title (`step.title`, fallback reply `lesson.title`, then "Step n") + "In this lesson: <objective>" (omitted when missing). Step list shows lesson titles (from L-A).
- Teach Me (policy start action) = primary button; Explain / Simplify / Go deeper / Examples / Summarise / Ask Scholar + Depth = secondary "More ways to learn". Defaults unchanged.
- Answers: [S n] are inline links (`aria-label "Source Sn: <citation>"`) to the section; structured Teach shows Overview / Key points / "Example from your notes" / "Check your understanding" (+ "Answer this"). Cited sources + excerpts behind native `<details>` "View sources (n)", collapsed by default.
- `replyState`: shown + sufficient (or no grounding, or check/clarify) -> `teach`; shown + partial/insufficient with uncoveredTerms -> `partial` = teaching, then "Not covered in your notes: <terms>." + "Explore wider sources" (only when `grounding.wider`; opens the existing RecoveryFlow in that mode for the uncovered terms); withheld -> `recovery` (existing Withheld + RecoveryFlow, unchanged); continuity unchanged. No "This isn't in your notes" banner on a shown answer.
- Footer: "Check my understanding" primary after an answer (uses a Teach question citing only the step's own sections -> `clarify`, verdict recorded as before; otherwise the `check` action), then "Continue to the next lesson" / "Finish session" becomes primary once a verdict exists (or no check offered). Continue is always available. Only `md:` breakpoint used; `pointer-coarse` touch sizes; break-words on long titles/citations/excerpts.

**Tests**: `teach-format.test.ts` 15/15 (parse/compose round-trip, old-format null, citation segments, example/question drop rules, ungrounded key point withholds, bad tag, max 2, unstructured whole-check, prompt + version, replyState mapping); learn, learn-integration, learn-research, learn-research-quality green; scholar-learning harness 160/0; tsc clean (needs `NODE_OPTIONS=--max-old-space-size=8192`); eslint clean on changed files. Not exercised in a browser (L-C).

**L-C should assert** (staging, QI pptx)
1. Teach on lesson 1 (title slide merged): shown, structured (Overview + Key points), every [S n] a working link, provenance `scholar-learn-v3:teach+scholar-learn-teach-v1`; no example unless the slides describe a situation; 0-2 check questions, each citing a step source.
2. "View sources (n)" collapsed by default; opens with Enter/Space; excerpts only inside it.
3. A partial lesson: teaching shown first, then "Not covered in your notes: ..." with only terms absent from the shown passages; no "This isn't in your notes" banner; "Explore wider sources" (notes mode) opens recovery in notes_and_library.
4. A withheld answer: existing recovery, covered/unanswered consistent with what is shown; no other material's sections in My notes only.
5. Check my understanding -> answer -> verdict (understood/partly/not_yet) shown and recorded (414 event action clarify with verdict); step list shows the verdict; Continue works with and without checking.
6. A resumed old session renders with its stored steps (titles/objectives recomputed), old saved Teach answers render as plain text with citation links.
7. 375px: no horizontal scroll on the lesson, sources disclosure and Not-covered block; touch targets >= --cmp-touch-min on coarse pointer.
