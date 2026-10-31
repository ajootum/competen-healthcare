# SCHOLAR-FLASHCARDS-01 s14 acceptance (renal system + respiratory assessment notes) -- staging, 31 Oct 2026

Harness: `scripts/scholar-flashcards-acceptance-harness.ts` (STAGING_ONLY in `scripts/ci-harnesses.ts`).
Target: staging `ezhvpgtcqcdsgylrxgdb` (migrations 710, 720, 721, 730), dev server `http://localhost:3100` at `1f944383`
(`scholar/practice-exams-01`). Every check reads a real output: route replies, stored rows, rendered page HTML, and
the exported PDFs parsed back (pdf-lib for structure and page size, unpdf for text and positions).

Two runs. **Run 2 is the record: ALL GREEN, 52 passed, 0 failed, 1 pending (point 5 browser check, coordinator).**
Run 1 had one harness bug (it read attempts by a `session_id` column; the column is `revision_session_id`) and was
stopped by the harness's own 590 s time limit after Z1. Run 2 removed run 1's fixtures first and confirmed it (Z2).

Material: two short lecture notes uploaded as text. Renal (13 lines: nephron structure, GFR/eGFR, AKI definition,
KDIGO stages 1-3, pre-/intrinsic/post-renal causes, fluid balance chart, daily weights, what to report). Respiratory
(9 lines: consent, rate over a full minute, effort, SpO2 against target, breath sounds, distress signs, first-line
actions, SBAR, documentation). Learner A made two decks ("Renal system", organised by module; "Respiratory
assessment", organised by topic) and generated cards INTO them (Revise, mode flashcards, scope the document,
quantity 6 and 4).

## Result per acceptance point

| # | Point | Result | Evidence (run 2) |
|---|-------|--------|------------------|
| 1 | Learner generates meaningful flashcards from uploaded notes | PASS | Renal: 6 generated (2 AI calls, one per section), respiratory: 3 (1 call); each filed into the deck asked for. The generation reply carries learner views only (`id, kind, stem, difficulty, options, materialId, materialTitle, chunkId, citation, label, grounding`): no back, rationale or quote before reveal. |
| 2 | Clear questions, accurate answers | PASS (quality notes below) | All 9 fronts are questions ending in `?`; none copied from the notes (`flashcardDraftProblem` null on all), no repeated fronts. Every answer agrees with the note. Judged by hand: see the cards below and Q1. |
| 3 | Source references preserved | PASS | Every AI card: origin `notes`, citation ("Renal system lecture, section 1/2", "Respiratory assessment lecture, section 1"), and a quote found word for word in the uploaded note; label "From your notes · AI-written, not clinically reviewed". The deck PDF carries the source on each card, the guide's References names the note, its sections and a short excerpt. |
| 4 | Create, edit and organise decks | PASS | Decks made (module / topic); renamed ("Renal system: AKI and fluid balance", organisation kept); a deck from chosen cards made and removed with its cards kept. Hand-written card: a copied sentence refused `not_a_prompt` (400), an NHS number refused 422, a repeat refused 409; saved with `model = learner`, `private_formative`, labelled "Your card · written by you, not clinically reviewed" (API and the All cards page HTML); edited to v2, and after review to v3 with schedule and history byte-identical; a notes card cannot be rewritten (404). Bookmark + private note: the card appears in "Bookmarked cards". A reviewed card moved renal -> respiratory: out of the first, in the second, its review object identical before and after. My Decks page HTML shows both decks. |
| 5 | Cards flip on desktop/tablet/mobile | coordinator | API/HTML only here: the study page (`?session=`) renders "Tap to reveal answer" and contains NO card back (0 of 7 in the whole response, flight payload included); reveal returns the back, source and origin label and records nothing (0 attempts). Browser fixture below. |
| 6 | Recall ratings saved | PASS | 6 ratings in session 1: 6 attempts with `revision_session_id` = the session, marking `self_graded`; 6 rows in the 391 review log, qualities matching the buttons (1 = Didn't remember, 4 = Remembered). Rating the same card twice in a session: 409. |
| 7 | Spaced revision schedules updated (existing SM-2) | PASS | Checked card by card against `scheduleRecall` with the policy bounds (mastery 5 reps / 60 days, max 3650, harder share 100 %). Session 1: Remembered -> interval 1, ease 2.5, next 2026-11-01; Didn't remember -> interval 1, ease 1.96, reps 0, next 2026-11-01. Session 2: remembered twice -> reps 2, interval 6, next 2026-11-06; lapsed then remembered -> reps 1, interval 1. "Due today" on the deck afterwards offers only the 1 unstudied card. A deck study session is stored cards only (generated 0, no AI). |
| 8 | Leave and resume a deck with the correct revision history | PASS | After 3 ratings the learner leaves; the session link returns the SAME session, still active, position 3, the 3 cards answered; the rest rated, session completed (summary 6 of 7). Reloading the deck: rated cards show one review of the grade given (`remembered` / `needs_practice`), next review tomorrow; the unrated card `new`, no history. After session 2 a card reads newest first `remembered (6 d), remembered (1 d)`. Revision History page HTML shows "Remembered", "Needs more practice" and the fronts. |
| 9 | A single deck downloads as a PDF | PASS | `format=deck&deck=<id>`: 200 `application/pdf`, `attachment`, `no-store, private`; 2 A4 pages; every question and answer, "Question"/"Answer" labels, the deck title, sources, the disclaimer. HEAD probe 204. |
| 10 | Printable A4 cards (valid PDF, A4, duplex) | PASS | `format=print`: 2 pages, both 595.28 x 841.89 (A4); page 1 holds all 7 questions and no answer, page 2 all 7 answers and no question, with "flip on long edge". Positions read back: front `#1 left, #2 right ... #7 left`; back `#2 left, #1 right ... #7 right` -- mirrored, so each answer lands behind its question. `layout=single`: A4, each question beside its answer. |
| 11 | Selected cards from multiple decks combine into one guide | PASS | Two decks (`deck=D1&deck=D2`): one guide, 10 of 10 questions and answers, title naming both. Five cards chosen across both decks (`card=` x5): a 4-page guide with exactly those 5, none of the other 5. Two decks as one deck PDF too. |
| 12 | Guide headings, questions, answers, summaries, checklist, references | PASS (quality notes below) | Renal guide, 8 A4 pages: cover with notice, Contents, 1 Key Concepts (objectives + key points: the summaries), 2 Questions and Answers (7/7 with sources), 3 Clinical Application (application/reasoning cards only), 4 Quick Revision Checklist, 5 References (note, sections, a short excerpt; "Cards you wrote: 1 card in your own words: no source attached, not clinically reviewed"), disclaimer and "Page n of m" on every page. |
| 13 | PDF assembly triggers no AI call | PASS | Around the seven exports: `plat_ai_requests` whole table 118 -> 118, the fixtures' 3 -> 3, ledger 0 -> 0. Each export audited by codes and counts only (7 rows, no card words). |
| 14 | Private learning material protected | PASS | Learner B (own note + own hand card + own deck): GET by A's card ids or A's deck id -> 200 with 0 cards; B's full list holds only B's card. Export of A's deck / two decks / card ids -> 404 JSON, no PDF; signed out -> 401. Study A's deck or card ids -> 404; GET/complete A's session -> 404; reveal/rate A's card -> 404, no back. Edit/delete A's card -> 404; rename/delete A's deck -> 404; generate into A's deck -> 404. Bookmark A's card -> 500 and add A's cards to B's deck -> 500 (refused by the database, nothing written: 0 mark rows, 0 deck rows; see D1). B's pages (A's session link, All cards, A's deck key) show none of A's fronts; the session link says "That study session could not be found". |
| 15 | No verified competency records | PASS | 28 tables counted by SQL before/after (competency_verification_* x8, assessment* x7, competency_assessment*, estate osce_* x4, individual_professional_item_verification, individual_scholar_passport_*, individual_passport_share_*, passport_share_tokens; no DACUM/rating table exists): no change. Cards are `private_formative`. |

Original acceptance (renal notes: generate, review, rate, leave, return to the saved deck with the correct revision
history): PASS by points 1, 6, 7 and 8.

## Generated cards (verbatim, run 2)

- Q: "A creatinine 2.0 to 2.9 times baseline is which KDIGO AKI stage?" A: "KDIGO stage 2 AKI is a creatinine 2.0 to
  2.9 times baseline, or urine output below 0.5 mL/kg/h for 12 hours or more." (renal, section 1, level application)
- Q: "Why should you weigh the person daily at the same time on the same scales?" A: "Because a change in weight is a
  reliable guide to fluid status." (renal, section 2)
- Q: "An enlarged prostate causing obstruction to urine outflow is which category of AKI cause?" A: "Post-renal
  (obstruction to urine outflow, such as an enlarged prostate)." (renal, section 2)
- Q: "A person has a raised respiratory rate, accessory muscle use, inability to complete sentences and cyanosis. What
  do these indicate?" A: "Signs of respiratory distress." (respiratory, level application)
- Q: "What does the structured handover SBAR stand for?" A: "Situation, background, assessment and recommendation."

The others: functional unit of the kidney (nephron), where filtrate is reabsorbed (PCT), creatinine criterion for
stage 3, why count the rate over a full minute. Run 1 produced a different but equivalent set (e.g. "What defines
KDIGO stage 3 AKI?" with all three criteria; "What first-line actions are within scope?" -> "Sitting the person
upright and giving prescribed oxygen.").

## Quality notes (judged from the outputs; not acceptance failures)

- **Q1 backs often repeat the note sentence.** 3 of 6 renal backs are the note's sentence nearly word for word, and two
  carry a second fact the front does not ask: "What is the functional unit of the kidney?" -> "The nephron is the
  functional unit of the kidney, and each kidney contains about one million nephrons."; the stage-2 card adds the urine
  output criterion. The checks pass them: `flashcardDraftProblem` (`question-intel.ts:199-205`) tests the FRONT for
  copying and the back only for length (300 chars / 2 sentences). The prompt asks for the back "in the passage's
  words" (`generation.ts:700`). Accurate, but not the crispest recall card.
- **Q2 objectives read as item-writer notes in the guide.** The model writes objectives as "Checks ability to assign a
  KDIGO AKI stage from a creatinine change." (the prompt gives no form for `objective`, `generation.ts:700`); the guide
  prints them under "You should be able to:" (`flashcard-pdf.ts:596`) and as checklist items (`flashcard-pdf.ts:150-153`),
  so the guide reads "You should be able to: Checks ability to ...". Key points are sometimes fragments ("Or urine
  output below 0.5 mL/kg/h for 12 hours or more", "Post-renal" and "Obstruction to urine outflow" apart).
- **Q3 checklist is capped at 12 per topic** (`flashcard-pdf.ts:153`): objectives first, then key points, so with 6
  objectives the last key points are cut (stage 3 and nephron absent from the renal checklist), and a hand-written card
  is never in Key Concepts or the checklist once any card of its topic has an objective.
- **Q4 no topics, no explanations.** Neither note's sections have a topic, so every card's topic is null and the
  downloads group by document ("Topics: Renal system lecture"); no generated card has an explanation (the flashcard
  item has none in the prompt). The Key Concepts section is therefore objectives and key points only.

## Defects (product code unchanged)

- **D1 (point 14, low) another learner's card id answers 500, not 404.** `PATCH /flashcards/<A's card> {bookmarked}`
  as B: `[id]/route.ts:55` calls `setFlashcardMark` (`store.ts:2979-2988`), which upserts without checking the card is
  the caller's; the composite FK refuses it and the route says 500 "That could not be saved just now.". Likewise
  `PATCH /flashcards/decks/<B's deck> {add: [A's cards]}`: `decks/[id]/route.ts:36-41` adds ids it never checked
  belong to the caller, `addDeckCards` (`store.ts:2954`) fails on the FK, 500. Nothing is read or written (0 rows), so
  privacy holds, but the status reads as a server fault and the ownership rule rests on the FK alone.
- **D2 (point 11, low) a guide of chosen cards is titled "All cards".** `exportTitle` (`flashcard-pdf.ts:78-85`)
  falls through to "All cards" when only `card=` ids are named, so the 5-card guide from two decks is called
  "All cards" and downloads as `Competen-Scholar-All-cards-revision-guide-2026-10-31.pdf`.

## Cost and AI

Learner A: 3 calls, all `individual_scholar_revision_flashcard` on `claude-opus-4-8` (eligible and routed for
`questions`, tier clinical_educational), $0.0729. Learner B: 0 calls. Browser fixture: 2 calls, $0.0477.
**Run 2 total $0.1206**; run 1 about $0.12 as well. No refusal, no failed call.

## Staging state after the run

- Z1: platform/individual policy rows byte-for-byte unchanged (the run changes no setting).
- Z2: fixture identities `harness-flash-grantor`, `harness-flash-a`, `harness-flash-b` and their files and rows removed.
- Kept on purpose: `harness-flashcards-browser@competen.test` -- one renal note and the deck "Renal system (browser
  check)" with 6 cards (5 AI, 1 hand-written), for the coordinator's flip check on desktop, tablet and mobile. Its
  password is only in the session scratchpad file `flashcards-browser-fixture.txt`. Remove with
  `FLASHCARDS_REMOVE_BROWSER_FIXTURE=1`.
- `harness-osce-browser@competen.test` was only read (Scholar active, consent given, 0 materials, 0 cards) and is
  unchanged. It could serve the flashcard check after a note and cards were added, but
  `scholar-practice-acceptance-harness.ts` deletes and recreates it on every run, so a separate fixture was made.

## Exported PDFs (run 2)

Saved to `RELEASE-2026-10-25/PENDING-25/acceptance-pdfs/`: `flashcards-deck-renal.pdf`,
`flashcards-print-renal-duplex.pdf`, `flashcards-print-renal-single.pdf`, `flashcards-guide-renal.pdf`,
`flashcards-guide-renal+respiratory.pdf`, `flashcards-guide-selected-5-cards.pdf`, `flashcards-deck-renal+respiratory.pdf`.
