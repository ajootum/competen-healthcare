# Migration 530: staging record (coordinator, 25 Oct 2026)

**Target:** ezhvpgtcqcdsgylrxgdb (staging), with the guarded runner, file whole.
- FINGERPRINT-530 and VERIFY-530 ran with the read-only runner.
- PROBES-530-local-only was **not** run.

| File (LF, 0 CR) | sha256 |
|---|---|
| 530-individual-professional-evaluation.sql | d876d29a737194e6933ffd24aabb06ccad41b9113a8d59fd8933d9b76fbf3161 |
| ROLLBACK-530.sql | 9d48fbe58d727ccffcb3a4b0094ca318fe079f6c812bb2dd26a8d7e7480bc465 |
| VERIFY-530.sql | 66bdebebb350565c7ffc340112d662e244a1a32071351831ef66d07376e1a883 |
| FINGERPRINT-530.sql | b4e87a32cb242ad489802f1de1e2af4525ee7ca17adc90ef07bd8e5b262c76f3 |

**Pre-application record:** `individual_professional_share` held 4 rows before and after. These are the retired synthetic members' links. The new unique index over them built cleanly.

| Step | FINGERPRINT-530 |
|---|---|
| PRE | 06a26372f0772dd94f67717177e125b3, 818 |
| Apply #1 | 4b3d1bdcecb070b62df09200a4dd434e, 903 |
| Apply #2 | 4b3d1bdcecb070b62df09200a4dd434e, 903 (idempotent) |
| ROLLBACK-530 | 06a26372f0772dd94f67717177e125b3, 818 = PRE |
| Re-apply | 4b3d1bdcecb070b62df09200a4dd434e, 903 = apply #1. **The current staging state.** |

**VERIFY-530,** after apply #2 and again after the re-apply, all as expected:
- **§1:** four tables, each t\|1\|1: evaluation, evaluation_annotation, evaluation_decision, share_evaluation.
- **§2:** three append-only triggers.
- **§3:** individual_professional_stage6_append_only \| t.
- **§4:** 0.
- **§5:** t.
- **§6:** three indexes: ux_..._evaluation_annotation_id_user, ux_..._evaluation_id_user, ux_individual_professional_share_token_user.
