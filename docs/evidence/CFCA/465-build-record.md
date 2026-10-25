# Competency Studio: migrations 465 and 466 (build record)

**Owner direction:** "COMPETEN CFCA — COMPLETE PRODUCTION AUTHORING CAPABILITY" (25 October 2026), following "PRODUCTION AUTHORING AND GOVERNANCE DIRECTION". Production is the authoritative CFCA content environment:

Draft → Submit for Review → Clinical Approval → Publication.

**Numbers:** the coordinator reserved 465–469 for the Competency Studio (430 is held, 470–479 belong to Professional Stage 2). 465 was first authored as 438, then renumbered before any application.

**State:**
- **Authored.** Proven locally on PG17.
- **Next:** staging ×2 by the coordinator.
- **Production:** each migration needs its own owner GO, applied by the owner.

## The owner's ten requirements, and where each is met

| # | Requirement | Where |
|---|---|---|
| 1 | Reuse the existing CFCA, catalogue, authority and clinical-approval infrastructure | Shared frameworks, domains, competencies (011, 384), catalogues (394), HQ positions (264), 395 approval: all unchanged and reused |
| 2 | A dedicated Competency Author capability, assignable through position governance | **465:** `hq.quality.competency.author` on a new position `competency_author`. Appointments use the existing HQ screen. |
| 3 | No-code authoring of catalogue identity, code, layer, domain, CPU, competencies, outcomes, expected levels | `/super-admin/competencies/authoring` and `/api/hq/competency/authoring` |
| 4 | Draft creation, editing, revision, historical version preservation | Drafts are created and edited here. Approved content is an append-only 395 snapshot. Published frameworks are append-only `framework_versions`. |
| 5 | Author without clinical approval, but require the independent clinical review before governed publication | Authoring needs no approval. **466** refuses publication unless every owned competency is approved at its current content. |
| 6 | Preserve exact-version approval, and authors never approve their own content | 395 unchanged. Authorship is audited before every write, so `authorsOf` always names the author. |
| 7 | Foundational, profession-specific and specialty through configuration | Layer, profession term, specialty term and parent framework are set as identity (draft only). |
| 8 | No staging-to-production imports for routine development | Authoring happens in production. The draft-package import is for bringing existing content in once (CF-FOUND), not a process. |
| 9 | No authority granted automatically to existing positions | 465 grants only to the new position, and appoints nobody (VERIFY-465). |
| 10 | Keep 430 held | Held: nothing here needs a portable hash. |

## 465: the Competency Author capability

**What it adds:**
- capability `hq.quality.competency.author`;
- position `competency_author` ("Competency Author"), holding that capability and `hq.platform.home.view`.

**Properties:**
- No other grant. It appoints nobody.
- Additive, no plpgsql, re-runnable.

**Files:** rollback `ROLLBACK-465.sql`, verify `VERIFY-465.sql` (read-only).

## 466: publication requires exact-version independent clinical approval

**What it adds:**
- **`competency_clinically_approved(id)`:** the 422 `case_library_approved` predicate, for a competency at its current `competency_content_hash`. It needs the required approvals and no rejection.
- **Trigger `cfca_framework_publication_guard`:** before insert, or update of `pub_status`, on `frameworks`. A shared framework with a CFCA layer that owns competencies becomes `published` only when every one of them is approved at its current content.

**Not affected:**
- review and governance-approval states;
- hospital frameworks;
- shared frameworks with no layer (the existing library);
- 394 catalogues, which own no competencies (SCH-RESPCARD keeps its 394 rules);
- rows already published. The guard acts on the act of publishing. On staging, CF-FOUND and NUR-RESP are published with no approvals: they stay as they are, but any republication now needs the approvals.

**Files:**
- APPLY WHOLE (one plpgsql function);
- rollback `ROLLBACK-466.sql`;
- verify `VERIFY-466.sql`: part A read-only, part B behaviour in a transaction that ends in ROLLBACK.

**Order and dependencies:**
- 465 and 466 are independent of each other.
- 466 depends on 395, 422 and 384, which are all in production.
- Fingerprints: `FINGERPRINT-465-466.sql`, run at PRE, after each apply, after rollback, and after re-apply.

## What changed in the code

- **`src/lib/competency/authoring.ts`:**
  - shared frameworks only;
  - the authorship audit row before every write (a failed row refuses it);
  - no edits under governance review or on archived frameworks;
  - identity (code, layer, profession, specialty, parent) only while a draft;
  - domains with codes;
  - practices and CPUs (code, risk, complexity, reassessment);
  - competencies with every hashed field, and a CPU of their own framework;
  - draft-package import;
  - submit for review (395).
- **`/api/hq/competency/authoring`:** gated on `hq.quality.competency.author` only. It has no publish or approve action.
- **`/super-admin/competencies/authoring`:** the page, showing every competency's clinical state in words.
- **`framework-lifecycle.ts`:** a publication 466 refuses is returned as 409, explained in words.
- **`spaces.ts`:** the capability, and the route intent ahead of `/super-admin/competencies`.
- **`nav-tables.ts`:** the nav entry.

## What was proven, and only that

| Claim | Proof |
|---|---|
| The new capability is granted to no existing position | VERIFY-465 (local: all true). Unit test on the 465 grants. Plant S3 is red. |
| An author cannot approve their own version | 395 unchanged (existing evidence). Authorship is recorded first, and the unit test shows `authorsOf` naming the author. Plants A1, A2 and S5 are red. |
| Authoring needs no approval | Unit tests create and edit with no review rows. VERIFY-466 B1. |
| Publication requires the exact-version independent approval | **Local, against the real 395 hash function:** submitted-not-approved is refused; one approval of the exact content allows publication; an approval with a rejection does not count. VERIFY-466 B2 (refused), B4–B5 (catalogue and unlayered unaffected). |
| A revision of published content preserves the approved version | **Local:** after publication, an edit leaves the approved version row and its hash unchanged, the predicate turns false, and republication is refused "1 of 1". |

**Test totals:**
- authoring.test.ts: 17/17.
- Plants: 14, all red (A1–A9, S1–S5).
- src/lib competency, hq, individual and cases: 613/613.
- Harnesses: plane-boundary 35/35, sidebar-active 15/15, individual-foundation 74/74, individual-config 41/41, competency-foundation 33/33.
- tsc and eslint clean.
- hq-guard B1 (applied capability catalogue = code) is red on an environment until 465 is applied there.

## CF-FOUND

`cf-found-draft-package.json`:
- 8 competencies and 4 domains, codes preserved;
- DRAFT, not clinically reviewed;
- the staging-seed wording is removed from the description;
- staging ids and hashes are kept in provenance only.

Entered through the studio's "Import as draft". No production SQL.
