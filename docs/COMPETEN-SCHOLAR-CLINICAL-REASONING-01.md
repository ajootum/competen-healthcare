# COMPETEN-SCHOLAR-CLINICAL-REASONING-01: Stage 5A Student Clinical Reasoning (build record)

Owner GO 2026-10-25, "COMPETEN-SCHOLAR-CLINICAL-REASONING-01, Stage 5: Clinical Reasoning & Case Intelligence". IND-004 owns 5A (CR1–CR5) and the Scholar side of 5B. IND-007 owns the shared case library, governance, the educator studio, platform screening and budgets.

**Status:**
- Development and staging integration only. **Production activation not authorised.**
- Scholar stays behind `individual_app` (server-enforced, default OFF).
- The library-facing parts sit behind `case_library` (default OFF).

**Migrations:** 435 from the coordinator's range 435–439. 436–439 are unused.

**The shared contract.** Every case is one structure, `case-blueprint/1` (`src/lib/cases/blueprint.ts`). IND-004 reviewed it (B1–B11, then R1 and R2) and AGREED it at `holdings/case-intelligence` ab79af52 (PR #72).

This record grows with the build.

## 1. Migration 435: what it adds

| Table | Holds |
|---|---|
| `individual_scholar_case` | **A student's PRIVATE case.** Its blueprint (private profile) is CHECKed as `case-blueprint/1` and at most 200 KB, with a generated `blueprint_hash` (md5). `review_status` can only be `private_formative`: an AI-written case is never stored as approved. It goes with the material it was written from. |
| `individual_scholar_case_source` | The student's sections it was written from, in order. Each goes with its chunk. |
| `individual_scholar_case_competency` | The CFCA competencies it serves, as typed foreign keys. |
| `individual_scholar_case_session` | **One playing of a case.** It plays either a private case or one exact `case_library_version` (422). The library link is ON DELETE RESTRICT, so a version is never deleted from under a student.<br>It holds ids only: stages reached, facts revealed, the current stage. It never copies a governed fact.<br>It also holds the server-only `view_salt` for the blueprint tokens, the mode (guided or independent), the debrief and the resume state. |
| `individual_scholar_case_answer` | **Every decision made, APPEND-ONLY** (one per decision point per session). It holds the options chosen OR the reasoning written (at most 4000 characters), how it was marked (`deterministic`, `self_graded` or `ai_evaluation` with its evaluator), the safety criteria broken, and any AI feedback.<br>UPDATE and DELETE are refused except in a cascade (`pg_trigger_depth() > 1`, the 388 pattern), so a session, a material or a person can still be erased. |

Composite (id, user_id) foreign keys throughout. RLS on, own-row read only. A student's reasoning text is screened for patient identifiers before it is written, and stays in their own erasable record. Nothing here is assessment, competence or Passport evidence.

## 2. Migrations

| File | sha256 (LF) | Tier | State |
|---|---|---|---|
| `435-individual-scholar-clinical-reasoning.sql` | `2e3cd7e3e24690a77cdd2ebe979c2836754b0c56ed3ae6763e44859790b4826e` | Medium (trigger function) | **Applied ×2 on staging**, rolled back and re-applied ×2. Frozen. **Not on production.** |
| `docs/evidence/COMPETEN-SCHOLAR-CLINICAL-REASONING-01/ROLLBACK-435.sql` | `2a86601bc1efcab73be6eadc4c35b11467b0907acbfffeb52fcb9f1dcff0aae4` | — | — |
| `docs/evidence/COMPETEN-SCHOLAR-CLINICAL-REASONING-01/VERIFY-435.sql` | `5fb238fdf1629a795c79e900172abdb17dd3de8d590ce86698bbd52cc140efe9` | read-only | — |

**Staging run record** (coordinating session, 2026-10-25, under the owner GO, applied after 422):
- The target was `ezhvpgtcqcdsgylrxgdb` at every step; the guard passed and every run reported "ok".
- The bytes on disk matched the shas above before and after the runs.
- House rules: ALL CLEAR at 256 lines, 49 statements and 4 constraints; the 3 notices are the expected APPLY-WHOLE ones.
- Pre-checks: `case_library_version` present; `individual_scholar_case` absent.

| Step | Tables (`individual_scholar%`) | Fingerprint | Triggers |
|---|---|---|---|
| PRE (with 416/417) | 28 | `631f024b1ab1` | `118a7170` |
| Apply ×2 (F1) | 33 | `0552fa3a8d28` | `0ee43365` |
| ROLLBACK-435, committed (F2) | 28 | `631f024b1ab1` = PRE | `118a7170` |
| Re-apply ×2 (F3) | 33 | `0552fa3a8d28` = F1 | `0ee43365` |

**VERIFY-435 at F1:**
- 5 tables with RLS on;
- 3 CHECK constraints;
- the trigger `individual_scholar_case_answer_append_only`;
- `blueprint_hash` generated ALWAYS;
- the library foreign key with `confdeltype` `r`;
- 0 cases and 0 sessions.

- **Application order:** after 422 (and after 416/417 on main).
- **Dependencies:** 372 (material and chunk, with their (id, user_id) indexes), 384 (`framework_competencies`), 422 (`case_library_version`) and profiles. Uses generated columns (PostgreSQL 12 or later).
- **Fail-closed without it:** clinical reasoning is not offered, and the existing practice cases (388) work as today.
- **Production:** none applied. Production needs a separate owner GO with the OPS-001 safeguards, after 422.

### 436: a Scholar case session plays a private case only (fix-forward of 435)

**Why.** A library-case play was storable in two places: 423's `case_library_session` (IND-007, with its delivery guard) and 435's session (private case XOR library version). The coordinator decided, under the owner's case interface approval §2 ("Do not create incompatible case structures"):
- library plays go through the shared delivery (`src/lib/cases/library.ts`) only;
- private plays use 435;
- both run on one engine (`blueprint.ts` and `library.ts`'s `applyAnswer`).

436 makes anything else unrepresentable. On `individual_scholar_case_session` it:
- drops `library_version_id`, with its foreign key and index;
- makes `private_case_id` NOT NULL;
- re-adds the CHECK without the either-or (every other clause unchanged).

| File | sha256 (LF) | Tier | State |
|---|---|---|---|
| `436-individual-scholar-case-session-private-only.sql` | `0bd76878dc7ed70c281e8b1164ce774a43c43a3d790ae7aab0d532274ab7a016` | Low | **Applied ×2 on staging**, rolled back and re-applied ×2. Frozen. **Not on production.** |
| `docs/evidence/COMPETEN-SCHOLAR-CLINICAL-REASONING-01/ROLLBACK-436.sql` | `3a73000cd2562bd57f5ab5bc7adcec27a6243230fee605d14cd3f0a4acb431d4` | — | — |
| `docs/evidence/COMPETEN-SCHOLAR-CLINICAL-REASONING-01/VERIFY-436.sql` | `b38c1f0b6d6f9edaccb4d1be31255a6a66b5ab4517f6680b2a5f86df00a12c9d` | read-only | — |

**Staging run record** (coordinating session, 2026-10-25, after 435):
- The target was `ezhvpgtcqcdsgylrxgdb` at every step; the guard passed and every run reported "ok".
- The bytes matched the shas before and after.
- House rules: ALL CLEAR (51 lines, 7 statements, 1 constraint, 0 warnings).
- Pre-check: 0 sessions with a library version.

| Step | Fingerprint (`individual_scholar%`) | VERIFY |
|---|---|---|
| PRE (435 applied) | `0552fa3a8d28` | — |
| Apply ×2 (F1) | `e87579ca0163` | `library_version_id`: 0 rows; `private_case_id` NOT NULL; 0 library FKs; 1 CHECK |
| ROLLBACK-436, committed (F2) | `0552fa3a8d28` = PRE (the 435 shape exactly) | — |
| Re-apply ×2 (F3) | `e87579ca0163` = F1 | as F1 |

- **Application order:** 435, then 436. **In the production release they ship together, in that order.**
- **Production:** none applied.
