# FRAMEWORK-DESIGN-STUDIO-02: visual studio gap check

Read against production main 242a9c41 plus merged b98abbc5, 31 Oct 2026.

## Already built (reuse unchanged)

| Requirement | What exists |
|---|---|
| Open any framework and load its hierarchy | HQ Competency Studio explorer: framework → domain → competency → criteria (with sections), searchable, for every shared framework |
| Drag-and-drop reorder plus keyboard alternative | Domains, competencies within a domain, sections, and criteria within a section. Drag, ↑/↓ buttons and screen-reader announcements (#194, live) |
| Draft vs published safety | A draft framework is edited directly. A published framework keeps a **draft layout** that learners never see until an independent publisher releases it (750/752, live) |
| Stable identities and history | uuid ids independent of order, append-only clinical content versions with fingerprints, version snapshots with ids (#194), stable outcome ids for evidence (751) |
| Properties: competency | name, code, description, learning outcomes, expected level (0-6 default scale), risk category, practice/CPU (CFCA) |
| Governance | author → clinical review (independent, scoped) → submit → independent publisher, with self-approval blocked in the database (395/640/751) and major/minor/revision labels |
| Verification methods | Verification Studio (510/511): per-competency methods, outcome codes and evidence rules (no-code) |
| Assessment preview | Review pack (print, Word) including the draft-layout preview |
| Learner-facing preview | Scholar programme/catalogue preview (HQ → Scholar Programmes) |
| Import | Draft-package import (JSON) that continues a draft without touching existing records |
| Profession-agnostic | Nothing nursing-specific in code. Profession, specialty and layer are taxonomy/config |

## Gaps

| # | Gap | Size | Needs your decision? |
|---|---|---|---|
| G1 | **No criteria editing.** Criteria can only arrive by import. There is no add, edit, retire or move on screen | M | No (draft: direct; published: see D2) |
| G2 | **No "Competency Area" level.** The hierarchy is framework → domain → competency. Clinical Practice / Professional Practice has nowhere to live | S-M, migration | **D1** |
| G3 | **No moves between parents.** Competency to another domain or area, criterion to another section: currently refused (your ruling F2) | M | **D3** |
| G4 | **Published frameworks are content-edited live.** Only the order has a draft. There is no editable revision of content | L | **D2** |
| G5 | **Drag-and-drop is mouse-only.** Native HTML5 drag; touch relies on the ↑/↓ buttons | S | No |
| G6 | **Properties panel is spread out.** Competency fields, criteria, rubric and evidence (Verification Studio) and expected level live on separate screens | M | No |
| G7 | **No change comparison.** Nothing shows draft vs the last published version | S-M | No |
| G8 | **No visual competency map view.** The tree only | M | No |
| G9 | **No-code bulk entry.** A spreadsheet template with upload and preview (proposed earlier) | M | No |
| G10 | **No per-cadre expectations.** Expected level is one value per competency | M, migration | Later; not needed for the first slice |

## Your decisions

- **D1. Competency Area level.** Recommended: a small configurable **Area** level above domains (new table `framework_areas`, plus optional `framework_domains.area_id`). It is organisational, outside the clinical content fingerprint, and named per framework (for example Clinical Practice / Professional Practice), so it is no-code and profession-agnostic. Alternative: reuse CFCA "practice" rows, but those sit under domains and carry clinical meaning, so not recommended.
- **D2. Editing a published framework.** Recommended: **revision drafts.** Content changes to a published framework (criteria, wording, moves, new competencies) are held as a pending change set, generalising the layout draft that already works. They are previewed, compared, clinically reviewed and published by an independent publisher, and applied in the publication statement as 752 does. Learners and assessors never see unreleased content. Alternative: keep today's behaviour (published content edited live, approvals go stale); not recommended.
- **D3. Moves between parents.** Recommended:
  - in a **draft** framework, allow moves between parents as ordinary content edits (they already re-trigger clinical review through the fingerprint);
  - in a **published** framework, only through a revision draft (D2);
  - moving a **domain between Areas** is organisational (no clinical re-review).

## Proposed order (each slice is a PR; no slice redesigns what works)

1. **No decisions needed:**
   - G1: criteria editor (draft frameworks)
   - G5: touch drag
   - G6: one properties panel, linking to Verification Studio for evidence and methods
   - G7: compare draft vs last published, from the snapshot
   - G9: template upload with preview, including "add to existing draft"
2. **D1:** the Area level. NUR-CCF gets Clinical Practice and Professional Practice; the existing 30 stay in their domains.
3. **D3:** moves between parents in draft frameworks.
4. **D2:** revision drafts for published frameworks.
5. **G8:** visual map, plus G10 per-cadre expectations if wanted.

**First example:** NUR-CCF, with 30 existing competencies plus the 12 Professional Practice competencies. These arrive through the existing import as draft, never duplicated; that package is being prepared and rehearsed now.
