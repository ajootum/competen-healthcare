# COMPETEN-SCHOLAR-01 S1: migration 384, staging record

**Authority:** the owner authorised SCHOLAR-01 migrations 384–392 to staging. The main session applied them from competen-ind-007 with the guarded runner (target ezhvpgtcqcdsgylrxgdb, guard passed).

**Fingerprint tool:** `npx tsx scripts/ind007-staging-schema-check.ts --s1` (read-only).

| Step | Result |
|---|---|
| PRE (absent) | 5bfd00efd4b41e7eee68d3e02efe41ba7a2cfc27854958fb612e46fe79c39786 |
| Apply ×2 | both ok. F1 = 78fd1e28ba058ad98148bbc32569952b9fea38d6b71af7c7d44e796219737388 |
| Rollback (ROLLBACK-384.sql, d5b3b97c, run-staging-sql.mjs) | committed. F2 = 5bfd00ef… = PRE |
| Re-apply ×2 | both ok. F3 = 78fd1e28… = F1 |

**Files:**
- 384-competency-layers-and-outcomes.sql: sha256 8f596a82735cda18279b3d410cac84cbe6465e6549cf3621966b453bc818d2a2
- ROLLBACK-384.sql: sha256 d5b3b97c20c44e6199906c8575828f6f11688757b240971036203d22fc01cd86

**Post-state:** 4 columns and 5 constraints (3 checks, 2 foreign keys), plus the index. No framework is classified.

**Acceptance before the seed** (`competency-foundation-acceptance-harness`):
- **D1/D2:** the schema refuses a profession catalogue without a profession, a foundational catalogue with a profession, an unknown layer, and non-list outcomes.
- **N1:** with no allowlist, neither experience is offered any catalogue.

**Production:** not authorised.
