# Migration 620: staging record (27 Oct 2026)

**Authority:** owner, 27 Oct 2026: "stage and apply to production, 620 is a go".
**Target:** ezhvpgtcqcdsgylrxgdb (staging), confirmed by `judgeDbTarget` before every run. Every file ran whole (node-postgres simple query, as the SQL editor does). FINGERPRINT and VERIFY are read-only.

| File (LF, 0 CR, ASCII) | sha256 |
|---|---|
| 620-organisation-governance-studio.sql | c890deba6a9baf1ed7105d41e0cd4ef2fc494d33d4c7990924311cde59617ae6 |
| ROLLBACK-620.sql | 1cb2c76544259bb874812a02181e9adc605e416317e96b59fa9799993ff1f3ba |
| VERIFY-620.sql | 72e0461b0ae34ca50249cf47772affbe3470a4b07ff2d104bbe24c364e078196 |
| FINGERPRINT-620.sql | d0c17006770d3c534050d509c1ea7cb76e1dd5f1d325b8654b95c05881a9cc4e |

| Step | FINGERPRINT-620 (tables, functions, triggers, columns) | FINGERPRINT-610 |
|---|---|---|
| PRE | 0, 0, 0, 0 | 8, 9, 3 |
| Apply #1 | 3, 15, 3, 8 (v1 published, 21 positions, v1 projects: null) | |
| Apply #2 | 3, 15, 3, 8 (idempotent) | |
| ROLLBACK-620 | 0, 0, 0, 0 = PRE | 8, 9, 3, VERIFY-610 17/17 |
| Re-apply | 3, 15, 3, 8. **The current staging state.** | |

**VERIFY-620:** 12/12 true after apply #2 and after the re-apply. The capability exists and is granted to no position, and it is platform-sensitive. The 511 classes are unchanged. There is one structure (scholar on individual). Version 1 is published, effective 2026-10-27, and holds the 610 structure (5 units, 21 positions, 7 relationships, 20 links, 1 pair, 3 levels). Holdings Technology Services still has no level. Every body is introduced by v1, and v1 projects without error. There are 8 relationship types, and relation is a foreign key. The 610 decisions are untouched (1 interim, 6 pending, 0 approved), and nobody is appointed.

**Production:** applied by the owner, by hand, in the SQL editor (CLAUDE.md, state 4). See 620-build-record.md for the steps.
