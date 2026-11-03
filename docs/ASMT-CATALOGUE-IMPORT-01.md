# ASMT-CATALOGUE-IMPORT-01 — Assessment & Checklist Catalogue: flexible registration, instrument import and domain classification

Implementation note for the owner specification of 3 Nov 2026 ("COMPETEN HOLDINGS — Assessment & Checklist Catalogue — Flexible Registration, Instrument Import and Domain Classification", sections 1–14). It records what was built, where each requirement lives, what was deliberately not built, and the decisions left to the owner. The specification is the contract; this note is the map.

## What exists after this change

**Register instrument** on the catalogue landing opens a chooser with three ways in (`RegisterChooser.tsx`):

1. **Create new** — the existing lightweight identity form (`RegisterDialog.tsx`), now with the hierarchical classification fields below.
2. **Import existing instrument** — the guided import (`ImportWizard.tsx`, `ImportCorrect.tsx`): Upload → Extract → Preview and group → Correct → Register Drafts → Open in Checklist Studio.
3. **Create from template** — a new identity whose first Draft copies a published instrument's content, settings, scoring, layouts and tags (`TemplateDialog.tsx`, `src/lib/assessment/catalogue/template.ts`), with an `adapted_from` relation and a `catalogue_from_template` event as the provenance link.

All three end in the same place: an ordinary `asmt_instrument` with (for 2 and 3) an ordinary Draft `asmt_instrument_version`, edited in the existing Checklist Studio and governed by the 890 lifecycle guard. There is no second editor and no parallel instrument model.

### The deterministic parser (`src/lib/assessment/import/`)

| File | Role |
|---|---|
| `grid.ts` | the workbook as grids (xlsx, server only), merged ranges filled with their anchor value, every cell remembering its origin |
| `detect.ts` | pure detection of one sheet: identifiers, rating scale block, header row, column roles, sections, subsections, items, sub-points, unplaced text, flags |
| `workbook.ts` | the whole workbook as a draft: a proposed group per instrument-like sheet, every other sheet proposed for exclusion with its reason, family suggestion only on a unique word match, readiness problems |
| `to-content.ts` | a confirmed group as Studio `EditorContent` plus a scale plan and a summary |
| `store.ts` | server: upload to the private `asmt-imports` bucket, the `asmt_import` record, corrections merge, registration through the existing Studio writers |
| `provenance.ts` | the one read the catalogue drawer makes (file name, digest, status) |
| `detect.test.ts`, `store.test.ts` | vitest over the acceptance workbook (`__fixtures__/nursing-assessment-audits.xlsx`) |

No AI is involved. Every rule is readable in `detect.ts`; where a rule would have to guess, it records a flag (`title_from_sheet_name`, `scale_levels_unlabeled`, `partial_option`, `unknown_column`, `signoff_column`, `identifiers`, `unplaced_text`, `record_log`, ...) and the person decides in Preview or Correct. Nothing is discarded: cells that cannot be placed are listed as unplaced text and kept on the import record, sign-off and ignored columns are named in the instrument summary, and the workbook itself is stored unchanged with its sha256.

### How the three instrument structures are expressed (section on preserving structures)

| Workbook | Primary response | Secondary fields | Scale |
|---|---|---|---|
| Nursing Assessment Audit (achievement scale 0–6, NA, evidence) | `rating_scale` on an imported draft scale, `allowedStates: [not_applicable]` | `evidence_comments` free text | 7 levels with the workbook's values, competence-level names and descriptions; `satisfactory` left unset |
| Concurrent Nursing Audit (documented vs observed, match, discrepancy) | `multiple_choice` Yes / No / Partial (Partial carries no pass/fail meaning) | `documented_finding`, `observed_finding`, `discrepancy_action` | none |
| Retrospective Chart Audit (compliance, deficiency) | `multiple_choice` Yes / No / Partial | `evidence_comments` | none |

No new response type, field kind or vocabulary was needed: the existing item, item field and scale builders express all three. Scoring rules are not invented: the imported draft has none until the author builds them in the Studio's rules builder (validation says so before submission).

### Classification (hierarchical, configurable)

- `ClassificationFields.tsx` is the one component every path uses (create new, import, template, drawer edit): primary domain + subdomain (parent/child terms), method, then behind **More classification**: related domains and topics, profession, specialty, clinical context / setting, population, qualification applicability (level), purpose, keywords and any further axis an administrator adds. Every picker is searchable (`TermPicker`) and sized for a tablet.
- Migration 930 adds the `profession` and `purpose` axes as rows, seeds `Clinical Nursing Skills` with seven example subdomains as ordinary terms (`parent_id`), and makes the search match a domain, its parent or its grandparent.
- `terms/TermsAdmin.tsx` shows each axis as a tree, lets an administrator add a subterm, move a term under another parent, relabel or hide it, and switch an axis between flat and hierarchical. Term ids never change, so relabelling or moving changes nothing an instrument carries.
- Catalogue taxonomy stays separate from competency-framework domains. Criteria map to approved competencies through the existing `asmt_mapping` in the Studio; a quality or compliance audit needs no mapping.

### Governance

Unchanged. An import or a template copy produces a Draft authored by the actor; review, approval, publication, the SoD rules (no self-approval, no self-publication) and versioning are the 890 guard's. An imported scale is a Draft scale that must be published before the instrument can be put forward. Registering content needs the Studio author capability held through an appointment (the routes refuse otherwise and keep the upload and its corrections for an author to register).

## Migration 930

`supabase/migrations/930-asmt-catalogue-import-and-hierarchy.sql` — applied twice on staging, rollback rehearsed, re-applied; build record, VERIFY and ROLLBACK in `RELEASE-2026-10-25/PENDING-41`. Production untouched. The import screens refuse with a plain message while the table or bucket is absent.

## Deliberately not built

- AI-assisted extraction or suggestion. The specification makes AI optional and reviewable; deterministic parsing covers the acceptance workbook and the design leaves room for a reviewable suggestion layer later (the draft already carries flags per sheet).
- Mapping of an imported scale to the Competen staging (DACUM / Benner) scale. The scale is imported as found; any mapping is an explicit, reviewed step in the Studio (owner decision below).
- Importing the record sheet ("Daily Audits") as anything. It is proposed for exclusion; the person can still say it is an instrument or part of one (owner decision below).
- Dimension creation from the terms screen (only hierarchy switch, terms and subterms). An axis is still a migration row.

## Open owner decisions

1. **The `Daily Audits` sheet**: leave it out (the default proposal), import it as a fourth instrument, or treat it as a record log outside the catalogue?
2. **Imported scales**: should the import offer a reviewed mapping from an imported achievement scale (0–6 with competence levels) to the Competen staging scale, or stay as imported with mapping done case by case in the Studio?
3. **Seeded subdomains**: keep the seven example subdomains of Clinical Nursing Skills as seeded, or replace with the owner's own list through Terms before production?
4. **Who registers imports**: the catalogue manager position does not hold Checklist authoring. Should it, or does an author always register (current behaviour)?
