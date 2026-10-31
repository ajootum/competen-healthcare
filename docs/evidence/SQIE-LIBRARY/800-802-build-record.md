# SQIE-LIBRARY-EXPANSION-01 — build record for migrations 800, 801, 802

Owner GO 31 Oct 2026, "Scholar Release Decisions", items **F** (governed library questions beyond four-option MCQ;
learner question contributions under a separate permission) and **G** (retire one published version, keep history).
Branch `scholar/sqie-library-expansion-01` from `main` 9aa6fa18.

**State: 2 — applied and verified on staging** (`ezhvpgtcqcdsgylrxgdb`), each file twice. **Not applied to production.**
`main` may hold these files before production does: every code path that depends on them fails closed (below), and the
learner-facing part is behind `scholar_question_offering`, default **off**.

## Files, checksums, order, dependencies

Release folder: `RELEASE-2026-10-25/PENDING-31/` (README there lists PRECHECK, VERIFY and ROLLBACK checksums too).

| Order | Migration | sha256 (LF) | Depends on |
|---|---|---|---|
| 1 | `800-ckri-library-question-formats.sql` | `a3234179929b208cb1fc1147fb609bbab4d0b0310921f18de017dc7a701ee2aa` | 442, 710, 721 |
| 2 | `801-ckri-knowledge-version-retirement.sql` | `64f497e259f9c768386bb45f7670e1ed1abddb26c70d2502f6b37a08c09f4ab1` | 440/641, 442 (independent of 800/802) |
| 3 | `802-question-contribution-offers.sql` | `69208209dbfb48b943500012e5359fe2a0d3517deedb9c7a33971fc9443c60c6` | 423, 440/641, 442, **800** |

House rules (`scripts/migration-house-rules.ts`): ALL CLEAR on all three and on the three ROLLBACK files (warnings only:
the APPLY WHOLE constructs). ASCII only, no semicolons in comments, no partial unique index, `notify pgrst` last.

## Pre-application state (staging, read before the first run)

- `ckri_knowledge_content_ok` body **identical** to the 721 file; `individual_scholar_question_library_guard` body
  **identical** to the 710 file (compared byte for byte from `pg_proc.prosrc`).
- `individual_scholar_question_revision_check`: library copies `kind = 'mcq'` only. `ckri_knowledge_version_check`:
  origin in (educator, ai_draft). `ckri_knowledge_resource_check` includes `osce_station` (721 present).
- Library copies: 0. No `question_contribution_*` table. One person holds `hq.quality.knowledge.publish`; nobody holds
  `hq.learning.ckri.educator`.

## Staging application (31 Oct 2026, UTC)

Each migration applied twice, committed both times (idempotent): 800 at 21:49:39Z and 21:49:41Z, 801 at 21:49:44Z and
21:49:46Z, 802 at 21:49:48Z and 21:49:51Z (final LF files; an earlier CRLF copy of the same SQL had also been applied twice
and verified). Post state: `ckri_question_format_ok`, `ckri_knowledge_retire_version`, `question_contribution_offer` and
`question_contribution_queue` present.

### Verification (each runs in one block that always raises its result, so nothing is kept)

| Script | Result | What it proves |
|---|---|---|
| VERIFY-800 | **pass=46 fail=0** | every format sample built by `validateLibraryQuestion` is accepted by the DB; the 442 legacy shape still accepted; 14 planted bad shapes refused (all-correct mrq, out-of-range index, 2 key points, AI marking on flashcard/short, mcq with a key, true_false "maybe", repeated order, 1 part, cloze without blank, unknown format, no marking, unequal match); for each of the 10 formats a planted published, approved version and its exact copy (`libraryCopyOf`) stored; refused: an edited mrq key, an mcq copy without its rubric, an mcq copy with another key, an extended copy without its marking rule, a flashcard copied as short, reordered match prompts, a case copy; an unchanged update allowed, an edited answer refused. |
| VERIFY-801 | **pass=17 fail=0** | RLS on, no policy, service-role-only execute; refused: no capability, short reason, a submitted version, a direct write to the record; retiring v1: v1 retired, resource still active, v2 untouched, one record row, no published version left, the learner copy kept with its `library_version_id`, an unchanged update to it allowed, a NEW copy of the retired version refused, second retirement refused, retired version can never be republished, record update/delete refused. |
| VERIFY-802 | **pass=27 fail=0** | objects (RLS, no policy, queue has no user/source column, no grant to authenticated/anon); no offer without permission; grant + event; refused: an NHS number, a non-library snapshot, an offer starting taken; attestation/format/hash set by the DB not the caller; content immutable, no direct taken, no delete; take refused for a non-educator, a DRAFT of origin `learner_contribution` authored by the educator, quote left out, rights declared as source; taken twice refused; a taken offer cannot be withdrawn; origin offer frozen; direct `learner_contribution` insert refused; promotion on publication; withdraw, decline, erasure (user set null) and revoke purge content; offer after revocation refused; event append-only; the queue shows only the promoted offer. |

### Rollback rehearsal

ROLLBACK-802, then 801, then 800, run in ONE transaction that then raised (nothing kept): every object dropped, the 442
CHECK, the 710 CHECK and guard and the 721 function restored (`REHEARSAL RESULT` all true). Each ROLLBACK refuses while
dependent data exists.

## What the code does (and how it fails closed)

- **Formats (800).** `src/lib/individual/scholar/library-format.ts` is the ONE reader: `validateLibraryQuestion` (HQ draft
  save, submit, publish — `src/lib/knowledge/educator.ts`; Scholar before offering a version — `library-questions.ts`) and
  `libraryCopyOf` (the learner copy, rebuilt identically by the 800 guard). HQ editor: format select with per-format fields,
  rubric, marking rule (`KnowledgeControls.tsx`, built server-side by `src/lib/knowledge/question-format.ts`); duplicate
  detection and source rights unchanged. Catalogue shows format, key, rubric, marking. Revision sessions offer library items
  of the formats asked for before AI; adaptive exams keep mcq only. Marking: AI evaluation of a library copy only where its
  version says `rubric_ai_formative` (extended only); otherwise code, then the learner's own judgement.
  Without 800: no format content can be saved (442 refuses), so only legacy mcq items exist and are offered.
- **Single-version retirement (801).** `retireVersion` (educator.ts) → `ckri_knowledge_retire_version`; buttons on the
  catalogue detail (publish holders) and the publication page. Retired versions are excluded from Scholar selection
  (`state = 'published'` reads) and from the catalogue "Active" filter. Without 801 the action says it is not available.
- **Learner offers (802).** `src/lib/question-offers/offers.ts` (outside Scholar paths, as `src/lib/cases/candidates.ts`):
  permission (attestation `question-attest/1`), `judgeQuestionOffer` (library shape, identifier screen incl. quote,
  12-word verbatim overlap against the question's notes section, quote only with per-offer rights confirmation), offer,
  withdraw, revoke, erase-all withdrawal. Scholar routes `/api/individual/scholar/question-offering` and
  `/api/individual/scholar/questions/[id]/offer`; panel on Saved learning. HQ: "Learner offers" on the educator page
  (`src/lib/knowledge/learner-offers.ts`, reads only the queue view). Switch `scholar_question_offering` (fallback off)
  gates grant and offer only. Without 802: the panel is hidden, routes say not available, HQ queue shows none.

## Checks run

vitest (new: `library-format.test.ts`, `question-format.test.ts`, `question-offers/offers.test.ts`, additions to
`question-library.test.ts`, `sqie-close.test.ts`, `policy.test.ts`; plus the existing tests of touched areas:
src/lib/knowledge, src/lib/cases and the Scholar revision/flashcard/adaptive/sqie files) — green. Harnesses:
scholar-learning, ckri, plane-boundary, case-intelligence, hq-nav-registry, pd-screen-doctrine, design-system-themes —
green. `tsc --noEmit` clean, eslint on changed files clean.

## Known gaps (not done here)

- Deleting ONE material does not withdraw offers made from its questions (erase-all does); an offer holds only the
  screened structured question, never notes.
- No retention expiry for untaken offers (case candidates have one).
- The scholar-learning harness has no dedicated S1c rule pinning the offer routes to `src/lib/question-offers` (S1 passes:
  no Scholar file names the tables).
- The clinical review page shows a format question as its JSON content (as before for every non-station kind).
- No browser walk-through was run.
