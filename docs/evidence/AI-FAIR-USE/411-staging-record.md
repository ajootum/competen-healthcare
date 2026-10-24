# AI-FAIR-USE-01: migration 411, staging record

**Authority:** owner GO "GO for migrations 411, 412 and 415 on staging". The main session applied 411 on 24 October 2026, from the cfca worktree (branch `holdings/ai-fair-use`), with the guarded runner. Target was ezhvpgtcqcdsgylrxgdb in every step, the guard passed, and every run reported "ok". OPS-001 s8 tier: Medium (replaced functions that move balances), so the rollback was rehearsed.

**Fingerprint tool:** `npx tsx scripts/ind007-staging-schema-check.ts --ai411 --ai410` (read-only).

| Step | `--ai411` | `--ai410` |
|---|---|---|
| PRE (410 only) | 71c88434eff7a7b9… | c62efbcd5f939db4… |
| Apply ×2 | ok. F1 = cf6a5a2aed75e746… | |
| Rollback (ROLLBACK-411.sql, f313cf9b, run-staging-sql.mjs, committed) | F2 = 71c88434… = PRE | c62efbcd… = PRE. The 410 function bodies were restored exactly. |
| Re-apply ×2 | ok. F3 = cf6a5a2a… = F1 | |

With 411 applied, `--ai410` reads 09fa4f91. That is expected: 411 replaces 410 objects (ai_reserve's signature, the guards). `--ai410` reads c62efbcd only when 411 is absent, which is what F2 proves.

**Files (bytes matched before and after the runs):**
- 411-ai-reconciliation-fx-basis-and-eligibility.sql: sha256 9289b20cccd1f1762b78df047d23d9bf36b73aa09515793ab12bd4f7768ec3dd. House rules ALL CLEAR (417 lines, 206 statements, 4 constraints, 7 non-blocking warnings).
- ROLLBACK-411.sql: sha256 f313cf9b43d2ae140d30425b5e7a00f68474d369d93d027a30498e46cda72675. It refuses once any ledger row uses an 411 status or basis.

**Proven locally before staging** (throwaway Postgres 17, no network, 410 then 411 ×2, U0–U11):
- **Legacy row:** a 410 reservation settles at its own USD-per-CAU rate.
- **Buffer:** it widens the hold only (73.26), and settlement uses the reference rate (16.65). A later reference-rate change moves neither that settlement nor history.
- **Eligibility:** a sensitive activity on an unevaluated or ineligible model is refused (`not_eligible`), and unstated sensitivity fails closed. An eligible row needs evidence, and eligibility rows are history.
- **Unknown charges:**
  - an unreconciled hold stays in the original account;
  - a retry returns `retry: unreconciled`;
  - reconciliation settles into the original account;
  - release happens only on proof of no billing;
  - a stale hold becomes unreconciled, never released.
- **Ceiling:** the outstanding unreconciled holds, plus the new hold, may not pass it. A null ceiling or null buffer refuses.
- **Immutability:** settled rows (provider expenditure, allowance consumption) cannot change even inside the settlement setting. An unreconciled row cannot return to reserved or be edited.
- **Grants:** the service role only, and the 410 12-arg ai_reserve is gone.
- **Races:** 20 parallel against room for 5 granted 5. 20 parallel against a ceiling fitting 2 left 2 unreconciled. 10 parallel retries left 1 row. 10 parallel settle-or-release calls on one unreconciled id had 1 winner.
- **Local rollback rehearsal:** PRE = F2, F1 = F3.

**Against staging's real 411 functions, after this record** (`ai-fair-use-acceptance-harness`, privileged runner, 24 October 2026): 25/25. Covered: the 20-way race, 8 retries, unreconciled reconciliation into the original account, release on proof, the ceiling, the buffer on holds only, immutable records and reference rate, the eligibility refusal, and the browser lockout (42501). Fixtures were removed.

**Frozen.** Further changes are fix-forward in 412 onwards.

**Dependencies:** 410. **Application order:** 410, then 411.

**Production:** not applied, not authorised. 410 and 411 go together under their own GO. Code that depends on them stays behind the `ai_fair_use` flag, which defaults OFF and fails closed.
