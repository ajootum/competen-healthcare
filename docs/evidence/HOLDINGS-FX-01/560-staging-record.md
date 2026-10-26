# Migration 560: staging record (coordinator, 26 Oct 2026)

**Target:** ezhvpgtcqcdsgylrxgdb (staging), guarded runner, file whole. FINGERPRINT-560 and VERIFY-560 ran read-only. PROBES-560 wrote only inside one DO block that ends by raising, so it rolled back.

| File (LF, 0 CR) | sha256 (first 8) |
|---|---|
| 560-holdings-fx-reserve-and-settlement.sql | a8de477d |
| ROLLBACK-560.sql | dd22a4d7 |
| VERIFY-560.sql | abe01972 |
| FINGERPRINT-560.sql | 4540ceec |
| PROBES-560.sql | 93ebb47a |

| Step | FINGERPRINT-560 |
|---|---|
| PRE | b6f380dcbd7d9bab94a0561e6428ca89, 38 |
| Apply #1 | 0b96253456ad78d7675c5d8c4cd2b6ac, 73 |
| Apply #2 | 0b96253456ad78d7675c5d8c4cd2b6ac, 73 (idempotent) |
| After probes | 0b96253456ad78d7675c5d8c4cd2b6ac, 73 (probes left nothing) |
| ROLLBACK-560 | b6f380dcbd7d9bab94a0561e6428ca89, 38 = PRE |
| Re-apply | 0b96253456ad78d7675c5d8c4cd2b6ac, 73 = apply #1. **The current staging state.** |

**VERIFY-560** (after apply #2), all as expected:
- **§1:** holdings_fx_event | t | 0.
- **§2:** the four checkout columns.
- **§3:** trg_holdings_fx_event_append_only.
- **§4:** both shape constraints.
- **§5:** 0 | 0.

**PROBES-560:** 8 PASS, 0 FAIL.
- P1–P2: an opening balance and a conversion are accepted.
- P3: a provider payment needs a counterparty.
- P4: a same-currency conversion is refused.
- P5–P6: update and delete are refused.
- P7: one void per entry.
- P8: currency codes must be ISO.

**Production:** not applied. It needs a separate owner GO. It depends on 399, which is in production. Until 560 is applied, the app reads the ledger fail-soft ("reserve ledger cannot be read"), and fee capture on a paid checkout is skipped with a logged warning, never failing the payment.
