# Migration 540: staging record (coordinator, 25 Oct 2026)

**Target:** ezhvpgtcqcdsgylrxgdb (staging), guarded runner, file whole. FINGERPRINT-540 and VERIFY-540 ran read-only.

| File (LF, 0 CR) | sha256 |
|---|---|
| 540-individual-passport-share-views.sql | 280fdd87a97c472e82bcfd7c92e18cf994bd4c636ae2ac57e0c12c94723c6c8f |
| ROLLBACK-540.sql | 6e7271aaacc411dccc263b12ac408d222e004c06e243accc7fad2d1533880a5b |
| VERIFY-540.sql | 47684ae31767c16ecbf325c61dc76e4d31ebef7b15b96a3d466e26c57262403d |
| FINGERPRINT-540.sql | 0a1ef0ebd09b8c7ab7716aaba6b2af57478044af82b4073de282e9d93e5975f5 |

**Pre-application record:** `passport_share_tokens` held 4 rows before and after. They are the retired synthetic links; the rollback left them alone.

| Step | FINGERPRINT-540 |
|---|---|
| PRE | 8c6b78937321b638649878355c23c1bb, 17 |
| Apply #1 | 3789460a2feab750a6ecb457bae0a82d, 78 |
| Apply #2 | 3789460a2feab750a6ecb457bae0a82d, 78 (idempotent) |
| ROLLBACK-540 | 8c6b78937321b638649878355c23c1bb, 17 = PRE |
| Re-apply | 3789460a2feab750a6ecb457bae0a82d, 78 = apply #1. **The current staging state.** |

**VERIFY-540,** after apply #2 and again after the re-apply, all as expected:
- **§1:** three tables, each t\|1\|1: share_access, share_record, share_view.
- **§2:** three triggers.
- **§3:** five indexes: cpd_id_user, evidence_id_user, scholar_passport_evaluation_id_user, scholar_passport_item_id_user, passport_share_tokens_id_nurse.
- **§4:** 0.
- **§5:** 0 \| 0.
