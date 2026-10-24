# AI-FAIR-USE-01: migration 410, staging record

**Authority:** owner GO COMPETEN-AI-FAIR-USE-01 (development and staging authorised; production on hold). Coordinator range 410–412 and 419–424. The main session applied 410 from the cfca worktree (branch `holdings/ai-fair-use`) with the guarded runner. Target was ezhvpgtcqcdsgylrxgdb in every step, the guard passed, and every run reported "ok". OPS-001 s8 tier: Medium (new functions that move balances), so the rollback was rehearsed.

**Fingerprint tool:** `npx tsx scripts/ind007-staging-schema-check.ts --ai410` (read-only).

| Step | Result |
|---|---|
| PRE (absent) | b83c7afd |
| Apply ×2 | ok. F1 = c62efbcd |
| Rollback (ROLLBACK-410.sql, a5f14130, run-staging-sql.mjs) | committed. F2 = b83c7afd = PRE |
| Re-apply ×2 | ok. F3 = c62efbcd = F1 |

**Files (bytes matched before and after the runs):**
- 410-ai-usage-ledger-and-allowances.sql: sha256 195d63ca377b8a0ab850f3a17446c2aacbf66751962977342b0a352c15a81de4. House rules ALL CLEAR (494 lines, 198 statements).
- ROLLBACK-410.sql: sha256 a5f1413010ab18075d5eb376478c6d4260f35cff5f28ac9abdf8653ce48e7f71

**Proven locally before staging** (throwaway Postgres 17, no network, stub dependencies):
- **Lifecycle:** reserve then settle; an idempotent retry holds nothing new; a double settle is refused; release charges nothing.
- **Limits:** exhaustion grants exactly 5 of 6; the reserve's hard cap holds; the activity and rolling-window caps hold.
- **Guards:** direct balance, ledger and price writes are refused; an account cannot open with a balance; a price change does not re-price an old reservation; an unpriced model is refused; anon and authenticated cannot execute the functions.
- **Concurrency:** 20 parallel reservations against room for 5 granted exactly 5. 10 parallel retries of one id left one hold and one ledger row.

**Frozen.** Further changes are fix-forward in 411 onwards.

**Dependencies:** 264 (hq_position, hq_capability, hq_position_capability) and profiles.

**Production:** not applied, not authorised. The `hq.platform.ai.manage` → platform_director grant is a privileged grant, and needs its own GO together with 410.
