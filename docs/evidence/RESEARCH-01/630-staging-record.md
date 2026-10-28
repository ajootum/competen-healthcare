# Migration 630: staging record (28 Oct 2026)

**Authority:** owner commissioning GO, 28 Oct 2026: "GO for migration 630 staging integration and completion of the existing PR. Use the recorded migration checksum and established migration procedure."

**Target:** ezhvpgtcqcdsgylrxgdb (staging), confirmed by `judgeDbTarget` before every run.
- Every file ran whole, as node-postgres simple queries (the same way the SQL editor runs them).
- Every file is LF only, with no CR; the runner refuses one that has any.
- FINGERPRINT and VERIFY are read-only.

| File | sha256 |
|---|---|
| 630-research-evidence-engine.sql | e0c32d844c3e5ecd866605292bdd886aa62e3a35998413e27573a3aac2b3b53e (the recorded checksum) |
| ROLLBACK-630.sql | 2b7faaad6d5356c15844ad8001a076255c233fa1f28647b36008b2e7d3c3e10d |
| VERIFY-630.sql | 414c1fc6546cde98a037e9a455cfbfcd6334ea202b9697ff0824349ef0215a65 |
| FINGERPRINT-630.sql | 9b621ddb9f41b58907ad91450239b8a15a28d296d0b108cdb83aa76ba05acbde |

FINGERPRINT-630 reports four counts: capability, grants, tables, columns.

| Step | FINGERPRINT-630 |
|---|---|
| PRE | 0, 0, 0, 0 |
| Apply #1 | 1, 0, 1, 13 |
| Apply #2 | 1, 0, 1, 13 (idempotent) |
| VERIFY | 8/8 true |
| ROLLBACK-630 | 0, 0, 0, 0 = PRE |
| Re-apply | 1, 0, 1, 13, and VERIFY 8/8. **This is the current staging state.** |

**VERIFY-630 confirms:**
- the capability `hq.platform.research.manage` exists in the platform space and is granted to **no position**;
- `plat_research_requests` exists, with RLS on and no policy;
- the table has no person or query column;
- the outcome check is present, and so are both indexes.

**Integration on staging, after the re-apply:**
- `scripts/scholar-research01-acceptance.ts` passed 11/11.
- R7: research usage rows were written under a Scholar AI action id and attributed to that action's 600 outcome.
- R8: `research_retention` ran through the existing job runner (`plat_job_runs`, status success). It removed nothing current and kept the spend, audit and AI records.
- No configuration was written. The research engine on staging is not operational: nothing is published and no source is Active.

**Dependencies:**
- `hq_capability` (CP-HQ) and `gen_random_uuid()`.
- It is independent of 600, 610 and 620, and can be applied at any time after 620.

**Production:** state 4. It needs a separate owner GO and is applied by the owner, by hand, in the SQL editor:
1. Record the recovery reference.
2. Run FINGERPRINT-630 and expect `0 | 0 | 0 | 0`.
3. Apply the file whole.
4. Run FINGERPRINT-630 and expect `1 | 0 | 1 | 13`.
5. Run VERIFY-630 and expect 8/8 true.

ROLLBACK-630 is the rollback.
