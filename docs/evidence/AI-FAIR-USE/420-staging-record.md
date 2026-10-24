# AI fair use: migration 420 (allowance balances at the ledger's scale), staging record

**Authority:** the owner's AI fair-use completion GO, "Apply required migrations to staging under existing development authority". It's a defect fix found by `ai-fair-use-acceptance-harness` X1/X2 on staging. The main session applied it on 24 October 2026 from the cfca worktree (branch `holdings/ai-risk-assistant-eval`) with the guarded runner. Target was ezhvpgtcqcdsgylrxgdb in every step, the guard passed, and every run reported "ok". OPS-001 s8 tier: Low (a widening type change, no function changed), with the rollback rehearsed.

**The defect:**
- ai_allowance_account balances were numeric(14,4), and ledger amounts are numeric(14,6).
- With the official UGX rate (4,303.81), a hold of 85.215438 was booked on the account as 85.2154 and released or settled at 85.215438.
- So the account drifted from its ledger by up to 0.00005 CAU per request. It was clamped at zero, so never an overspend, but it didn't reconcile.
- It was latent under the 3,700 placeholder, which happened to give exact four-place amounts.

**Fingerprint tool:** `npx tsx scripts/ind007-staging-schema-check.ts --ai420`. It reads numeric precision and scale, which the other AI readings (data_type only) cannot see.

| Step | `--ai420` |
|---|---|
| PRE (account columns at 14,4) | e2bc6b94… |
| Apply ×2 | ok. F1 = 60c860b5… |
| Rollback (ROLLBACK-420.sql, b426b684, committed; no six-place data was present) | F2 = e2bc6b94… = PRE |
| Re-apply ×2 | ok. F3 = 60c860b5… = F1 |

**Files (bytes matched before and after the runs):**
- 420-ai-allowance-balance-scale.sql: sha256 cf424163c386273137cda4fd821e71df456d37d87802d9c116755ac721a49475. House rules ALL CLEAR (42 lines, 8 statements).
- ROLLBACK-420.sql: sha256 b426b68442a106130e557dc8f5e0bcb061db6a9325ca629d4062f6ce8a3a7a7d. It refuses once any balance uses six places.

**Proven locally first:** before 420, the ledger held 85.215438 against 85.2154 on the account. After it, hold = held and settled 77.468580 = used, exactly. Rehearsal: PRE = F2, F1 = F3. The rollback refuses with six-place data.

**Frozen.** Further changes are fix-forward.

**Dependencies:** 410. **Release order:** 420 MUST be applied together with 410, 411 and 412 (order 410, 411, 412, 420, then 419). Production must never run the four-place balances with a real reference rate.

**Production:** not applied, not authorised.
