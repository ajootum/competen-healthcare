# Migration 500: staging record (coordinator, 25 Oct 2026)

**Target:** ezhvpgtcqcdsgylrxgdb (staging), with the guarded runner, file whole. FINGERPRINT-500 and VERIFY-500 ran read-only. LOCAL-PROBES-500 was **not** run.

| File (LF, 0 CR) | sha256 |
|---|---|
| 500-hq-position-administration.sql | eb63ff4511a0958f3d34d6a4e8f8f14c926dea0f4fc5867735322aebf24fd158 |
| ROLLBACK-500.sql | cbd3764ee2a592c59f2cd051c8c57b3baea5d98950ddd86611c7aa37c4b4b44a |
| VERIFY-500.sql | a4a29c44b3e7b016ba5d64f97a5e9a46346b60e66c72a208471a40cc508f022a |
| FINGERPRINT-500.sql | 943515cc264795b8c751e7bec360f7966cf9078830d4c1b9c519fe75afd34213 |

**Data columns:** positions | grant rows | live grants | capabilities | appointments.

| Step | FINGERPRINT-500 | Data | HQ all-rows md5 (coordinator) |
|---|---|---|---|
| PRE | d41d8cd9… (empty), 0 | 20, 114, 112, 71, 2 | 31236bc3…, n=205 |
| Apply #1 | 7c86a28cd70d1125eff784e9fda87055, 17 (= local rehearsal) | unchanged | — |
| Apply #2 | 7c86a28c…, 17 (idempotent) | unchanged | — |
| ROLLBACK-500 | empty, 0 = PRE | unchanged | 31236bc3…, n=205 |
| Re-apply | 7c86a28c…, 17. **Current staging state.** | unchanged | 31236bc3…, n=205 |

**VERIFY-500,** after apply #2 and after the re-apply: 9/9 t.
- The twelve functions exist.
- Both guard triggers are enabled.
- The three grant columns exist.
- No browser role may call an action, and the service role may call every action.
- There are ten excluded pairs, and **no live position holds one**.
- No grant was written with a 500 reason column.
- No screen-action audit row exists yet.

**Data:** no position, grant, capability or appointment was changed at any step.
