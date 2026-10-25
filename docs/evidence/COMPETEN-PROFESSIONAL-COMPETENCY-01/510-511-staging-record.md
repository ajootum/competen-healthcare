# Migrations 510 + 511: staging record (coordinator, 25 Oct 2026)

**Target:** ezhvpgtcqcdsgylrxgdb (staging), with the guarded runner, each file applied whole.
- FINGERPRINT-510 and VERIFY-510 part A ran with the read-only runner.
- Parts B, C and D (DO blocks inside begin…rollback) ran whole with the notice runner.

| File (LF, 0 CR) | sha256 (prefix) |
|---|---|
| 510-competency-verification-studio.sql | f9af70d8 (full: f9af70d812d00abb4f3750194e72430da634730e0e83ab450209db015dc0cd8e) |
| 511-competency-assessor-separation-of-duties.sql | a85d704b (full: a85d704b2ca18b21b6200d1e1cf0a34ee16bb1a2bdc990f65a3e529ca2415f11) |
| VERIFY-510.sql | e7affe9a (full: e7affe9a8b67bdbb743250db29eb4a2bbfe96961ded7224c9c3af73051b623b9) |
| FINGERPRINT-510.sql | 262b9456 |
| ROLLBACK-510.sql | 47274e9a |
| ROLLBACK-511.sql | 19025118 |

## Earlier attempt (superseded)
- **What ran:** 510 `222e2065…`, applied ×2 with 511.
  - Structure: fee831c1.
  - VERIFY B: 9 PASS, 2 FAIL, then "column f.version does not exist".
- **Cause:** `frameworks` has no `version` column on staging or production.
- **Outcome:** rolled back to PRE a9a18a96. Those bytes are never to be committed.

## This run (fixed 510)

| Step | FINGERPRINT-510 (fp, cols, cons, idx, trg, pol, fns, authority rows, exclusion pairs) | HQ all-rows md5 |
|---|---|---|
| PRE | a9a18a96, 0, 0, 0, 0, 0, 2, 0, 10 | 31236bc3…, n=205 |
| 510 + 511 #1 | a823ff9b, 89, 48, 18, 7, 4, 16, 8, 14 | — |
| 510 + 511 #2 | a823ff9b (idempotent) | — |
| ROLLBACK-511, then ROLLBACK-510 | a9a18a96 = PRE | 31236bc3…, n=205 = PRE |
| Re-apply. **The current staging state.** | a823ff9b | 6b9bab2e…, n=213 |

**VERIFY-510:**
- **Part A** (after #2 and after the re-apply): 7/7 t.
  - Seven tables have RLS on, with own-row read only on the four person tables.
  - The two capabilities exist and are held only by the two new positions. Nobody is appointed.
  - 511: assess is excluded from approval, govern, authoring and the Studio, and both rights are clinical-sensitive.
  - There is no scope or tenant column on the person tables.
- **Parts B, C, D:** **41 PASS, 0 FAIL, 0 errors**, plus 1 SKIP. The skip is "Scholar evidence: no Scholar Passport item on this environment", as designed.
