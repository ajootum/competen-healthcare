# Build record: migration 990 and SQIE-CLOSE-2026-11 WS-D, WS-H, WS-I

**Authority:** owner directive SQIE-CLOSE-2026-11 (4 Nov 2026), sections 3 (question quality 4 and 8), 5 (persist the exact rubric version per attempt; previous attempts stay interpretable) and 7 (competency framework version; a question score never sets a stage). Tracker `docs/programme/SQIE-CLOSE-2026-11-TRACKER.md` (PR #269) ranked gaps WS-D (rank 3), WS-H (rank 2), WS-I (rank 8); rows SQIE-04, SQIE-07, SQIE-08, SQIE-11, C-13.
**Branch:** `scholar/sqie-records`, from `main` @ `661caf17`.
**State of 990 (CLAUDE.md four states):** 2, applied and verified on staging (ezhvpgtcqcdsgylrxgdb) twice, rollback rehearsed. **Not applied to production.** When merged, `main` holds 990 while production does not. The code fails closed without it (below).

## File, order, dependencies

| Migration | sha256 | Depends on |
|---|---|---|
| `990-individual-scholar-attempt-record-completeness.sql` | `230b86a4770b973a18bc5bebfcc5bcefd8968c5ed5af1ca2609c944a1acb8986` | 791 (`individual_scholar_attempt_snapshot`); 950 for the unmarked attempts it describes. PostgreSQL 12 or later (`jsonb_path_exists` with `like_regex`) |

Application order: after 791 and 950 (both applied in production). Independent of 970-989 (SALE R1, CE-04/05). Number claim: shared notes `SQIE-RECORDS-migration-number-claim.md` (990 only; 991-994 released to the SQIE block).

What it changes (additive, no row written, no backfill):
1. The 791 snapshot shape CHECK is recreated with one difference: `marking` also allows `unmarked`, and an unmarked snapshot has no score and outcome `incorrect` (the 950 rule on the attempt). `ai_evaluation` was already allowed by 791. Every other 791 bound is unchanged.
2. `individual_scholar_attempt_snapshot.competency_provenance jsonb` (nullable): per competency practised, `competency_id`, `framework_id`, `framework_code`, `framework_version` (major.minor.revision), `content_hash` (395/761 `competency_content_hash`). CHECK: an array of at most 20 objects, each with a uuid-shaped string `competency_id`, at most 4000 bytes.

The 791 guard (immutable, cascade-removable), corrections, RLS read-own and the absence of any write policy are unchanged. Passes `scripts/migration-house-rules.ts` (ALL CLEAR).

## Staging evidence (4 Nov 2026)

- Pre-state (read through the runner): the 791 shape CHECK with `marking = ANY (deterministic, self_graded, ai_evaluation)` and no `unmarked`; no `competency_provenance` column; 950 present (`content_version`); 44 snapshots; 0 unmarked attempts; 2 kept check attempts, neither with a snapshot.
- Applied twice through the owner's runner (`run-staging-sql.mjs`): both `Done on ezhvpgtcqcdsgylrxgdb. Committed.`
- VERIFY (`verify-990-strict.sql`, a read-only DO block that raises on any failure) passed after the second application: the shape CHECK allows `unmarked`, keeps the three 791 markings, the 16384 and 20 bounds and the unmarked rule; the provenance column is nullable jsonb with its CHECK; the CHECK's element rule refuses a non-object, a missing id, a numeric id and a malformed id and accepts a well-formed element; the 791 guard trigger, RLS and the read-own policy are present and no write policy exists; both CHECKs are validated.
- The VERIFY failed once before it passed, on a check it should not have made: it asserted that `anon` and `authenticated` hold no INSERT grant, and Supabase's default table grants give them one (unchanged since 791, where RLS with no write policy is the control). The check was replaced by the real control (no non-SELECT policy, read-own present). This is recorded so the PASS is not read as first-time.
- Rollback: see "Rollback" below.
- Walk: see "Staging walk" below.

## Fail closed without 990

- `insertAttemptSnapshot` (store.ts) sends `competency_provenance` only when there is one. A `PGRST204`/`42703` refusal for the column is retried without it (the 791 row exactly), and remembered for the process.
- An `unmarked` snapshot refused by 791's CHECK (`23514`) returns `absent`: the check answer stands, no error is shown, no audit row is written, and later unmarked snapshots are not tried. A self-graded or AI-judged check keeps its snapshot under 791 as before.
- The history reader (WS-I) reads `content_version` only where 950 is present, and every side read (sessions, check events, exam answers, snapshots) answers empty where its table or column is absent.

## What the code does (by workstream)

**WS-D attempt records**
- `attempt-integrity.ts keepCheckAttemptSnapshot`: after `recordCheckAttempt`, the check question is read back and snapshotted like any other answer (question as shown, typed answer, the key points as its guide, rubric hash, five-part feedback for an AI judgement). Called from `learn/checks` (self-graded and unmarked) and `learn/act` (AI-judged). Never fails the answer.
- `competency-provenance.ts`: the framework, its version and the competency content hash for the question's competency, read from `framework_competencies` / `framework_domains` / `frameworks` and `competency_content_hashes` (the assessment adapter's read). Null when unreadable; nothing invented.
- `attempt-snapshot.ts`: `competencyProvenance` on the snapshot row, written and read back.
- Scenario five parts: each AI-judged stage keeps its five feedback parts (right, missing, misconceptions, why, next) through the signed progress token (bounded so the token stays under its 12000-character read limit, earliest parts dropped first) into the attempt's formative record and the snapshot (`scenario.ts`, `revision/scenario/route.ts`). Before, `parts: null`.
- The 1500-byte rubric cap (tracker C-09 item 3) is kept: the 791 snapshot holds the full `answer_key` and `rubric_hash`, so a cut 416 rubric snapshot loses no marking record.

**WS-H quality guards (no migration)**
- `question-quality.ts keyInStem`: deterministic. For mcq and mrq an option is echoed when every one of its content words is in the stem; the stem reveals the key when at least one option is echoed and every echoed option is keyed. For short answer, an accepted answer whose every content word is in the stem. Reason `answer_leaked` (the code the scenario check already uses). Applied in `qualityProblems` (mcq and each case step) and `checkRevisionDraft` (mrq, short; a two-line hook in `revision.ts`). A refused draft is dropped before it is stored or shown, and the one regeneration is told why.
- `generation.ts checkQuestions`: the patient-identifier screen on every word of a generated mcq and case step (stem, options, rationale), reason `identifier`.
- `question-score-stage.test.ts`: pins that no Scholar module imports the stage mapping or the Benner scale; that no module on the question-attempt path imports the assessment layer or names a stage table or column; and that a perfect score of every marking writes a snapshot with exactly its 791/990 columns. Each scanner is first shown to catch a planted violation.

**WS-I unified per-question history (no migration, no new store)**
- `store.ts`: owner-keyed readers `questionAttemptRows`, `recentlyAnsweredQuestions`, `questionHeads`, `historySessions`, `historyCheckEvents`, `historyExamAnswers`.
- `question-history.ts` (pure): every attempt at one question, newest first, by source (practice, Revise session, adaptive exam, mock exam, Check your understanding) plus the exam-paper answers the question was made from; each with the effective result (a correction shown with the original), the marking, and what it was marked against (question version, content hash, guide hash, framework versions), with "changed since" notes where the live question or guide differs. An attempt without a snapshot says so and invents no version. An unmarked check reads "Kept without a mark".
- `GET /api/individual/scholar/questions/[id]/history` and the page `study/saved/history` (linked from Saved learning, and per kept check). Database reads only, no AI.

## Not competence

A snapshot, its framework version and the history are the learner's own record of private practice. A framework version says what a question practised, never that a competency was met, staged or verified. No stage table or mapping is read or written on this path, and the test above keeps it so.

## Retention and deletion

Unchanged: snapshots cascade from the attempt (791), which cascades from its question, material and learner. The history reads only the learner's own rows.
