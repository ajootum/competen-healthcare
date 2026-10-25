# Migration 480: staging record (coordinator, 25 Oct 2026)

**Target:** ezhvpgtcqcdsgylrxgdb (staging), with the guarded runner, file whole. FINGERPRINT-480 and VERIFY-480 ran with the read-only runner.

| File (LF, 0 CR) | sha256 |
|---|---|
| 480-individual-professional-development-plan.sql | 7d7496106059cff97a2f65a877762602af315203ec76227f163d2b3f79c64f3d |
| ROLLBACK-480.sql | 8c85a074152a9f1562e98969adc1f0f078b9461784990914042b503eacaf079d |
| VERIFY-480.sql | 62a2ae89e836f1009a17bf616a684b8ac2adfca9c960544d823649947f10d6ca |
| FINGERPRINT-480.sql | 0d9b5c23f1e23946db6e05de7b35c821dace64dfc2ebc50595b13482a78632ad |

**Pre-application record:** `individual_professional_goal` held 0 rows before and after.

| Step | FINGERPRINT-480 |
|---|---|
| PRE (470 applied) | a0812a5017bfcfb6f49a0d2142d07b55, 443 |
| Apply #1 | 1ed4a8ec7b9a163877bbdaeeaa3f3ff0, 631 |
| Apply #2 | 1ed4a8ec7b9a163877bbdaeeaa3f3ff0, 631 (idempotent) |
| ROLLBACK-480 | a0812a5017bfcfb6f49a0d2142d07b55, 443 = PRE |
| Re-apply | 1ed4a8ec7b9a163877bbdaeeaa3f3ff0, 631 = apply #1. **The current staging state.** |

**VERIFY-480,** after apply #2 and again after re-apply, all as expected:
- **§1:** 18 \| YES.
- **§2:** eight tables, each t\|1\|1: activity, activity_goal, activity_history, goal_evidence, goal_history, goal_review, milestone, plan_competency.
- **§3:** eight triggers.
- **§4:** five functions.
- **§5:** 0 \| 0.
- **§6:** 0.
- **§7:** the status CHECK includes deferred.
- **§8:** both 393 indexes present (`ux_individual_professional_cpd_id_user`, `ux_individual_professional_evidence_id_user`).
