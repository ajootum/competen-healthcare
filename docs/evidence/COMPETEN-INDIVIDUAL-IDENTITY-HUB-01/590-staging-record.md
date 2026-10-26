# Migration 590: staging record (coordinator, 26 Oct 2026)

**Target:** ezhvpgtcqcdsgylrxgdb (staging). The guarded runner ran each file whole. FINGERPRINT-590 (rev 2) and VERIFY-590 ran read-only. The storage step ran through the Storage API with `rollback-590-storage.ts` (a staging-only guard).

| File (LF, 0 CR) | sha256 (first 8) |
|---|---|
| 590-individual-identity-hub.sql | f618372c |
| ROLLBACK-590.sql (rev 2, no storage SQL) | deb88ac1 |
| rollback-590-storage.ts | e0c97790 |
| VERIFY-590.sql | abc86646 |
| FINGERPRINT-590.sql (rev 2, excludes the bucket) | 91074066 |

## Sequence
1. **PRE:** avatars public=true, no individual-photos bucket, no identity table.
2. **Apply #1 and apply #2:** identical (by the rev-1 fingerprint, 32006efc/29). VERIFY as expected.
3. **First rollback attempt (rev 1):** refused by Supabase with "Direct deletion from storage tables is not allowed". The transaction rolled back and nothing changed. That led to rev 2.

**Rev-2 rehearsal:**

| Step | FINGERPRINT-590 rev 2 |
|---|---|
| A, applied | 62b0651aec7b374fc1d5a11e3866dca0, 28 |
| ROLLBACK-590 (SQL) | 12f8648bb6c7575446fda0a81a6aed51, 11 = PRE. The identity table is gone. The bucket remains private (by design). |
| Storage step | `--check`: public=false, objects=0. The step then emptied and deleted the bucket. `--check` again: not present. **The full pre-state is restored** (avatars public=true, no bucket, no table). |
| Re-apply #1 | 62b0651aec7b374fc1d5a11e3866dca0, 28 = A |
| Re-apply #2 | 62b0651aec7b374fc1d5a11e3866dca0, 28 = A (idempotent, including recreating the bucket) |

## VERIFY-590 after re-apply
All as expected:
- **§1:** individual_identity_profile | t | 1 | 1.
- **§2:** the two constraints (lengths, photo).
- **§3:** f | 5242880 | 3 (a private, 5 MB bucket with 3 types).
- **§4:** 1.
- **§5:** boolean | NO | false.
- **§6:** 0.

**The current staging state** is 590 applied (A), with the private bucket present.

## Production
Not applied. It needs a separate owner GO. The production rollback is the SQL file, then the storage step, run by the owner, or the bucket removed in the dashboard.
