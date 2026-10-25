# Migration 431: registered AI provider names. Staging record

**Authority:** owner, "COMPETEN HOLDINGS — NO-CODE AI PROVIDER EXTENSIBILITY", and "COMPETEN IND-007 — CONTINUE AI INTEGRATION": "Complete the authorised no-code provider-registration extension using the existing Holdings AI Gateway". Coordinator range 430–434.

**State:** applied and verified on STAGING (`ezhvpgtcqcdsgylrxgdb`). **Not applied in production, and not authorised there.** Production needs its own owner GO with the OPS-001 safeguards.

## What it changes

It widens one clause in four CHECK constraints, from the fixed list `('anthropic', 'openai', 'gemini')` to the provider-id shape `^[a-z][a-z0-9]{1,30}$`:
- `ai_price_check`;
- `ai_model_eligibility_check`;
- `ai_model_evaluation_result_check`;
- `ai_model_evaluation_proposal_check`.

Every other clause is restated byte for byte. Each table is ONE `alter table` statement (drop and add together), so a failure, or a runner that splits on the statement separator, never leaves a table without its constraint. No row, column, index, policy, grant, trigger or function changes. It is proposed Medium under OPS-001 §8 (a constraint change on existing tables).

**Why:** without it, a provider registered from HQ (`src/lib/ai/provider-registry.ts`) could not be priced (metered requests fail closed as `model_not_priced`), evaluated, or made eligible for any clinical tier. Which providers may actually be called is still decided by the published registry and the deployment host allowlist. A name passing this CHECK sends nothing anywhere.

## Files (byte-identical to what was applied)

| File | sha256 |
|---|---|
| `supabase/migrations/431-ai-registered-provider-names.sql` | `146b808e1b8a1a7cdae9b89692a12361ec3bb9fd2540758ec95b15070edd596c` |
| `docs/evidence/AI-FAIR-USE/ROLLBACK-431.sql` | `90e7aa0d9ff9bcb29995e70fced53a736c371fe84f67dbdc1a953dc182cecc51` |

- Both files are LF.
- The committed blobs hash to the same values (`git show HEAD:<path> | sha256sum`).
- House rules: ALL CLEAR.

## Staging application (main session, guarded runner)

**Fingerprint:** md5 of every constraint on the public `ai_*` tables (39 constraints, CR-stripped definitions).

| Step | Fingerprint |
|---|---|
| PRE | `5cf919bba93e77db2232ae2a8ed60282` |
| Apply #1 | `ad65e6754696d78401c04f5fa74f9bfa` |
| Apply #2 | `ad65e6754696d78401c04f5fa74f9bfa` (idempotent) |
| Rollback | `5cf919bba93e77db2232ae2a8ed60282` = PRE (byte-for-byte restore of the originals) |
| Re-apply | `ad65e6754696d78401c04f5fa74f9bfa` = apply #1. **The current staging state.** |

**Verification:**
- all four constraints report `widened = true`;
- the constraint count is unchanged at 39.

## Local proof before staging (Postgres 17, stubs plus 410, 411, 412 and 419)

**Before 431:**
- **T0:** a registered provider's price was refused.

**After 431:**
- **T1:** a registered provider is priced and has an eligibility decision.
- **T2:** built-in rows are untouched.
- **T3:** malformed names are still refused.
- **T4:** an eligible decision still needs evidence.

**Rollback:**
- **With no registered rows:** it restores the pre-state exactly.
- **With registered rows present:** it refuses for those tables, and all four constraints remain (the atomic statements).

Full detail is in `provider-registration.md`.

## ⚠ Rollback after use: fix forward

`ai_price` and `ai_model_eligibility` rows are history and cannot be deleted (the 411 history guard). Once any registered provider has been priced or has an eligibility decision, `ROLLBACK-431.sql` cannot run, because its CHECK would be violated by rows that may not be removed. From that point the only correction is a new migration.

**Recommendation:** register and price a provider on production only after 431 has its production GO and is settled.

## Dependencies and order

- **Depends on:** 410 (`ai_price`), 411 (`ai_model_eligibility`) and 419 (the evaluation tables). All are applied in production since the 25 October catch-up.
- **No dependants.**
- **Code:** the provider-registration code (`holdings/ai-provider-registry`) fails closed without 431. A registered provider simply cannot be priced or made eligible. It can merge before production has 431, and needs no flag.
