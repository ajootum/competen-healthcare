# Migration 422 (clinical cases on clinical approval): staging record

**Authority:**
- Owner GOs COMPETEN-HOLDINGS-AI-CONSUMPTION-01 and COMPETEN-SCHOLAR-CLINICAL-REASONING-01, plus the Stage 5 case interface approval s3: "Extend the existing Holdings clinical-approval process to support case content. Do not build a separate approval engine".
- Coordinator range 421 to 424 and 430 to 434.

**Who and where:** the main session applied 422 on 24 October 2026 from the cfca worktree (branch `holdings/case-intelligence`) with the guarded runner. The target was ezhvpgtcqcdsgylrxgdb in every step, the guard passed, and every run reported "ok".

**OPS-001 s8 tier:** Medium. 422 replaces 395's two guard functions, so the rollback was rehearsed.

**Fingerprint tools** (read-only):
- `npx tsx scripts/ind007-staging-schema-check.ts --cases422`
- `npx tsx scripts/ind007-staging-schema-check.ts --clinical395`

| Step | `--cases422` | `--clinical395` |
|---|---|---|
| PRE | f44f815b… | 87dda360… |
| Apply ×2 | ok. F1 = 6e69086a… | |
| Rollback (ROLLBACK-422.sql, 4c820d65, committed; no cases were present) | F2 = f44f815b… = PRE | 87dda360… = PRE (395's guards restored exactly) |
| Re-apply ×2 | ok. F3 = 6e69086a… = F1 | |

**Files** (bytes matched before and after the runs):
- 422-clinical-cases-on-clinical-approval.sql: sha256 48cbffbbdae4b09ea4bda5b4edab6f2385dd631968e9337df5d61b720610b49c. House rules ALL CLEAR (498 lines, 193 statements, 3 constraints, 15 non-blocking warnings).
- ROLLBACK-422.sql: sha256 4c820d65efa07fc5c8e32d19253b516e299c5ca2fecceaa3c464f0182128aed0. It restores 395's version guard and decision guard byte for byte, and refuses once any case, case clinical version or educator appointment exists.

**What 422 does:**
- `clinical_content_version` gains `content_kind` (competency or case) and `case_version_id`, with exactly one subject enforced by a CHECK. Every existing row is a competency row.
- 395's guards keep their competency branch unchanged. They add a case branch with:
  - the case version's database hash;
  - scope over EVERY competency the case teaches;
  - case-hash staleness.

  Independence, append-only decisions and counts are the same code.
- The case library holds the content and its own lifecycle: draft, submitted, published, superseded, retired. Content is frozen from submission.
  - `case_library_submit` puts a case forward through 395.
  - `case_library_publish` requires an approved 395 version whose hash is the exact case version's.
  - `case_library_deliverable` requires both publication and approval.
- Capabilities and positions:
  - `hq.quality.case.author` goes to the new position `clinical_case_educator`, with home.view;
  - `hq.quality.case.publish` goes to `quality_council_member`.
  - Nobody is appointed.

**Proven locally** (Postgres 17, on stubs plus the real 395), `t422.sql`, sha256 321984388613b213…, W1 to W8 all PASS, re-run on a fresh database at commit:
- **W1:** the competency path is 395's, unchanged: hash, approval and staleness.
- **W2:** a draft is editable. Submitting needs competency links and an author, and puts the case forward through 395 with the exact hash.
- **W3:** a case is frozen from submission. A version has one subject only, and an unsubmitted case cannot be reviewed.
- **W4:** for a case, independence, scope over every competency, and authority all hold.
- **W5:** the approval count holds, approval is separate from publication, delivery needs both, and publishing a new version supersedes the old one.
- **W6:** a rejected revision is not approved and not publishable. An approved revision supersedes the published one.
- **W7:** a case that is published but not approved for its exact version is never deliverable. This is the delivery red.
- **W8:** retirement works, and grants are as intended.

**Proven on staging after application** (24 October 2026, target ezhvpgtcqcdsgylrxgdb):
- **The competency path against the real triggers:** `clinical-review-acceptance-harness`, 16/16 ALL GREEN. This covers hash, independence, authority, scope, staleness, counts, append-only decisions, the catalogue read and fixture removal.
- **The HQ capability catalogue:** `hq-guard-harness`, 70/70 ALL GREEN. The DDL and code have the same 60 capabilities (D1, D2), the S4 parser reads 10 positions and 92 grants, and every position reaches the HQ home (D6).
- **The eight CF-FOUND versions** are unaffected, read-only:
  - each is In clinical review, a competency version, and its hash is current;
  - each needs 1 approval and has 0 decisions;
  - no reviewer is appointed.

  They remain decidable by a scoped reviewer.

**Frozen.** Further changes are fix-forward.

**Dependencies:** 395 (clinical content approval) and the HQ capability tables. 422 is independent of the AI ledger migrations (410 to 412, 419 to 421).

**Application order:** 395, then 422.

**Not dependent on the case blueprint contract.** The content is stored and hashed whole, so case-blueprint/1 (under review) can change without touching 422.

**Production:** not applied, not authorised. It needs its own GO, and the legal review of publishing student-derived cases is a production dependency. Code that uses 422 stays behind a server gate that defaults OFF and fails closed while 422 is absent.
