# Migration 570: staging record (coordinator, 26 Oct 2026)

Target: ezhvpgtcqcdsgylrxgdb (staging), guarded runner, file whole. FINGERPRINT-570 and VERIFY-570 (coordinator-written) read-only.

| File (LF, 0 CR) | sha256 |
|---|---|
| 570-individual-scholar-exam-papers.sql | e0f887f9d950182c8cca878e1359177ab5a310b15c9cfd51be98f88de46999a7 |
| FINGERPRINT-570.sql | e24cbde4541141bbe4645f92ad1a8f08e091c90866b9d2d6f0ae48b5ff2019a5 |
| ROLLBACK-570.sql | d0fc8f34272b002b54b66b42df792a31b3a8ac837ec69a976ea5fb4b65a3d7d0 |
| VERIFY-570.sql | 05f0aa62507819ed0c76e2ac95158b01cba2cf1099408ebb0f53f400566253e5 |

| Step | FINGERPRINT-570 |
|---|---|
| PRE | d41d8cd98f00b204e9800998ecf8427e, 0 (no 570 objects) |
| Apply #1 | 2b625abaa1ed22780f9fadd1f79e13bb, 84 |
| Apply #2 | 2b625abaa1ed22780f9fadd1f79e13bb, 84 (idempotent) |
| ROLLBACK-570 | d41d8cd98f00b204e9800998ecf8427e, 0 = PRE |
| Re-apply | 2b625abaa1ed22780f9fadd1f79e13bb, 84 = apply #1. **The current staging state.** |

VERIFY-570 after apply #2: exam_answer / exam_paper / exam_question each RLS t, 1 policy, 0 rows; research_cache RLS t, 0 policies, 0 rows.
