# IND-007 D5: migration 419, staging record

**Authority:** owner decision D5 and the staging-migration GO. The main session applied 419 on 24 October 2026, after 412, from the cfca worktree (branch `holdings/ai-risk-assistant-eval`), with the guarded runner. Target was ezhvpgtcqcdsgylrxgdb in every step, the guard passed, and every run reported "ok". OPS-001 s8 tier: Low (new evidence tables only: nothing that moves a balance or grants access), with the rollback rehearsed.

**Fingerprint tool:** `npx tsx scripts/ind007-staging-schema-check.ts --ai419 --ai412` (read-only).

| Step | `--ai419` | `--ai412` |
|---|---|---|
| PRE (412) | a1779d79… | 90ead680… (= the 412 F1 and F3) |
| Apply ×2 | ok. F1 = c60f1722… | |
| Rollback (ROLLBACK-419.sql, 5fc32c3d, committed) | F2 = a1779d79… = PRE | 90ead680… |
| Re-apply ×2 | ok. F3 = c60f1722… = F1 | |

`--ai412` was read at PRE and at F2. 419 is absent in both states, so reading 90ead680 both times is expected, and it shows the rollback left the 412 objects exactly as they were. (`--ai412` includes every `ai_%` trigger, so with 419 applied it would read differently. That is why 412's own readings were taken before 419.)

**Files (bytes matched before and after the runs):**
- 419-ai-model-evaluation.sql: sha256 802f13d9b47e5572fb9ca84016e67e964d5425f73fd9e1172aff0e931f08ca14. House rules ALL CLEAR (150 lines, 30 statements, 3 constraints, 5 non-blocking warnings).
- ROLLBACK-419.sql: sha256 5fc32c3de2a4a7424a60730b521686d639b06320a403198ff80f912b440e3c66.

**Proven locally before staging** (throwaway Postgres 17, on 410, 411 and 412):
- **W1–W6:** results and proposals cannot be rewritten or deleted, a run cannot be rewritten, and a bad tier is refused. Withdrawing a whole run cascades to its results and proposals.
- **Rehearsal:** PRE = F2, F1 = F3.

**Frozen.** Further changes are fix-forward.

**Dependencies:** 410 (ai_price), 412 (the risk tiers). **Application order:** 410, then 411, then 412, then 419.

**Nothing here makes a model eligible.** Eligibility is only an `ai_model_eligibility` row a human records on the HQ page, citing the run.

**Production:** not applied, not authorised.
