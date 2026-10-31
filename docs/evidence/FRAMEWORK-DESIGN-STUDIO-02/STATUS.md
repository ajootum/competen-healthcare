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

### 31 Oct 2026, S1 server (branch hq/framework-studio-02a): built, unpushed. No migration.

**API contract for S2.** All on `hq.quality.competency.author`. Errors are `{ error }` with 400/404/409/422/503. Every write except an organisational reorder records its authorship row first (`cfca_criterion_*`, on the competency), which counts as authorship for clinical review.

`POST /api/hq/competency/authoring`. Criteria actions work in **draft** frameworks only. Anything else returns 409 "...Changes to a published framework go through a revision draft."

| action | body | 2xx response |
|---|---|---|
| `create_criterion` | `{ competencyId, component, text, sourceRef?, position? }` | 201 `{ ok, id }` |
| `update_criterion` | `{ criterionId, text?, sourceRef? }` | `{ ok, unchanged }` |
| `retire_criterion` | `{ criterionId }` | `{ ok, unchanged }` |
| `restore_criterion` | `{ criterionId }` | `{ ok, unchanged }` |
| `move_criterion` | `{ criterionId, component?, competencyId?, position? }` | `{ ok, kind, substantive, mode?, unchanged? }` |
| `import_draft` | `{ package, mode?: "append" }` | 201 `{ ok, id, competencies, criteria, parents, resumed, appended? }` |
| `compare_published` | `{ frameworkId }` | `{ status: "no_published_version", framework }` or `{ status: "compared", framework, version: { num, label, publishedAt, publishedBy }, diff }` |

Field rules:
- `component` is an **active** registry code. Text is 3 to 2,000 characters, trimmed, with its source wording kept. `sourceRef` is at most 300 characters. `position` counts from 1 within the section; leave it out to add at the end.
- Order is one dense order per competency. A section keeps its slots.
- Editing or moving a retired criterion returns 409 "Restore it first".

`move_criterion`:
- `kind` is one of `reorder`, `section`, `competency` or `section_and_competency`.
- `reorder` means the same competency and the same section. It is delegated unchanged to `reorder_layout`: organisational, and not authorship (F4).
- Every other kind is **substantive** and changes the fingerprint. It is recorded on both competencies, and only within the same framework.
- A move to another competency is refused (409) while a pending layout names the criterion.

`diff` (`src/lib/competency/framework-diff.ts`, `FrameworkDiff`):
- `framework[]`: name and description changes.
- `domains`: `{ added, removed, renamed, reordered }`.
- `competencies`: `{ added, removed, changed[] }`. Each changed entry has:
  - `fields[]`: `{ field, before, after, clinical }`, where `clinical` means the field is inside the fingerprint;
  - `movedDomain`;
  - `reordered`;
  - `criteria`: `{ added, retired, removed, textChanged, moved (in, or to another section), movedOut, reordered (sections) }`.
- `sectionOrderChanged`, `counts` and `unchanged`.
- Snapshots from before 750 match criteria by section and text.

`/api/hq/competency/authoring/sheet`:
- `GET` downloads the CSV template.
- `POST { csv, frameworkCode, dryRun }`, where `dryRun` defaults to true. A dry run returns 200 `{ framework, adds: { competencies: [{ row, code, name, domain, area, criteria: { component: n }, newDomain }], criteria: { byComponent, total }, domains }, unchanged, errors: [{ row, column, message }] }`.
- `dryRun: false` runs the append import. It returns 201 like `import_draft`, or 422 `{ errors }`.

Columns: `framework_code, area, domain, competency_code, competency_name, description, expected_level_score, risk_category, component, criterion_code, criterion_text, source_ref`.
- One row per criterion.
- Competency fields repeat on each of its rows, or are left blank after the first.
- `component` is a registry code or label.
- When `source_ref` is blank, `criterion_code` is stored as the source reference.
- `area` is carried on the domain but not written until S3.

Other changes:
- Labels: `src/lib/competency/criterion-labels.ts`. The prefixes are registry initials (Clinical Skills CS, Knowledge K, Knowledge Application KA, Demonstrated Professional Practice DPP), unique, with C for not classified. They replace the hard-coded letters in StudioWorkspace and the review pack, so paper packs now read CS1, where they used to read S1.
- `AuthoringCriterion.active` is new: false means retired.

**Owner decision needed (retire).** `competency_content_hash` (395/670) hashes every skill row, active or not, so retiring a criterion does not change the fingerprint. Retire and restore are therefore refused (409) once a competency has any clinical content version. Making them usable after review needs a migration that leaves inactive rows out of the hash. Existing hashes would be unchanged wherever no inactive criteria exist.

Tests: 5 new or extended vitest files, plus review-pack and the authoring suites, all pass. tsc and eslint are clean. No harness covers authoring.
