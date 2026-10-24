# COMPETEN-SCHOLAR-REVISION-01: Stage 4 Intelligent Revision (build record)

Owner GO 2026-10-24, "COMPETEN-SCHOLAR-REVISION-01, Stage 4: Intelligent Revision & Knowledge Retention".

**Status:**
- Development, integration and staging only. **Production activation not authorised.**
- Scholar stays behind `individual_app` (server-enforced, default OFF).
- AI stays behind consent, the published legal documents and the allowance. Metering stays OFF in production.

**Migrations:** 416 and 417 from the coordinator's range (416–418, 425–429). 418 is unused.

This record grows with the build. The capability map is in the coordination notes (`IND-004-stage4-capability-map.md`).

## 1. What the migrations add (reuse, not duplication)

Stage 4 revises from what Scholar already stores. It does not add a second question bank, scheduler or review history:
- **Questions:** 372, plus 388 for competency and case.
- **Attempts:** 372, append-only study, never copied to `quiz_attempts` or `knowledge_attempts`.
- **Spaced-review cards:** 372, scheduled by the shared SM-2 in `src/lib/delivery/reinforcement.ts`.
- **Review log:** 391.

| Migration | Adds |
|---|---|
| **416** revision formats | **Question kinds.** `mrq`, `short`, `flashcard`, `match` and `sequence` beside `mcq` and `case`, each with its key in `answer` (CHECKed per kind). `mcq` and `case` keep the exact 372 shape.<br>**Question fields.** `difficulty` (1–3). `review_status`, which can only be `private_formative`: an AI-written question can never be stored as clinically approved.<br>**Attempts.** An attempt stores either `chosen_index` or `response`, never both. `marking` is `deterministic`, `self_graded` or `ai_evaluation`, and AI evaluation records the evaluator model and prompt version. `score` is the share correct (0–1). |
| **417** revision sessions | **Saved sets.** A saved revision set and its questions in order. Replaying it uses stored questions and keys, with no AI.<br>**Sessions.** A revision session with a snapshot of its questions, the position reached and its status, so a student can leave for Teach Me and come back.<br>**Attempt link.** `attempt.revision_session_id` (ON DELETE SET NULL of that column only). The answers in a session are its attempts, not a copy of them.<br>**Rules.** Composite (id, user_id) keys throughout; RLS on, own-row read. |

A short answer stores what the student wrote, in their own private, erasable record, bounded to 8000 bytes. It is screened for patient identifiers before it is written. Learn stores nothing a student types; revision keeps the answer because recall history needs it.

## 2. Migrations

| File | sha256 (LF) | Tier | State |
|---|---|---|---|
| `416-individual-scholar-revision-formats.sql` | `321daa18b3bc802c84344ec6c2931a2a78f6e6a7be9380e0a4ffc21cbc3fd88b` | Medium | **Applied ×2 on staging**, rolled back and re-applied ×2. Frozen. **Not on production.** |
| `docs/evidence/COMPETEN-SCHOLAR-REVISION-01/ROLLBACK-416.sql` | `5f40708acfedf164d6d7d462ff8937749c0ccc97fb532ecec2731232a2853a94` | — | — |
| `417-individual-scholar-revision-sessions.sql` | `ab5c6bbdf9d65ce998abe6d232eada2fd9652974ca5fa1295c7895878b3f8c8b` | Low | **Applied ×2 on staging**, rolled back and re-applied ×2. Frozen. **Not on production.** |
| `docs/evidence/COMPETEN-SCHOLAR-REVISION-01/ROLLBACK-417.sql` | `01225df99aba2092f7c730d4007da677f1a8c5622e42950b6eb2a28c256f0bff` | — | — |
| `docs/evidence/COMPETEN-SCHOLAR-REVISION-01/VERIFY-416-417.sql` | `e6e2f9ddd14a1d1e7dd022a12045100c66c66fa61886ab56ddbf03deb26ab82a` | read-only | — |

**Staging run record** (coordinating session, 2026-10-24, under the owner GO):
- The target was `ezhvpgtcqcdsgylrxgdb` at every step; the guard passed and every run reported "ok".
- The bytes on disk matched the shas above before and after the runs.
- The house rules were ALL CLEAR: 416 at 131 lines and 25 statements, 417 at 198 lines and 39 statements.

| Pre-check (read-only) | Expected | Result |
|---|---|---|
| question kinds other than mcq or case | 0 | 0 |
| questions not in the 372 shape | 0 | 0 |
| attempts with null `chosen_index` | 0 | 0 |
| the 3 constraints 416 replaces | 3 | 3 |
| server version | 15 or later | 17.6 |
| `individual_scholar_revision_set` | absent | absent |

| Step | Tables (`individual_scholar%`) | Fingerprint |
|---|---|---|
| PRE (with 413–415) | 24 | `4c18b288697a` |
| 416 ×2, then 417 ×2 (F1) | 28 | `631f024b1ab1` |
| ROLLBACK-417, then ROLLBACK-416, each committed (F2) | 24 | `4c18b288697a` = PRE |
| Re-apply 416 ×2, 417 ×2 (F3) | 28 | `631f024b1ab1` = F1 |

Triggers were unchanged throughout (`118a7170`).

**VERIFY-416-417 at F1:**
- 5 and 6 column rows;
- 7 constraints;
- 4 tables with RLS on;
- 0 questions and 0 attempts not in the 372 shape;
- `review_status` = `private_formative` on all 3 existing question rows.

- **Application order:** 416 → 417. Rollback is the reverse: ROLLBACK-417, then ROLLBACK-416.
- **Dependencies:** 416 depends on 372 and 388. 417 depends on 372, 416 and profiles, and needs PostgreSQL 15 or later for `ON DELETE SET NULL (column)` (373 already uses it).
- **Fail-closed without them:**
  - without 416, the new kinds cannot be stored and Scholar offers mcq and case only, as today;
  - without 417, saved sets and resumable sessions are not offered.
- **Production:** none applied. Production needs a separate owner GO with the OPS-001 safeguards.
