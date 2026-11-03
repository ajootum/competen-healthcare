# SCHOLAR-PLAN-UNITS-01 — From classified sections to a learning plan

Owner instruction, 3 Nov 2026 (refines CE-03 Unified My Plan). Regression example: the owner's PowerPoint
"Essential Nursing Care of the Critically Ill" (79 slides), which Scholar classified into 49 sections and
estimated at 588 minutes, scheduling every section as an independent topic.

## 1. Finding: how the 49 sections and the 588 minutes arose

| Question | Answer | Evidence |
|---|---|---|
| What is a "section"? | One chunk of the material: one slide (or page part) of at most 1,200 characters. A picture-only slide makes no section. | `src/lib/individual/scholar/extract.ts` `chunkPages` (lines 56-75), `CHUNK_TARGET` in `config.ts`. |
| How many sections does this deck give? | 75 (79 slides, 4 picture-only: 42, 46, 48, 78). Reproduced locally with the real extractor on the owner's file. | `scripts/tmp` run, 3 Nov: `{"pages":79,"sections":75,"chars":26903,"emptyUnits":[42,46,48,78]}`. |
| Where does "49" come from? | The proposal labels each section by its first AI topic (`individual_scholar_chunk_analysis.concepts`), else its heading, and counts a label ONCE per material: "49 sections to plan" is 49 distinct labels among 75 sections. (Headings only, with no AI topics, the same deck gives 43.) | `plan-proposal.ts` `buildProposal` lines 87-96 (`fresh`, `seenHere`), `sectionLabel` line 31. |
| Is 588 a fixed 12 minutes a section? | Yes. `workloadMinutes = fresh x sectionMinutes`, and `sectionMinutes` is the policy `scholar_plan_section_minutes` whose default is 12 (no override on staging). 49 x 12 = 588. Size, pictures and difficulty played no part. | `plan-proposal.ts` line 96, `policy.ts` lines 1987-1992. |
| Why was every section scheduled on its own? | An accepted material feeds the plan one `UnstartedSection` per distinct label (`acceptedUnstarted`), and the planner spreads them over the weeks to the exam (4 weeks with no date) as "Start on <label>" Learn activities of 15-30 minutes. | `plan-proposal.ts` lines 132-150, `study-plan.ts` lines 253-258 and `unstartedItem`. |

Production could not be read from this session (the permission classifier refuses production reads), so the
49/588 figures are the owner's observation; the mechanism above reproduces them exactly in arithmetic and the
local extractor run gives the section count the mechanism starts from.

## 2. Document sections, learning units, subtopics, study sessions

| Term | What it is in Scholar | Where it lives | Changed by this work? |
|---|---|---|---|
| Document section | One chunk of the notes: the unit of citation ("slide 14"), of Learn and Revise navigation, of questions and flashcards. | `individual_scholar_chunk`, material page "Sections" list. | No. |
| Learning unit | A contiguous run of sections of one material that teaches one thing (a chapter of the deck). What My Plan schedules. | Proposed by `plan-units-build.ts`; the learner's reviewed units are stored with the acceptance (plan event `proposal`, `value.units`, by section ordinals; no migration). | New. |
| Subtopic | The headings and topics inside a unit ("Covers: ..."). Shown to the learner; never scheduled on its own. | `ProposedUnit.covers`. | New (display only). |
| Scheduled study session | A day's 15-30 minute activities inside the learner's session minutes. A unit is studied over one or more of them, revised at +1, +3, +7 days, then practised. | `study-plan.ts`, My Plan Today / Calendar. | Unchanged; a unit is one "Start on" activity that opens all of its sections. |

## 3. Design

- **Grouping**: the Learn workspace's own lesson planner (`learn.ts planSteps`, SCHOLAR-LEARN-FIX-01), run over
  all of the material's sections with planning options (`PlanStepsOptions`, defaults unchanged for Learn): a
  cut between alike neighbours costs 6x (headings before size), a unit may hold up to 12 sections / 7,200
  characters, a heading word most of the material's headings carry ("care") is not compared, and a chapter's thin
  picture slides stay with it. About one unit per 3,000 characters. No AI, no second engine. Titles are the
  lesson titles (`lessonOutline`).
- **Estimate per unit** (`plan-units.ts estimateUnit`), from metadata already held (section text size and
  headings, `extraction_quality.emptyUnits` / `aiReadUnits`):
  reading = words / 150 + 1.5 min per image-based slide; learning = reading x complexity (plain 1.0, moderate
  1.3, dense 1.6 from long words and numbers); revision = 3 x max(3, reading / 4); practice = 2 min a section,
  5-20 a unit. The basis is shown on the card ("How these estimates are made"). A material whose text cannot be
  read keeps the fixed-minutes estimate and says so.
- **Review step** (`plan-proposal-card.tsx`): merge with next, split before a section, leave out, put first; live
  totals; "Add N units to My Plan". Server validates the units against the material's own ordinals
  (`parseStoredUnits`) and stores them in the acceptance event (`plan-service.ts`).
- **Plan**: `acceptedUnstarted` yields one entry per kept unit (put-first units before the rest); "Start on
  <unit>" opens Learn with the unit's sections as chosen sources (`?s=`); coverage recommendations follow.
  Materials accepted before this change (no stored units) behave as before.

## 4. Regression: the owner's deck

Local, real extractor, headings only (no AI topics):

| | Before | After |
|---|---|---|
| Planning items | 49 (distinct labels of 75 sections) | 9 learning units |
| Estimate | 588 min (49 x 12, one figure) | 371 min: reading 61, learning 83, revision 81, practice 146 |
| Units | — | Principles of good critical care practice (slides 1-6); Personal hygiene and bed bath (7-12); Eye care (13-23); Oral care (24-29); Patient positioning and mobilisation (30-39); Pressure area care and VTE prophylaxis (40-50); Bowel management (51-60); Urinary catheter care (61-67); Infection control (68-79) |

Staging evidence (demo learner upload, screenshots at desktop and 820 px) is recorded in the PR.

## 5. Owner decisions

1. The estimate constants (150 wpm, 1.5 min per image slide, complexity factors, 3 revisions at a quarter of
   reading, 2 min practice a section) are code constants with the basis shown; make them policy only if they
   need tuning per programme.
2. `scholar_plan_section_minutes` stays as the fallback for notes whose text cannot be read.
