# Competency Framework Studio: existing-capability assessment (26 Oct 2026)

Owner directive: "COMPETEN COMPETENCY FRAMEWORKS: CENTRAL GOVERNANCE AND IMPLEMENTATION". Read against main 28095399.

## Canonical Holdings location

**HQ workspace "Competency Frameworks"** (`nav-tables.ts`, key `frameworks`) is the Competency Framework Studio. It needs no new engine.

| Concern | Where it lives | Authority |
|---|---|---|
| Framework identity: code, layer, profession, specialty, extends | `/super-admin/competencies/authoring` | `hq.quality.competency.author` (465) |
| Domains, practices, CPUs, competencies, indicators (learning outcomes), expected proficiency level, risk | same page | same |
| Proficiency scale and levels | `/super-admin/scoring` (CFCA `scoring_scales` / `scoring_levels`) | existing |
| Clinical approval at the exact content version | `/super-admin/clinical-review` (395) | `hq.quality.clinical.approve`, scoped |
| Publication blocked until every competency is approved | DB trigger (466) | not configurable |
| Evidence requirements and assessment methods | `/super-admin/verification-studio` method versions (510): applicability by framework or competency, criteria, required evidence, levels, validity | `hq.competency.verification.manage` |
| Independent verification decisions | `/super-admin/competency-assessment` (510, 511 SoD) | `hq.competency.verification.assess` |
| Controlled catalogues (name competencies, no copies) | `/super-admin/individual/catalogues` (394) | `hq.individual.config.manage` |
| Scholar programmes and mappings | `/super-admin/individual/programmes` (387-391) | `hq.individual.config.manage` |
| Product consumption | Individual policy `scholar_catalogues` / `professional_catalogues`: shared, active, **published** only, empty by default | `hq.individual.config.manage` |

## Already implemented (not rebuilt)

- **Versioning.** Append-only `framework_versions` snapshots. Exact-version clinical approval is 395. Method versions are immutable and hashed (510).
- **Provenance.** Authorship is audited before every write (465). Scholar and Professional AI mappings carry model, prompt version and confidence (388, 390, 393).
- **Interop without merging.** Frameworks, educational programmes (387) and verification methods (510) are separate objects. Formative Scholar study is labelled as such and is never a verification. Only an assigned, scoped, independent assessor verifies (510 triggers).
- **Consumers.**
  - Scholar classifies against its programme catalogue (388).
  - Professional organises evidence (520) and plans against the allowlisted catalogues.
  - Enterprise and Practice use hospital frameworks and layers (384).
- **Configuration, not hard-coding.** Layer, profession and specialty are taxonomy terms. The scale is data, and method content is data.

## Genuine gaps

1. **Publication is not a Holdings authority.**
   - Shared CFCA frameworks still reach `approved` and `published` through the legacy estate routes: `/api/content/review` checks for an educator role, and `/api/content/lifecycle` checks the estate `super_admin` role.
   - No HQ position governs publication.
   - The only SoD check is that the submitter is not the approver. A content author could publish their own framework.
   - Cases (422), knowledge (442) and learning (464) each already have a publish capability. Competency frameworks do not.
2. **The version label never advances.**
   - Republication bumps `version_num` only.
   - Consumers bind to `major.minor.revision` (510 requests, 520 portfolio, 530 evaluations), so every republication still reads "1.0.0".
   - Historical bindings therefore cannot tell published versions apart.
3. **The publication snapshot is thin.** It records names, descriptions and skills only. It has no codes, layer, learning outcomes, expected level, risk, CPU, content hash or approval reference. A version cannot show what was approved.
4. **Republishing a revision takes the framework offline.** The only route back to publication is `in_review`. While it is there, consumers (which read `published` only) lose the catalogue.

Not gaps (deliberately not built):
- an evidence-requirement editor on the authoring page (the Verification Studio owns it);
- per-version pinning of Scholar note mappings (they bind competency ids, which survive revisions);
- scheduled effective dates (publication time is `framework_versions.created_at`, and review is `frameworks.review_date`).

## This PR (gaps 1-4)

- **Migration 580.**
  - Adds `hq.quality.competency.publish`, granted to the existing `quality_council_member` position, as 422 did for cases.
  - Adds the author/publish pair to `hq_capability_exclusions()` (511 list + 1), so no position holds both.
  - Nobody is appointed, and no other grant is made.
  - It is numbered after 511 because it replaces a 511 function. The 465-469 range would be undone on a fresh database.
- **`/super-admin/competencies/publication`**, the Framework Publication page:
  - The author (or the catalogue curator) submits.
  - An independent publisher publishes or returns the framework. The publisher is not the submitter and not anyone who authored or curated its content.
  - Republication names a major, minor or revision change and advances the label.
  - A revision is submitted while the framework stays published, so consumers keep the current version.
  - It shows the Verification Studio methods that apply.
- **Legacy routes** (`/api/content/lifecycle`, `/api/content/review`, the CAP-001 write-back) refuse Holdings-governed frameworks (shared, with a CFCA layer) and point to the Studio. Hospital frameworks are unchanged.
- **The snapshot** records identity, the version label, every hashed competency field, the 395 content hash and the approving version id.

## Minimum actions to commission the first framework (CF-FOUND)

All of these are owner or governance actions. None is code.

1. **Clinical review of CF-FOUND.**
   - Appoint at least one Clinical Content Reviewer, with a 395 scope covering CF-FOUND (Quality Council Member, `/super-admin/clinical-review/governance`).
   - The author submits each of the 8 competencies. Reviewers approve the exact versions.
2. **Production 580 GO** (owner applies), then appoint a Quality Council Member who did not author CF-FOUND as publisher.
3. **Publish.** The author submits CF-FOUND on Framework Publication, and the publisher publishes it. 466 refuses if any competency is not approved.
4. **Offer it** by adding CF-FOUND to `professional_catalogues` and/or `scholar_catalogues` (Individual policy, published config version).
5. **Verification stays off.**
   - It is a separate GO, requiring a Verification Studio Administrator, at least one published method, and assessor appointments and scopes.
   - Until then, nothing CF-FOUND supports is "verified".
