# P0 controlled catalogues: migration 394, staging record

**Authority:** the owner authorised migrations 393–395 to staging. The main session applied 394 from the cfca worktree with the guarded runner (target ezhvpgtcqcdsgylrxgdb, guard passed). OPS-001 s8 tier: Medium (a new trigger function), so the rollback was rehearsed.

**Fingerprint tool:** `npx tsx scripts/ind007-staging-schema-check.ts --cfca394` (read-only).

| Step | Result |
|---|---|
| PRE (absent) | a1779d790bb8c92a2f7b615ed42cbe671cb694748aec67e678fd30c879cabc9d |
| Apply ×2 | both ok. F1 = 29722eedf45c8fe7ee952ebd82856bd991d6b08a6be03cad2888d81c9c41bf87 |
| Rollback (ROLLBACK-394.sql, 577f395c, run-staging-sql.mjs) | committed. F2 = a1779d79… = PRE |
| Re-apply ×2 | both ok. F3 = 29722eed… = F1 |

**Files:**
- 394-competency-catalogue-entries.sql: sha256 c34c3b121e97cd703f176607989e53c28ced0c927c31e270d2ba1b92b944f777
- ROLLBACK-394.sql: sha256 577f395c5a7e17a18f5d73291d2a0b18c0b48983aae660e7fd206cca81d1ffdb

**Post-state:**
- One table, `competency_catalogue_entry`, with 4 constraints and 3 indexes.
- RLS on, with no policy.
- The guard trigger and its function, `competency_catalogue_entry_guard`.
- No existing row changed.

**Dependencies and order:** it needs only `frameworks`, `framework_domains` and `framework_competencies`, so it can be applied after 384 in any position relative to 387–393. The S1 reader treats its absence as "no entries", so `main` may carry the reader before production has 394.

**Production:** not authorised.
