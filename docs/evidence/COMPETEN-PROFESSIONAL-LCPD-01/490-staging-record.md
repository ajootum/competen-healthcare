# Migration 490: staging record (coordinator, 25 Oct 2026)

**Target:** ezhvpgtcqcdsgylrxgdb (staging), with the guarded runner, file whole.
- FINGERPRINT-490 and VERIFY-490 part A ran with the read-only runner.
- VERIFY-490 part B (DO block inside begin…rollback) ran whole with the notice runner.

| File (LF, 0 CR) | sha256 |
|---|---|
| 490-professional-cpd-flexible-recording.sql | 795cd7cb34b60b6a74cd214387c0c68951214e74f7e6f14d1feda31fe5cf7402 |
| ROLLBACK-490.sql | 36cb57b97635b90b9c82ce997cd1ea00c86678bfa42c697c88db712e0daf0b70 |
| VERIFY-490.sql | 94c99b794c94fe7e377514dd26f4943412232c488781b24cfbe0192a52c97d6d |
| FINGERPRINT-490.sql | 25d18f79558186953d89bc74fbd62ea5aa009673f30bdfcf0b2fa9ab66adcc06 |

**Pre-application record:** `individual_professional_cpd` held 0 rows before, after part B and at the end. Staging already had 470 and 480; FINGERPRINT-480 read 1ed4a8ec, 631.

| Step | FINGERPRINT-490 (fp, new_columns, hours_nullable) |
|---|---|
| PRE | 49a769ccd239dd00d4c120ff9606c9a8, 0, NO |
| Apply #1 | 61fc23a3fef56451abed6a230c7f9a4b, 19, YES |
| Apply #2 | 61fc23a3…, 19, YES (idempotent) |
| ROLLBACK-490 | 49a769cc…, 0, NO = PRE. FINGERPRINT-480 unchanged at 1ed4a8ec, 631. |
| Re-apply | 61fc23a3…, 19, YES = apply #1. **The current staging state.** |

**VERIFY-490:**
- **Part A** (after apply #2 and after the re-apply): 6/6 true.
  - Hours are optional.
  - Credits take a decimal.
  - History table: RLS on, own-row read only.
  - Setting table: RLS on, own-row read only.
  - No scope column on the new tables.
  - Both triggers are present.
- **Part B:** 10/10 PASS. 0 rows were left behind.
