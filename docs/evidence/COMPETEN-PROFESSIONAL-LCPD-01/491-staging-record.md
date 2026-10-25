# Migration 491: staging record (coordinator, 25 Oct 2026)

**Target:** ezhvpgtcqcdsgylrxgdb (staging), guarded runner, file whole.
- FINGERPRINT-491 and VERIFY-491 part A ran read-only.
- Part B (DO block inside begin…rollback) ran whole with the notice runner.

| File (LF, 0 CR) | sha256 |
|---|---|
| 491-professional-learning-reflections-and-sharing.sql | 318f2918c93d590a69a9182900e5d1e22816a35d2c8fab6d3ad8f36120554413 |
| ROLLBACK-491.sql | f3163acbd513bbd781250042cc2c982524e1330948c7f5edac82f665d033b936 |
| VERIFY-491.sql | 14a3c94193a2355ae1133f6ff146d74bf68b75b7bb66a08b4e718790e105ffd7 |
| FINGERPRINT-491.sql | 2ac84ea1b4647ce7489c0dd60f9964dc01cb49942fde199c7b5d78ca7237cdaf |

| Step | FINGERPRINT-491 | Neighbours |
|---|---|---|
| PRE | d41d8cd9… (empty), 0 | 490 61fc23a3 / 19 / YES; 470 fp 3af2ee47 / 665 (includes 480 and 490 objects) |
| Apply #1 | 5849f02ebc56c50360ad252e7942c7df, 12 | |
| Apply #2 | 5849f02e…, 12 (idempotent) | |
| ROLLBACK-491 | empty, 0 = PRE | 490 and 470 fps unchanged |
| Re-apply | 5849f02e…, 12. **Current staging state.** | |

**VERIFY-491:**
- **Part A** (after apply #2 and after the re-apply): 4/4 true.
  - Both tables exist.
  - RLS is on, with own-row read only, on both.
  - No scope column.
  - Impact cannot be "verified".
- **Part B:** 7/7 PASS. 0 rows were left behind.
