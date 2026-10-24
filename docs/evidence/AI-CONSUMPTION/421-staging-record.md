# AI-CONSUMPTION-01 A: migration 421, staging record

**Authority:** owner GO COMPETEN-HOLDINGS-AI-CONSUMPTION-01 (development and staging authorised), coordinator range 421–424 and 430–434. The main session applied 421 on 24 October 2026 from the cfca worktree (branch `holdings/ai-consumption-ownership`) with the guarded runner. Target was ezhvpgtcqcdsgylrxgdb in every step, the guard passed, and every run reported "ok". OPS-001 s8 tier: Medium (a replaced function that moves balances), so the rollback was rehearsed.

**Fingerprint tool:** `npx tsx scripts/ind007-staging-schema-check.ts --ai421` (read-only).

| Step | `--ai421` |
|---|---|
| PRE (ai_reserve/17) | 5d6f1574… |
| Apply ×2 | ok. F1 = b7c8533c… |
| Rollback (ROLLBACK-421.sql, dcac2859, committed; no budgets or ownership data were present) | F2 = 5d6f1574… = PRE |
| Re-apply ×2 | ok. F3 = b7c8533c… = F1 |

**Files (bytes matched before and after the runs):**
- 421-ai-consumption-ownership.sql: sha256 91d4ee201b340e702f3c71069051b94a60c1462834dcbe2480080df5371444b7. House rules ALL CLEAR (310 lines, 151 statements, 3 constraints).
- ROLLBACK-421.sql: sha256 dcac28593264de928aed6c2c564f7184cc1bfdf4a33b3090c2dc38ca6b8d3b6f. It restores 412's ai_reserve and ledger guard byte for byte, and refuses once a budget or any ownership data exists.

**Proven locally before staging** (Postgres 17, on 410, 411, 412, 420 and 419), Z1–Z9:
- A person's own request still runs and is recorded as individual.
- Nobody else, no service and no-actor can charge a person's account (owner_mismatch).
- An educator's platform request charges the budget, not the educator's or the student's account.
- A named service may initiate platform work, and nobody-at-all may not (no_initiator).
- A suspended budget refuses (budget_suspended), and a closed budget cannot reopen. Its identity cannot be rewritten or deleted.
- No unfunded institution budget can exist, and a platform budget carries no institution fields.
- An account is a person's xor a budget's, and ownership on the ledger is frozen.
- A budget's unreconciled exposure is the budget's, not the educator's own.
- Execute is granted to the service role only, and only the 21-argument ai_reserve exists.
- **Race:** 20 parallel requests against a platform budget with room for 5 granted 5.
- **Rehearsal:** PRE = F2, F1 = F3.

**Frozen.** Further changes are fix-forward.

**Dependencies:** 410, 411, 412, 420. **Application order:** 410, 411, 412, 420, 421 (419 is independent of 421).

**Compatibility note:** with 421 on staging, only the 21-argument ai_reserve exists. An engine built before it (17 arguments) cannot make a metering-ON call against staging until the A engine merges. Metering is OFF, so nothing breaks meanwhile.

**Production:** not applied, not authorised.
