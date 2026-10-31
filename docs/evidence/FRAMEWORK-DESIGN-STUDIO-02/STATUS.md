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
| S3 | Server (b): migration 760 Areas; layout draft extension for organisational cross-parent moves; substantive moves in drafts | **done 31 Oct** (760 staging x2, server code; substantive moves left to S1 criteria editing and S5, see Log) |
| S4 | UI (b): Areas in the tree, cross-parent drag, visual framework map | **done 31 Oct** (not browser-verified, see Log) |
| S5/S6 | D2 revision drafts, server (770) and UI | pending |

## Log

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
