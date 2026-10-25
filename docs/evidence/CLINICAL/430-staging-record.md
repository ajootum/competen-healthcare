# Migration 430 (portable clinical content hash and reviewed-copy route): staging record

**Authority:**
- Owner decision (25 October 2026), CF-FOUND: "Use a reviewed-copy route from staging to production. Preserve approved content versions, identifiers, hashes and review provenance. Do not reauthor the eight competencies."
- Option (b), approved by the coordinator.
- Coordinator range 430 to 434.

**Who and where:** the main session applied 430 on 25 October 2026 from the cfca worktree with the guarded runner. The target was ezhvpgtcqcdsgylrxgdb in every step, the guard passed, and every run reported "ok".

**OPS-001 s8 tier:** Medium. It changes what approval is judged against, so the rollback was rehearsed.

**Fingerprint tool** (read-only): `npx tsx scripts/ind007-staging-schema-check.ts --cases422`. It reads the clinical tables' columns and constraints, the `clinical_*` functions and `competency_content_hash`.

| Step | `--cases422` |
|---|---|
| PRE | 3295aa70… |
| Apply ×2 | ok. F1 = 5ecc3ca3… |
| Rollback (ROLLBACK-430.sql, 63dd06aa, committed; no provenance present) | F2 = 3295aa70… = PRE (the hash function of 395 restored) |
| Re-apply ×2 | ok. F3 = 5ecc3ca3… = F1 |

**Files** (bytes matched before and after the runs):
- 430-portable-clinical-content-hash.sql: sha256 b790af090fa810879458b725a054453c499d1e31d4485ad57044aae793f1db61. House rules ALL CLEAR (147 lines, 37 statements, 2 constraints, 3 APPLY-WHOLE warnings only).
- ROLLBACK-430.sql: sha256 63dd06aa4d64dca40ff5d3b7d0252c38bb6b1db7b58672061771c6598f6c89da. It is generated from the 395 file and restores the 395 `competency_content_hash` byte for byte. It refuses once any version or decision carries provenance.

**What 430 does:**
- **`competency_content_hash` is replaced.** It covers the same content, but the expected level is hashed as (scale, score), and the practice and CPU by their code (by their id only where a code is missing). The 395 and 422 guards call it by name.
- **Provenance columns** are added on `clinical_content_version` and `clinical_review_decision`. They are null for native rows, and a CHECK requires their keys.
- **`clinical_version_import()`** records a version reviewed elsewhere under its original id and authorship, only if the content here hashes to the reviewed hash.
- **`clinical_review_import()`** records the decision under the same reviewer's appointment here, and only if the provenance names this version and its hash. The 395 decision guard still judges independence, authority, scope and staleness.
- Both functions are executable by the service role only, and are run by the owner.

**Proven locally before staging** (Postgres 17, with two databases standing in for staging and production; the level-3 row has a different random id in each):
- Under 395 the identical competency hashed `0384c5b3…` and `addb8d4b…`. Under 430 both hash `a73d00b6…`.
- **P1:** a wrong hash is refused.
- **P2:** the version is recorded with its original id, an equal hash and provenance.
- **P3:** the following are refused: the author (not independent), a borrowed appointment (not authorised), a decision without the reviewer named, and a decision reviewed at another hash.
- **P4:** the decision is recorded with its original time in provenance, and the provenance cannot be rewritten.
- **P5:** an edit after the copy makes the approval stale, and the next decision is refused. The functions are not granted to authenticated.
- Three planted violations each turned the suite red: the hash still naming the level row id, a version import that skips the hash check, and a review import not tied to the hash.
- Local rehearsal: PRE = F2, F1 = F3. The rollback refuses with provenance present.

**On staging, as accepted:** the eight CF-FOUND versions (0 decisions) are stale under the new hash and must be put forward again before review.

**Frozen.** Further changes are fix-forward.

**Dependencies:** 395 and 422. **Application order:** 395, 422, 430.

**Production:** not applied, not authorised. It needs its own GO. Production has had 395 and 422 since the 25 October catch-up. Before 430 is applied there, re-read production's `clinical_content_version` and `clinical_review_decision` counts, read-only: they were 0 and 0 before the release. Any approval present would go stale.
