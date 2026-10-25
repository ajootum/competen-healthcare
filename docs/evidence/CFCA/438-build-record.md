# Migration 438 and CFCA production authoring (build record)

**Owner:** "COMPETEN CFCA — PRODUCTION AUTHORING AND GOVERNANCE DIRECTION" (25 October 2026). Production is the authoritative environment for CFCA content. Curators author and refine CF-FOUND directly there:

Draft → Submit for Review → Clinical Approval → Publication.

**State of 438:**
- **Authored.** Not committed until staging ×2.
- **Production:** only with its own owner GO, applied by the owner.

## The focused check: what production already supports, and what was missing

| Step | Before this change | Now |
|---|---|---|
| **Author** a shared framework, domains and competencies with every field the 395 hash covers | ❌ **Missing.** No app route writes `learning_outcomes`, `expected_level_id`, or a framework `code`/`competency_layer`. The master library is estate `super_admin` only (`/api/content/*`), with name and description only. There is no HQ author right for competencies (cases have 422, knowledge 442, learning 464). | `/super-admin/competencies/authoring` and `/api/hq/competency/authoring`, gated by **`hq.quality.competency.author`** (migration 438, position `competency_curator`). |
| **Submit for review** | ✅ Exists: `/api/hq/individual/catalogues {review}` (Individual Product Administrator). It needs the competency in a catalogue. | Also from the authoring page (`submit_review`). The curator is the submitter and an author. |
| **Clinical approval** of the exact content version | ✅ 395, unchanged. It requires a Clinical Content Reviewer appointment with a scope, independent of authors and submitter. | Unchanged. |
| **Publication** | ✅ The governed framework lifecycle, unchanged. Estate `super_admin`, with independent governance approval of the submission (`content_approvals`). | Unchanged. Not part of this change. |
| **A new draft revision of published content, without overwriting approved versions** | ✅ Approved content is an append-only 395 snapshot. A published framework is an append-only `framework_versions` snapshot. An edit after approval reads "Changed since its clinical approval" until it is re-approved. | Same. Authoring refuses edits while a framework is `in_review` or `approved` (what its approver is looking at). |

**One caveat for the owner:** a revision of a **published** framework is edited in place. Consumers read the live rows, so they see the revised text at once, labelled "Changed since its clinical approval", never as approved. Isolating draft revisions from readers would mean per-competency revisions or readers taking the published snapshot. That is an architecture decision, not made here.

## What 438 adds

- **`hq.quality.competency.author`.** Author, edit and put forward shared CFCA competencies for independent clinical review. It approves and publishes nothing.
- **Position `competency_curator`** ("CFCA Competency Curator"). It holds that right and `hq.platform.home.view`. Appointments use the existing HQ workflow.
- **Additive.** Nothing else changes. Re-running is a no-op. The rollback is `ROLLBACK-438.sql`.

## The code (no SQL for ordinary content changes)

- **`src/lib/competency/authoring.ts`:**
  - Shared frameworks only (`hospital_id` null, scope master). Hospital frameworks stay with `/api/studio/authoring`.
  - The authorship audit row is written before every write, and a failed row refuses the write. 395's `authorsOf` therefore always sees the curator as an author.
  - It refuses edits under governance review and on archived frameworks.
  - It refuses a competency code another shared competency holds.
  - **A draft package import:** one governed act creates a framework, its domains and competencies as a **DRAFT, not clinically reviewed**.
    - It puts nothing forward, approves nothing and publishes nothing.
    - The expected level travels as a score on the default scale.
    - Provenance goes in the authorship row, not in the content.
- **`/super-admin/competencies/authoring`:** every competency's clinical state in words, edit forms for all hashed fields, and "Put forward for clinical review".
- **`spaces.ts`:** the capability, and the route intent ahead of `/super-admin/competencies`.
- **`nav-tables.ts`:** the nav entry.

**Without 438 applied:** no position holds the capability, so only a platform owner passes the gate (break-glass). It is closed to everyone else.

## CF-FOUND package

**File:** `docs/evidence/CFCA/cf-found-draft-package.json`. It was read from staging read-only on 25 October 2026.

**Content:**
- **Framework:** `CF-FOUND`, "Competen Foundational", foundational layer.
- **Domains (4):** Clinical reasoning, Patient safety, Communication, Infection prevention basics.
- **Competencies (8):** CF-CR-001/002, CF-PS-001/002, CF-CM-001/002, CF-IP-001/002.
  - Names, descriptions and learning outcomes are byte-for-byte from staging.
  - Risk is standard.
  - The expected level is Benner score 3.

**Changes made on purpose:**
- **Description:** "Cross-professional foundational competencies." The staging text ends "COMPETEN-SCHOLAR-01 S1 staging seed". That wording is dropped from the content and kept in provenance.
- **State:** carried as DRAFT. On staging the framework is `published` (version 1), but no competency is clinically approved: 8 versions were put forward, with 0 decisions. Neither the publication nor any approval is imported.
- **Identifiers:** codes are preserved. Staging UUIDs and staging content hashes are recorded in provenance only, because ids differ between environments and 395 hashes ids.

**How it gets into production:** studio entry, no SQL. A curator, or a platform owner, pastes the package into "Import an existing framework as a draft". No production data seed and no data GO are needed.

## Migration 430 (#86): leave it deferred

430 adds a portable content hash and owner-run import of reviewed copies. It exists only to carry a staging approval into production. Under the owner's direction, authoring and clinical review happen in production on production content, and the 395 id-based hash is correct within one environment. Provenance for imported content is in the authorship row.

**No reusable part is needed now. Leave #86 unmerged and unapplied.**
