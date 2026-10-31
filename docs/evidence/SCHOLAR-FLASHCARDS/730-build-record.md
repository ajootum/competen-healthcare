# Migration 730 build record: flashcards, the learner's own cards, decks and card marks

**Authority:** SCHOLAR-FLASHCARDS-01 (owner, 31 Oct 2026), expanded the same day to "Flashcards and Downloadable Revision Guides V1". The owner gave GO to prepare and validate on staging. Applying it to production is a separate act by the owner.

**State (CLAUDE.md, four migration states):** 2, applied and verified on staging. **Not applied to production.** The code that needs it fails closed while it is absent (see "Gate").

| | |
|---|---|
| File | `supabase/migrations/730-individual-scholar-flashcard-decks.sql` |
| sha256 | `21e62861be5161d8c9342e180ecf3051020b9d077199788680c9e0894c9dec7d` |
| Rollback | `docs/evidence/SCHOLAR-FLASHCARDS/ROLLBACK-730.sql`, sha256 `cb5c1c38389800322ed4920df7941ea95a117a3d1be316f9e2617d62573bb687` |
| Precheck | `docs/evidence/SCHOLAR-FLASHCARDS/PRECHECK-730.sql` (read only, reports by raising, run before and after), sha256 `338e75c75d9311f527b0324e6ad8412b86853b8c8150f31edbe0708f020d4a4b` |
| Verify | `docs/evidence/SCHOLAR-FLASHCARDS/VERIFY-730.sql` (staging behaviour checks, always rolled back), sha256 `cea6959b28c0f9e6576d71e2c2897f65c841d2258a2ce65efdd25f0157aaa366` |
| Depends on | 372 (`individual_scholar_question`, `individual_scholar_material`, `individual_scholar_card`), 416 (kind `flashcard`, `review_status`), 710 (`library_version_id`, used in the new CHECK). All three are in production. |
| Application order | 372, 416, 710, then **730**. 730 does not depend on 720 or 721. |
| House rules | `npx tsx scripts/migration-house-rules.ts` ALL CLEAR: 164 lines, 32 statements, 4 constraints, no warnings. No `$$`, no function, so no APPLY WHOLE banner is needed (it may still be pasted whole). |
| Risk (OPS-001 s8) | Proposed **Low**: additive. Two defaulted or nullable columns and one CHECK (every existing row satisfies it, validated) on `individual_scholar_question`, three new tables with RLS. No function, trigger, backfill or row change. |

## What it changes

1. **A card the learner writes.** `individual_scholar_question.content_version integer not null default 1` and `content_updated_at timestamptz`. New CHECK `individual_scholar_question_learner_card_check`: model is `learner` exactly when provider is `learner`; such a row must be kind `flashcard`, `review_status private_formative`, no library version, `prompt_version learner:v1`, empty `source_quote`, no `correct_index`; only such a row may have `content_version` above 1; `content_updated_at` is set exactly when the version is above 1. So a hand-written card can never carry a notes quote, a library provenance or an approved status, no AI or library row can be edited in place, and no other row can claim to be hand-written.
2. **Decks.** `individual_scholar_flashcard_deck` (title 1 to 120, `organise_by` personal / module / topic / document / competency, `organise_ref` 1 to 200 unless personal, `last_studied_at`), and `individual_scholar_flashcard_deck_card` (deck, card, position; one row per deck and card; composite foreign keys to the deck and to the question on the same `user_id`, both cascading). A deck **references** cards: the schedule stays on the 372 card, so moving a card between decks never copies or resets its history.
3. **Card marks.** `individual_scholar_flashcard_mark` (per learner and card: `bookmarked`, a private `note` up to 1000 characters, `issue` as one of the five codes of the existing feedback path `inaccurate, unclear, difficulty, relevance, evidence`, with `issue_at` set exactly when an issue is). Codes only for issues. Never published, never read into the library.
4. **RLS** on the three tables with an own-row SELECT policy only (owner ruling D6, as 372, 417, 720). Writes go through the service role in `store.ts`, keyed on the caller.

No reference to estate learning tables, `assessments`, `clinical_cases`, `competency_verification_*`, credentials or Passport tables.

## Pre-application state (staging `ezhvpgtcqcdsgylrxgdb`, 31 Oct 2026)

`PRECHECK-730.sql`: question table, card table, 391 review log present; 416 `answer` and 710 `library_version_id` present; 730 column, CHECK and all three tables **absent**; question table 23 columns; 3 questions, 0 flashcards, 0 rows with model or provider `learner`.

## Applied twice (idempotent)

`echo 'ezhvpgtcqcdsgylrxgdb' | node C:/Users/elish/CompetenBackup/bin/run-staging-sql.mjs supabase/migrations/730-individual-scholar-flashcard-decks.sql`, each run one transaction.

- Run 1: `Done on ezhvpgtcqcdsgylrxgdb. Committed.`
- Run 2: `Done on ezhvpgtcqcdsgylrxgdb. Committed.` sha256 before and after: `21e62861...dec7d`, unchanged.

## Post-application state and verification

`PRECHECK-730.sql` after: 730 column, CHECK and all three tables present; question table 25 columns; 0 learner rows.

**Behaviour checks (`VERIFY-730.sql`): `VERIFY 730 RESULT pass=25 fail=0`**, rolled back. Planted against an existing staging section:

| Accepted | Refused |
|---|---|
| A1 a hand-written card (as `insertLearnerCard` writes it) with its 372 card | B1 a hand-written card with a notes quote |
| A2 an AI-written flashcard as generation writes it | B2 model learner with another provider; B3 a hand-written short answer; B4 a hand-written card with an AI prompt version |
| A3 the learner's edit: version 2 with its edit time | B5 an AI card edited past version 1; B6 a version above 1 without its edit time; B7 version 0 |
| C1 two decks (one organised by module), three deck cards | C2 empty title; C3 an unknown organisation; C4 organised by topic with no topic; C5 the same card twice in a deck; C6 a deck card under another user |
| D1 a mark with bookmark, note and issue code | D2 an issue as free text; D3 an issue with no time; D4 a 1001-character note |
| E1 a card moved out of a deck (and the deck removed) keeps its schedule exactly; E2 a card deleted leaves no deck card, mark or 372 card; E3 deleting a card leaves its deck | |
| F1 RLS on the three tables; F2 one read-own SELECT policy on each | |

**Rollback rehearsal**, each in a rolled-back transaction:
- A: `ROLLBACK-730.sql` with no dependent rows: the column, CHECK and tables gone, question table back to **23 columns** (the pre-application count).
- B: with one deck planted it refused: `ROLLBACK 730 refused: 0 hand-written card(s), 0 edited card(s), 1 deck(s), 0 deck card(s), 0 mark(s) depend on 730.`
- The post-state precheck was taken after the rehearsals: staging still carries 730.

## Gate: how the code fails closed without 730

`store.ts flashcardSchema` probes `select id` on `individual_scholar_flashcard_deck`, keyed on the caller: a missing table is remembered as not installed (as 710 and 720 are detected). Then hand-written cards, decks, bookmarks, notes and issue reports are not offered (the Flashcards page says so, and their routes answer 409), and everything else about flashcards (cards from notes, library cards, gap cards, study, two-button recall on the existing SM-2, history) works exactly as on 710. The policy `scholar_flashcards` (default on) can switch Flashcards off altogether (routes 403, Revise does not offer it).

## Production

**Not applied.** For a production GO, the owner:
1. runs `PRECHECK-730.sql` (dependencies present, 730 absent, 0 learner rows);
2. records the recovery reference (OPS-001);
3. pastes the 730 file into the SQL editor (sha256 above);
4. re-runs the precheck: 730 present.

The release copy is in `RELEASE-2026-10-25/PENDING-25/` with its precheck, verify and rollback.
