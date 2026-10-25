# Migration 520: staging record (coordinator, 25 Oct 2026)

**Target:** ezhvpgtcqcdsgylrxgdb (staging), applied with the guarded runner, file whole. FINGERPRINT-520 and VERIFY-520 ran with the read-only runner.

| File (LF, 0 CR) | sha256 |
|---|---|
| 520-individual-professional-competency-portfolio.sql | f3f5aa882cb569cc6b05e374bd33ea1c71d2548adba498eabeb37156e6b5fa9d |
| ROLLBACK-520.sql | cf155b9882815644b29945f5ede26c7d079b57cb3c870687a21676a100ec22b1 |
| VERIFY-520.sql | 6b26af05cdd200bd6996e8c13a53cb194a14620e90a02d0bae7cf903ad00ca8d |
| FINGERPRINT-520.sql | 5fa86f2ef379c7fa18b4d233bfd45d8fcfbcb128ae91a42a74620d49bb5cb3dd |

**Pre-application record:** `individual_professional_evidence` held 0 rows before, and 0 after.

| Step | FINGERPRINT-520 |
|---|---|
| PRE | 1a0462b37ca29b530a15e2aa20869f35, 698 |
| Apply #1 | c1a53e8334763b155f660047fab6089e, 822 |
| Apply #2 | c1a53e8334763b155f660047fab6089e, 822 (idempotent) |
| ROLLBACK-520 | 1a0462b37ca29b530a15e2aa20869f35, 698 = PRE |
| Re-apply | c1a53e8334763b155f660047fab6089e, 822 = apply #1. **The current staging state.** |

**VERIFY-520,** after apply #2 and again after re-apply, all as expected:

| Section | Result |
|---|---|
| §1 | 3 |
| §2 | five tables, each t\|1\|1: competency_evidence, my_competency, my_competency_history, self_assessment, share_competency |
| §3 | four triggers |
| §4 | three functions |
| §5 | 0 |
| §6 | t |
| §7 | `ux_individual_scholar_passport_item_id_user` |
