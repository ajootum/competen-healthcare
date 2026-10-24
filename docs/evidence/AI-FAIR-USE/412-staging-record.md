# IND-007 D1/D4: migration 412, staging record

**Authority:** owner GO "GO for migrations 411, 412 and 415 on staging". The main session applied 412 on 24 October 2026, from the cfca worktree (branch `holdings/ai-risk-assistant-eval`), with the guarded runner. Target was ezhvpgtcqcdsgylrxgdb in every step, the guard passed, and every run reported "ok". OPS-001 s8 tier: Medium (a replaced function that moves balances), so the rollback was rehearsed.

**Fingerprint tool:** `npx tsx scripts/ind007-staging-schema-check.ts --ai412 --ai411` (read-only).

| Step | `--ai412` | `--ai411` |
|---|---|---|
| PRE (411) | cf6a5a2a… (= the 411 F1) | cf6a5a2a… |
| Apply ×2 | ok. F1 = 90ead680aa39e649… | |
| Rollback (ROLLBACK-412.sql, 9b452715, run-staging-sql.mjs, committed) | F2 = cf6a5a2a… = PRE | cf6a5a2a…: 411 was restored exactly |
| Re-apply ×2 | ok. F3 = 90ead680… = F1 | |

**Files (bytes matched before and after the runs):**
- 412-ai-risk-tiers-and-rate-source.sql: sha256 9c45850b5a1b13bb0e794145c273210c79bdf4d9df7b9d2429ae00144c7fad3e. House rules ALL CLEAR (241 lines, 118 statements, 3 constraints, 3 APPLY-WHOLE warnings only).
- ROLLBACK-412.sql: sha256 9b45271528290212731d1881bb06373c8dbcd124678049523503b8fec1d005c8. It restores 411's ai_reserve and ledger guard byte for byte, and refuses once any 412 column holds data.

**Proven locally before staging** (throwaway Postgres 17, no network, 410, then 411, then 412 ×2), V1–V7:
- **V1:** a standard tier runs on an unevaluated model, and the tier and rule are recorded.
- **V2:** a null or unknown tier is judged high risk and refused without eligibility. So is a clinical tier.
- **V3:** a clinical-tier eligibility covers clinical, not high.
- **V4:** a high-tier eligibility covers high, and an eligible row with no tier is refused.
- **V5:** the tier and rule cannot be rewritten, even inside the settlement setting.
- **V6:** a non-placeholder rate needs its publication date and source, and rate history cannot be edited.
- **V7:** execute is granted to the service role only, the 411 signature is dropped, and unknown ranks as high.
- **Rehearsal:** PRE = F2, F1 = F3. The rollback refuses with 412 rows present.

**Frozen.** Further changes are fix-forward.

**Dependencies:** 410, 411. **Application order:** 410, then 411, then 412 (then 419).

**Production:** not applied, not authorised. It goes with 410 and 411 under their own production GO. The engine stays behind the `ai_fair_use` flag (OFF, fails closed).
