# CKRI 444 — build record (governance enforcement: lawful basis, ethics exemption, partner agreements)

**Staging: APPLIED and verified 2026-10-25 (STAGING-RECORD-444-2026-10-25.md). Production: NOT applied. No production GO exists.** Owner continuation part C, 25 October 2026.

## Application order and dependencies

| # | File | Depends on | Risk (OPS-001 s8) |
|---|---|---|---|
| 444 | `444-ckri-governance-enforcement.sql` | 440, 443 (uses `ckri_keys_present` from 443) | Medium (new trigger functions) |

- **Apply after 443.** Roll back 444 before 443.
- **No frozen function is replaced.** Every rule is a new trigger beside the 440/443 guards. The 442 guard bodies are
  untouched, so Learning 461 is unaffected.

## Checksums (sha256 of the LF file)

See `SHA256SUMS.txt` in the staging package. The same values are recorded at commit.

## Local evidence (disposable Postgres 17 holding the schema-only staging copy, with 440–443 applied)

- **House rules:** 444 and ROLLBACK-444 ALL CLEAR.
- **Applied twice:** CKRI column fingerprint `68dadcaa1081b01a3e822658def9467c` both times. Before 444 it was
  `04964f239598444c56495c7c1f1c2c27`, which equals the coordinator's staging VERIFY-440 value.
- **`scripts/ckri-db/test-444.sql`:** 23/23. Five planted violations each turned it red, then restored green:
  - lawful-basis activation;
  - ethics or exemption before recruitment;
  - no exemption for a study;
  - external appointment needs an agreement;
  - ending the agreement ends access.
- **Earlier suites with 444 present:** 440 31/31, 441 19/19, 442 25/25, 443 24/24. Their fixtures now record a basis
  and an ethics record when 444's columns exist.
- **ROLLBACK-444:** returned exactly to `04964f23…`. The earlier suites stayed green, and reapplying gave `68dadcaa…` again.
- **Harness:** `scripts/ckri-harness.ts` 24/24 (K5-1..4 new), each with a planted red.

## Staging (coordinator)

1. Apply 444. Run VERIFY-444. Apply again, then VERIFY again: the fingerprints must be identical.
2. ROLLBACK-444. The ckri column fingerprint returns to the value before 444. Reapply, then VERIFY.

**Expected on staging:** 0 agreements, and every new column null on existing rows. Staging has 0 CKRI purposes and
projects, so no existing row is affected.
