# FRAMEWORK-DESIGN-STUDIO-02: STATUS

**Owner GO:** 31 Oct 2026. D1, D2 and D3 are approved, D3 with a refinement. Gap analysis: GAPS.md in this folder.

**Branches** (both based on main b98abbc5):
- `hq/framework-studio-02a`, worktree competen-fds2a: S1 and S2.
- `hq/framework-studio-02b`, worktree competen-fds2b: S3 and S4.

S5 and S6 (revision drafts) come after these merge.

**Production:** deploy and migration application each need a separate owner GO. Migrations are applied by the owner.

## Owner rulings (binding)

### D1: Area level
- A configurable Area level sits above domains. It is organisational, not a separate framework.
- Every framework, for any profession, defines its own Areas: no-code, profession-agnostic.
- For NUR-CCF: Clinical Practice (the existing 13 domains and 30 competencies) and Professional Practice (the new domain with PP-01..PP-12).
- Preserve every framework, domain, competency and criterion id.

### D2: Published framework revisions
- Editable revision drafts for published frameworks. Changes stay invisible to learners and assessors until independently approved and released.
- Use the existing governance for preview, version comparison, review, approval and publication.
- Preserve published versions, historical evidence, assessments and Passport records.

### D3: Moves between parents, with the refinement
- Authorised users may move domains, competencies, sections and criteria between compatible parents, by drag and drop or an accessible alternative.
- **Organisational changes** move or reorder without changing meaning, scope, criteria, assessment requirements or applicability, and need no repeat clinical review:
  - a domain to another Area;
  - a competency to another domain;
  - reorder anything.

  These are already outside the clinical content fingerprint, except where noted.
- **Substantive changes** affect clinical meaning, expectations, assessment context, evidence or scope, and go through review:
  - criterion text;
  - a criterion to another section (its component is inside the fingerprint);
  - a criterion to another competency;
  - outcomes and their order;
  - any field inside the fingerprint.
- **Published frameworks:** all changes go through revision drafts and independent publication. Organisational changes go through the existing layout draft, extended. Substantive changes go through D2 revision drafts.
- Full audit for both kinds. Earlier rulings still apply: F4 (`reorder_layout` is not authorship for clinical review), 751 stable outcome ids, and 752 atomic apply at publication.

### Remaining capabilities
1. Create, edit and retire criteria on screen.
2. Touch drag and drop plus keyboard alternatives.
3. A unified properties panel.
4. Draft versus published comparison.
5. Spreadsheet import with validation and preview.
6. A visual framework map.
7. Full editing of existing frameworks without reimporting.

Reuse the existing infrastructure. No-code first. No parallel systems. Testing proportionate and limited to what changed.

### NUR-CCF
- The existing 30 stay unchanged.
- The 12 PP competencies arrive through the prepared package (RELEASE-2026-10-25/NUR-CCF-PP) after the owner adds two Assessment Components: `demonstrated_professional_practice` and `application_judgement`.
- Criteria labels must come from the component registry, not hard-coded letters (StudioWorkspace.tsx:292, review-pack.ts:38).

## Token rules
- Targeted vitest only. Relevant harness once. tsc once (`NODE_OPTIONS=--max-old-space-size=8192`).
- No full suites and no re-runs.

## Slices

| Slice | Scope | State |
|---|---|---|
| S1 | Server (a): criteria CRUD on drafts; append-mode import; spreadsheet template and parser into a package; draft vs published diff | pending |
| S2 | UI (a): properties panel, criteria editor, touch drag helper, registry labels, compare view, spreadsheet import page | pending |
| S3 | Server (b): migration 760 Areas; layout draft extension for organisational cross-parent moves; substantive moves in drafts | pending |
| S4 | UI (b): Areas in the tree, cross-parent drag, visual framework map | pending |
| S5/S6 | D2 revision drafts, server (770) and UI | pending |

## Log
