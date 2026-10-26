# Migration 580: staging record (coordinator, 26 Oct 2026)

**Target:** ezhvpgtcqcdsgylrxgdb (staging), guarded runner, file whole. FINGERPRINT-580 and VERIFY-580 part A ran read-only. Part B ran as the coordinator's self-rolling-back probe `VERIFY-580-B-probe.sql`: the same insert as part B, inside a DO block that ends by raising.

| File (LF, 0 CR) | sha256 (first 8) |
|---|---|
| 580-competency-framework-publication-authority.sql | b9ed30b1 |
| ROLLBACK-580.sql | 3d94e078 |
| VERIFY-580.sql | 890b12f2 |
| FINGERPRINT-580.sql | 6d3bd49a |

| Step | FINGERPRINT-580 (fingerprint, items, exclusion pairs) |
|---|---|
| PRE | 585ad1d347e99851b65fded72c7b0353, 0, 14 |
| Apply #1 | d412f2271b9c7c0aa9dea8f006f3568e, 2, 15 |
| Apply #2 | d412f2271b9c7c0aa9dea8f006f3568e, 2, 15 (idempotent) |
| After probe B | d412f2271b9c7c0aa9dea8f006f3568e, 2, 15 (probe left nothing) |
| ROLLBACK-580 | 585ad1d347e99851b65fded72c7b0353, 0, 14 = PRE |
| Re-apply | d412f2271b9c7c0aa9dea8f006f3568e, 2, 15 = apply #1. **The current staging state.** |

**VERIFY part A** after apply #2:
- **A1:** `quality_council_member | hq.quality.competency.publish`, the only live grant.
- **A2:** 15 pairs, and the author/publish pair present: 1.
- **A3:** 0 violations.
- **After rollback:** 14 pairs, the pair absent, 0 violations.

**VERIFY part B:** PASS. The grant was refused with "separation_of_duties: competency_author already holds hq.quality.competency.author, and a competency author cannot publish competency frameworks". Then the rollback.

**Production:** not applied. It needs a separate owner GO, after 511.
