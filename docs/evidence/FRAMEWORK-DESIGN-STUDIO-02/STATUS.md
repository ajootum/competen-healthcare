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
| S1 | Server (a): criteria CRUD on drafts; append-mode import; spreadsheet template and parser into a package; draft vs published diff | built, unpushed |
| S2 | UI (a): properties panel, criteria editor, touch drag helper, registry labels, compare view, spreadsheet import page | DONE (built, unpushed, not browser-walked) |
| S3 | Server (b): migration 760 Areas; layout draft extension for organisational cross-parent moves; substantive moves in drafts | **done 31 Oct** (760 staging x2, server code; substantive moves left to S1 criteria editing and S5, see Log) |
| S4 | UI (b): Areas in the tree, cross-parent drag, visual framework map | **done 31 Oct** (not browser-verified, see Log) |
| S5 | D2 revision drafts, server + migrations 770, 771 | **done 31 Oct** (770 staging x2, VERIFY 17/17; 771 structure staging x2, VERIFY 13/13; rollbacks rehearsed; production NOT applied) |
| S6 | D2 revision drafts, UI | **done 31 Oct** (built, tsc/eslint clean, not browser-walked) |

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

### 31 Oct 2026, S2 UI (branch hq/framework-studio-02a): built, unpushed. No migration, no server change.

- **Properties panel** (PropertiesPanel.tsx) replaces the old Criteria tabs and the collapsed editor: the existing update_competency form, then the criteria grouped by section (registry order) with Edit, Add, Retire, Restore and Move to (another competency or section), reorder grip and arrows, and a link "Assessment methods & evidence" to the Verification Studio (no per-competency deep link exists, so it opens the studio). Substantive actions (text, add, retire, restore, move) show "This change needs clinical review again". Criteria controls are enabled in a DRAFT framework only: otherwise they are disabled with "Changes to a published framework go through a revision draft (coming next)." The competency fields form is unchanged (still saves in a draft or published framework as before; disabled only when the framework is in review or archived).
- **Layout:** the panel is the main column beside the explorer (right on md and up, below on a phone). No separate centre canvas, so no horizontal squeeze at 768.
- **Pointer drag** (reorder-ui.ts: startPointerDrag, movePointerDrag, dropOf, readDropTarget): replaces native HTML5 drag. The grip starts it, a 6 px threshold separates a tap or scroll from a drag, drops only inside the list the drag started in. Arrows and the live region stay. Retired criteria keep their slots in the order sent to reorder_layout (the server wants the whole section).
- **Compare with published:** tab ?tab=compare, server-rendered from loadFrameworkDiff (CompareView.tsx, diff-format.ts), with the "no published version" state.
- **Spreadsheet import:** Overview & governance, draft frameworks only, "Add competencies from a spreadsheet" (SheetImport.tsx): template download, CSV upload, preview (adds, unchanged, row errors), Confirm import (append). The JSON import box on the library page is untouched.
- **Labels:** every numbered criteria list in the Studio uses criterionLabel from the registry (the only hard-coded numbering left was the tabs, now removed). Retired criteria are excluded from counts and numbering and shown as "off".
- Tests: reorder-ui and diff-format (13 pass). tsc and eslint clean. Not walked in a browser (needs an authenticated HQ session and data).
- 31 Oct (coordinator, within D2): update_competency on PUBLISHED frameworks still saves live (pre-existing behaviour). S5 must route it - and every other content action (criteria, outcomes, new competencies, substantive moves) - into the revision draft for published frameworks; until S5 lands, behaviour is unchanged. Verification Studio link opens the studio (no per-competency deep link) - acceptable.
- 31 Oct (761, retire after review, D3): migration 761 (sha256 bd5d96bc...6e06) makes competency_content_hash cover ACTIVE criteria only, and the 690 version snapshot does the same. Staging: applied twice, rolled back and re-applied. 349/349 hashes unchanged, batch agrees, a retire changes the hash and a restore returns it, caller counts unchanged. Production NOT applied (needs owner GO, any time after 690, independent of 760). retire_criterion and restore_criterion now work on reviewed competencies in draft frameworks, classified substantive, when the 761 marker is present. Without it they still return 409 (fail closed). Record: 761-build-record.md. Open: a 690 method can still pin a retired criterion (for S5 or the owner).
- 31 Oct (coordinator): retiring a criterion pinned by an ACTIVE assessment method (690 competency_method_criteria) must be refused with 'remove it from the method first' (app-level, no migration) - S5 adds this.

### 31 Oct 2026: S3 done (branch hq/framework-studio-02b, not pushed)

**Migration 760** `760-framework-areas.sql`, sha256 `137d644790ce23940d6c737b3cce19338f1976e13984c4a186a7c76d8f884dad`. Build record `760-build-record.md` (PRECHECK, VERIFY 16/16, plant-fail 4 red, ROLLBACK rehearsed to PRE exactly, re-applied, body diffs). **Application order 750, 751, 752, 760** (it refuses without them). House rules ALL CLEAR. **Staging only. Production does NOT have it** (separate owner GO, owner applies).
- `framework_areas` (RLS and grants as `framework_domains`), `framework_domains.area_id` (same framework only, set null on delete). Not in the content hash.
- Layout draft v1 gains `areas`, `domainAreas`, `areaNames`, and a competency listed under another domain of the same framework (= a move). Applied atomically by the redefined 752 trigger. Criteria across sections/competencies and foreign ids still refused.
- F4: `create_area`, `rename_area`, `delete_area`, `reorder_areas`, `set_domain_area`, `move_competency_domain` are not authorship (DB guard and `NOT_AUTHORSHIP`), but are contribution (640 unchanged).

**API contract for S4** (`POST /api/hq/competency/authoring`, `hq.quality.competency.author`, audit row first, action name = audit action). Draft framework never published: written live (`mode: "direct"`). Published (or ever published): only the layout draft (`mode: "draft"`), learners unchanged until an independent publisher publishes. Without 760: 409, nothing written.
- `{ action: "create_area", frameworkId, name, description? }` -> 201 `{ ok, mode, id, unchanged, layoutPending }`. 409 duplicate name (case-insensitive). On a published framework the Area row is created EMPTY (inert until a draft places a domain in it).
- `{ action: "rename_area", frameworkId, areaId, name }` -> published: `areaNames` in the draft.
- `{ action: "delete_area", frameworkId, areaId }` -> only when no domain is in it, live or in the draft (409 otherwise). It also drops the Area from the draft.
- `{ action: "reorder_areas", frameworkId, order }` -> order = every Area id, once (422 otherwise).
- `{ action: "set_domain_area", frameworkId, domainId, areaId | null }`.
- `{ action: "move_competency_domain", frameworkId, competencyId, domainId, position? }` -> position = 0-based index in the target domain after the move (omitted = last). Same framework only (422 otherwise).
- 200 shape for all: `{ ok: true, mode: "direct" | "draft", unchanged, layoutPending }`. `reorder_layout` with a competency of another domain now answers 422 ("a move, not a reorder"), no longer 409 clinical.
- **Reads:** `loadAuthoringView`: `view.areasReady`; per framework `areas` [{id, name, description, sortOrder}] (live, ordered) and per domain `areaId` (live), both absent before 760. The draft overlay is `layoutDraft` (may carry `areas`, `domainAreas`, `areaNames`, moved competencies): render with `applyLayout(tree, layoutDraft)` (tree with `areas` and domain `areaId`) then `groupByArea(...)` from `layout-order.ts` (pure, client-safe). The authoring page now resolves competencies framework-wide, so a moved one renders (fix in `page.tsx`).
- Pack: framework pack items are ordered Area by Area and carry `area` (name or null), absent before 760. Word copy shows "Area · Domain · Framework". Learner (`foundation.ts`) does not read Areas. Version snapshots add `framework_areas` and domain `area_id` (fallback chain to the 750 and pre-750 selects).

**NUR-CCF steps (after 760 is applied, any author, no SQL).** Never-published draft: live. Published: through the draft layout, then put forward and an independent publisher publishes (as a revision).
1. `create_area` "Clinical Practice", then `create_area` "Professional Practice" (order: `reorder_areas` if needed).
2. `set_domain_area` for each of the existing 13 domains -> Clinical Practice.
3. After the PP package import (owner adds the two components first), `set_domain_area` for the Professional Practice domain -> Professional Practice.
4. Preview with the review pack (`?view=pack&layout=draft` when published). Competency, criterion and outcome ids are unchanged, so no clinical re-review.

**Checks.** vitest framework-areas (new, 14) + layout-order + framework-layout + review-pack + clinical-review + framework-publication: 64/64. Plant-fail: organisational actions taken out of NOT_AUTHORSHIP and published routed live -> 2 red, restored -> green.

**Not done here.** Substantive moves (criterion to another section or competency) in draft frameworks: content edits belong to S1 criteria editing (competen-fds2a) and, for published frameworks, S5 revision drafts. UI is S4.

### 31 Oct 2026: S4 done (branch hq/framework-studio-02b, not pushed)

**Built (UI over the S3 API, no server change).**
- Explorer tree is framework > Area > domain > competency; domains with no Area under "Unassigned" (shown only when Areas exist and one domain has none); a framework with no Area is the flat tree as before. Create Area (details form), Rename, Delete (enabled only when empty; server also checks), Move up / Move down and drag to reorder Areas (`reorder_areas`), domain reorder now inside its Area (the full-framework order is sent: slots refilled, same `expand` idea as S2).
- Organisational moves: drag a domain onto an Area (or Unassigned), drag a competency onto another domain (moves to the end), or the accessible alternative: "Move to Area..." on an open domain and "Move to domain..." on the selected competency, each a select plus a Move button (a select that moved on change would move on every arrow key). Optimistic with rollback; live-region announcements ("Moved X to the Area Y."), and on a published framework the message adds that it is saved to the draft layout.
- Draft banner (`LayoutDraftBanner`) now says "published structure" and lists Area/domain/competency moves as organisational, no clinical re-review.
- Map view: Tree | Map toggle (aria-pressed). Areas are columns (CSS grid auto-fit, stacks on a phone with no breakpoint), domain cards, competency chips (name, code, active-criteria count, status dot and text). Real nested lists, chips are buttons. A chip selects the competency in the tree and returns to the Tree view (properties/editor).
- CPR-MOB-001: only the existing `md` edge; `pointer-coarse:min-h-[var(--cmp-touch-min)]` on every new control; `min-w-0` / `break-words` so nothing sets a fixed width. Not measured in a browser (no authenticated 760 stack here).
- `page.tsx` passes the Areas as the editor sees them: live Areas + domain `areaId`, `applyLayout` over the pending draft (order, names, placement), `areasReady` = 760 present.

**Files.** New: `src/lib/competency/studio-areas.ts` (+ test, 11), `_components/OrganiseControls.tsx`, `_components/FrameworkMap.tsx`. Edited: `StudioWorkspace.tsx` (an S4 block after the reorder code, the domain loop wrapped per Area, toggle), `LayoutDraftBanner.tsx`, `[frameworkId]/page.tsx`.

**Merge notes for fds2a (S2).** StudioWorkspace.tsx conflicts are expected. (1) `Group` gets `expand` in both branches (same name and meaning; mine also adds `post` for `reorder_areas` and level "areas"); the `order: g.expand ? g.expand(ids) : ids` line must read the same. (2) Cross-parent drops use native HTML5 events: `xdrop(...)` on Area blocks and domain blocks reads `dragSource()` from `drag.current.{key,index}` and relies on same-list rows stopping the event first. When S2's pointer drag replaces native drag, the pointer-up handler must, when the hit element is not in the same list, resolve the source like `dragSource()` (domain key `domains:<areaId|none>`, competency key `competencies:<domainId>`) and the target from the element under the pointer (add `data-drop-area` / `data-drop-domain` attributes to the Area and domain blocks), then call `dropAction` + `organiseMove`. `dropAction` and everything else in studio-areas.ts is pure and unaffected. (3) The competency "Move to domain..." select sits under the selected explorer row, not in the properties panel, so it does not touch PropertiesPanel.

**Checks.** tsc whole project clean (`NODE_OPTIONS=--max-old-space-size=8192`), which includes the S3 `framework-layout.ts:105` fix. eslint clean on all changed files. vitest studio-areas 11/11 (grouping incl. unassigned, expandOrder, setDomainArea, moveCompetency, dropAction, mapModel). Not done: browser walk at 375/768 and a drag walk (needs the authenticated staging stack with 760).

### 31 Oct 2026, merge of hq/framework-studio-02b (S3+S4+760) into hq/framework-studio-02a (S1+S2+761)

- Migrations 760 and 761 are separate files and redefine disjoint functions (761: `competency_content_hash`, `competency_content_hashes`, `competency_content_hash_covers_retirement`, `clinical_content_version_guard`. 760: `framework_layout_problem`, `frameworks_layout_guard`, `frameworks_layout_apply_on_publish`, `framework_areas_scope_guard`, `clinical_review_decision_sod_guard`). GAPS.md was identical in both branches.
- `StudioWorkspace.tsx`: one drag implementation, S2's pointer grip. `Group.expand` (same meaning in both) plus S4's `post`. S4's native HTML5 `xdrop` handlers are removed; Area blocks carry `data-drop-area` (`none` = Unassigned) and domain blocks `data-drop-domain`. On pointer move/up outside the drag's own list, `crossTarget` resolves the source (`dragSource`, now taking the pointer state) and the block under the pointer, then `dropAction` + `organiseMove` (highlight while over). Same-list reorder, the arrow buttons, "Move to Area..." / "Move to domain..." selects, PropertiesPanel, the Area tree and the Map are all kept; criteria moves (S1) untouched.
- `OrganiseControls.tsx` `AreaHeading` takes a `grip` (the S2 pointer grip) in place of its static native-drag handle, so Areas reorder by drag again.
- `[frameworkId]/page.tsx` passes both `pubStatus` (S2) and `areas`/`areasReady` (S4). `review-pack.ts` imports both `groupByArea` and the criterion labels.
- Not browser-walked (drag across parents needs the authenticated stack with 760).

### 31 Oct 2026: S5 done (branch hq/framework-studio-02a, not pushed)

**Migration 770** `770-framework-revision-drafts.sql`, sha256 `ae0b8190c51fba8994d52e5fa05de31efca6e932122d835bf4d11f373383e90a`. Record `770-build-record.md`. Order 750, 751, 752, 760, 761, 770. **Staging only; production needs owner GO.** 466/640 publication guards unchanged; the apply runs BEFORE them so they judge the content as it will be published. Without 770 every content change to a published governed framework is refused (409), never written live.

**API contract for S6** (`POST /api/hq/competency/authoring`, `hq.quality.competency.author`, errors `{ error }`). A framework is "revised" when `pub_status = published`, shared and CFCA (`competency_layer` set). Drafts behave exactly as S1-S4.
- Same actions, same bodies, on a revised framework: `update_competency`, `create_competency` (201 `{ ok, id, mode: "revision", revisionId }`, `id` is the final competency id), `create_criterion` (201 `{ ok, id, mode, revisionId }`), `update_criterion`, `retire_criterion`, `restore_criterion` (`{ ok, unchanged, mode: "revision", revisionId? }`), `move_criterion` (`{ ok, kind, substantive, mode: "revision" | "draft", unchanged? }`: a same-section reorder of a competency the revision holds is saved in the revision, otherwise the layout draft). The first edit opens the revision. Ids in every later call are the same ids (live, or the new ones returned). 409 without 770; 409 "Remove it from the method first" when a published assessment method pins the criterion (drafts too).
- `revision_view { frameworkId }` -> `{ revision: null }` or `{ revision: { id, createdBy, createdAt, updatedAt, competencies: [{ id, isNew, domainId (new only), sortOrder, code, name, description, learningOutcomes, expectedLevelId, riskCategory, practiceId, cpuId, proposedHash, liveHash, changed, clinical: ClinicalReview at the PROPOSED content, criteria: [{ id, isNew, text, component, sourceRef, sortOrder, active }] }] } }`. Only competencies touched by the revision are listed; render the rest from the live tree.
- `compare_revision { frameworkId }` -> `{ status: "no_revision" }` or `{ status: "compared", revision: { id, updatedAt }, diff: FrameworkDiff }` (published -> proposed, same shape as compare_published).
- `discard_revision { frameworkId }` -> `{ ok, discarded }`. Nothing live changes.
- Review of the PROPOSED content: `review_preview { frameworkId, scope, revision: true }` and `review_submit { frameworkId, items, revision: true }` (same shapes as now; hashes are proposed hashes), or `submit_review { competencyId, frameworkId, revision: true }`. Reviewers decide on the existing queue: items carry `revision: { id, isNew }` and show the revision's criteria.
- Publication: unchanged route. `decidePublication` returns `revisionApplied: true`; refuses 409 when the revision changed after it was put forward or can no longer be applied (message names why). Put forward again after any revision edit.
- Organisational changes (Areas, domain Area, competency to another domain, reorders) keep the layout draft. A NEW revision competency is not moved between domains (404).

**Checks.** vitest 76/76 (framework-revision 12 new), plant red/green; competency-foundation harness 33/33; tsc and eslint clean; house rules ALL CLEAR. Not browser-walked.

### 31 Oct 2026: S5 extension, migration 771 (branch hq/framework-studio-02a, not pushed)

Closes the S5 open item (D3: ALL changes to a published framework pass through the revision). **Migration 771** `771-framework-revision-structure.sql`, sha256 `53e7bcaf59bfd007f5e22a4a6b6e6e7537934a08d769aa3ab535add2ea52106d`. Record `771-build-record.md`. Order 750, 751, 752, 760, 761, 770, 771. **Staging only (x2, VERIFY 13/13, plant red, rollback rehearsed to PRE exactly, re-applied); production needs owner GO.** 466/640/751/752/760/761/770 guarantees hold (table in the record).
- The framework name and description, new domains (pre-allocated id, Area optional) and domain renames, new or renamed practices and CPUs go into the same revision and are applied by the same publication statement (refused publication applies nothing). Not in the content hash: **organisational for review** (no clinical re-review, not authorship), but **contribution** (the editor cannot publish).
- Drafts unchanged (live). Without 771 every structure action on a published governed framework is refused (409, nothing written).

**API contract additions for S6** (`POST /api/hq/competency/authoring`, `hq.quality.competency.author`). On a revised framework (published, shared, CFCA) these bodies are unchanged and answer `mode: "revision"`; the first one opens the revision:
- `update_framework { frameworkId, name, description? }` -> `{ ok, unchanged, mode, revisionId? }`. Sending the live label again clears the proposal.
- `create_domain { frameworkId, name, code?, areaId? }` -> 201 `{ ok, id, mode, revisionId }`. `id` is the final domain id. `areaId` = a live Area of the framework (422 otherwise). Placed after every domain.
- `rename_domain { domainId, name, code? }` -> `{ ok, unchanged, mode, revisionId? }`. `domainId` live or new.
- `create_practice { domainId, name, code, description? }` -> 201 `{ ok, id, mode, revisionId }` (domain live or new).
- `rename_practice { practiceId, name, code, description? }` (**new action**, drafts live) -> `{ ok, unchanged, mode, revisionId? }`.
- `create_cpu { practiceId, name, code, description?, riskCategory?, complexity?, reassessmentMonths? }` -> 201 `{ ok, id, mode, revisionId }` (practice live or new).
- `rename_cpu { cpuId, name, code, description? }` (**new action**, drafts live; risk not changed) -> `{ ok, unchanged, mode, revisionId? }`.
- `update_competency` / `create_competency` may name a NEW CPU of the revision (`cpuId`) and `create_competency` a NEW domain (`domainId`).
- `move_competency_domain { frameworkId, competencyId, domainId }` for a NEW revision competency -> `{ ok, mode: "revision", unchanged, layoutPending: false, revisionId }`, to the end of a live or new domain (`position` -> 422). A published competency into a NEW domain -> 409 (publish the revision first). Every other move: the layout draft, unchanged.
- `revision_view` adds `framework: { name, description } | null` (null = label unchanged), `domains: [{ id, isNew, name, code, areaId (new only), sortOrder (new only) }]`, `practices: [{ id, isNew, domainId (new only), name, description, code }]`, `cpus: [{ id, isNew, practiceId (new only), name, description, code, riskCategory, complexity, reassessmentMonths (new only) }]`. Render the rest from the live tree.
- `compare_revision`: `diff.framework[]` (label), `diff.domains.renamed` and `.added` now include the revision's structure.
- Review: `review_preview` / `review_submit` with `revision: true` list new competencies under new domains; the reviewer queue places them by the revision domain.
- Errors: 409 "...not set up on this environment yet (migration 771)...". The STATUS S2 note on update_framework/create_domain/practices/CPUs saving live on published frameworks no longer applies once 771 is present.

**Checks.** vitest framework-revision 21/21 (9 new) + 6 related files 67/67, plant 6 red then green; competency-foundation harness 33/33; tsc and eslint clean; house rules ALL CLEAR. Not browser-walked.

### 31 Oct 2026: S6 done (branch hq/framework-studio-02a, not pushed)

**Built (UI over the S5 API, no migration, no change to 770, framework-revision.ts or the route).**
- **Editing on a published framework** is enabled again: criteria controls and the details form save as before and the server routes them into the revision (first edit opens it). Revised = published and a layer set. Without 770 (or an unreadable revision) the workspace is read only with the reason; a published framework with no layer keeps the old "cannot be revised here" note.
- **Revision banner** (RevisionBanner.tsx): "Revision draft - not visible to learners or assessors until reviewed and published", counts (changed / new competencies, criteria added, reworded, retired, restored), last saved and opened by, Compare with published, Preview revision pack, Put forward for clinical review (review_preview / review_submit with revision:true), Discard revision (confirm, discard_revision), and the independent-publisher note linking Overview & governance and Framework publication. With no revision open, a calm note says the first edit opens one.
- **Overlay**: revision-ui.ts `overlayDomains` lays the proposed values over the live tree (layout draft applied first). Held competencies carry a mark (Changed / New / n added / reworded / retired / restored) in the explorer, the Map chips, the header and the panel; criteria carry New / Reworded / Restored / Retired "in the revision"; review state is the server's state at the PROPOSED content. Toggle "Revision (proposed)" / "Show published version" renders the published values read only (a new competency has none).
- **Compare tab**: with an open revision it is "Compare revision with published" (loadRevisionComparison: compare_revision diff + the published version label; CompareView `revision` labels "Revision:"). Published with no revision: "No open revision draft". Drafts keep draft-vs-published.
- **Review pack**: `?view=pack&revision=1` (loadFrameworkPack `revision: true`): proposed content, proposed fingerprints and states, red "Revision - not published" banner, per-competency revision line, no Word download (the docx route builds the published pack). No open revision: no pack.
- **Rules kept**: a new revision competency is not reordered or moved between domains (no live row, server 404); a criteria reorder inside a competency the revision holds is sent as move_criterion { criterionId, position } (saved in the revision), otherwise reorder_layout as before; checkboxes for "Review selected" are disabled for competencies not in the revision; "Put forward for clinical review" per competency posts submit_review with revision:true.
- **CPR-MOB-001**: no new breakpoints; pointer-coarse min sizes on every new control; wrapped/min-w-0 text. Not measured in a browser.
- **Files.** New: revision-ui.ts (+ test 12), revision-view.ts, RevisionBanner.tsx. Edited: StudioWorkspace, PropertiesPanel, FrameworkMap, ReviewDialog (`revision` prop), CompareView, [frameworkId]/page.tsx, studio-areas.ts (chip tags), review-pack.ts, ReviewPackView.tsx.
- **Checks.** tsc whole project and eslint on changed files clean; vitest revision-ui, studio-areas, review-pack 27/27. Not browser-walked (needs the authenticated staging stack with 770).
- **Open for the owner/coordinator.** (1) The Word route does not know revisions, so it is not offered on a revision pack. (2) `position` for move_criterion is counted over the whole section including retired criteria (as placeCriterion is fed), assumed from the S5 code, not run. (3) The "Put forward for publication" button stays on Overview & governance (SubmitForPublication revision=true already exists); it is not duplicated in the banner.

