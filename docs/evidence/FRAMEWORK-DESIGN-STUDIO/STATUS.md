# FRAMEWORK-DESIGN-STUDIO-01: STATUS (handover between slices)

- **Branch:** `hq/framework-design-studio-01`
- **Worktree:** `C:\Users\elish\Documents\Competen\competen-fds`, base main 500df4d4
- **Design:** `PLAN.md` (this folder)
- **Owner GO:** 31 Oct 2026, implementation only. **Production deploy and migration application each need a separate owner GO.**

## Owner rulings (binding)

1. **Outcome reordering is a CLINICAL change.** The order and wording of `learning_outcomes` are in the content hash, so reordering them sends the competency back through clinical review.
2. **Moving a competency to another domain, or a criterion to another section (`component_code`), is a CLINICAL change.** Reordering within the same parent is presentation-only.
3. **Published framework reordering:** draft layout, then preview, then independent publication as a **revision** through the existing publication path. A publisher who contributed is refused (640). Learners keep the published order until then. A never-published draft framework may be reordered directly.
4. **F4, with reviewer independence:**
   - A presentation-only editor counts as a contributor, so they cannot publish their own layout change.
   - They MAY clinically review unchanged content that they did not author or substantively edit.
   - A reorder audit action must therefore count for publication SoD but NOT as authorship for clinical review (both the app sets in `framework-publication.ts` / `clinical-review.ts` and the DB guard in 395).
5. **Additional safeguard:**
   - Verification evidence must reference STABLE OUTCOME IDS, not display positions.
   - Preserve existing evidence associations against their original framework versions.
   - Reordering must never silently change historical evidence.
   - Production currently has 0 verification requests and 0 decisions, so a backfill is cheap. Still write it correctly for any rows present.
6. **Scope:**
   - Reuse the existing administration, governance, versioning and publishing.
   - Minimum migration and interface changes.
   - Stay no-code, profession-agnostic and configurable: nothing hard-coded per profession or framework.
   - No redesign, no further discovery.

## Key facts (from the read-only survey, main @500df4d4)

**Hierarchy and order**
- framework, then `framework_domains`, then `framework_competencies`, then `competency_skills` (criteria). Each has a uuid and a `sort_order`.
- Sections are `competency_skills.component_code`, ordered by the global registry `competency_assessment_component.sort_order` (660).
- Outcomes are only `framework_competencies.learning_outcomes` jsonb `string[]` (384).

**Content hash and versions**
- Hash: `competency_content_hash` (670:57). It includes outcomes in array order and criteria as `name [component]` sorted by name. It excludes all `sort_order` values and `domain_id`.
- Versions: `clinical_content_version` (395), append-only.

**Governance**
- Lifecycle: `authoring.ts` `EDITABLE = {draft, published}`. A published framework is edited live, and readers use the live tables.
- Authoring route: `src/app/api/hq/competency/authoring/route.ts`. It needs `hq.quality.competency.author` and writes an audit row first (`authored` helper, `authoring.ts:83`).
- Publication: `src/app/api/hq/competency/publication/route.ts`.
  - `decidePublication` and `nextVersion` are in `framework-publication.ts`.
  - The 466 gate requires every competency approved at its current hash. 640 is the SoD guard.
  - Snapshots: `framework-lifecycle.ts:101-136`. They currently omit domain and skill ids and `component_code`.

**Reads**
- Studio: `authoring-view.ts` (sorts in TS, no tie-break).
- Learner: `foundation.ts:251` orders competencies across ALL domains at once (a bug for per-domain order).

**Evidence**
- `competency_verification_request.outcome_indexes int[]` (510:201).
- `competency_verification_evidence.outcome_indexes` (510:237). Its guard (510:747) checks only that each index is below the length.
- Each request stores `competency_hash` and a `competency_snapshot` (with outcomes) at 510:771-777.

**Interface**
- No HQ reorder, criteria edit or drag-and-drop library exists.
- Native drag exists in `src/app/educator/studio/frameworks/Authoring.tsx` (estate only).
- Studio UI: `src/app/super-admin/competencies/authoring/_components/StudioWorkspace.tsx` and `AuthoringControls.tsx`.
- Preview: review pack `?view=pack` (`review-pack.ts`, `_studio/ReviewPackView.tsx`).

## Slices

| Slice | Scope | State |
|---|---|---|
| A | 750 (`frameworks.layout_draft` jsonb, `frameworks.component_order` text[]) and 751 (stable outcome ids, evidence `outcome_ids`, backfill, guards, F4 change to the 640 review SoD guard), each staged twice with PRECHECK/VERIFY/ROLLBACK and build records | **done 31 Oct** (staging only, see Log) |
| B | Server: reorder actions, classification, layout draft, apply on publication as a revision, snapshot ids, tie-break reads, learner per-domain order, F4 audit classification, evidence readers using `outcome_ids` | pending |
| C | UI: drag and drop with Move up/down on every row, live-region announcements, draft-layout banner and preview in the pack, submit layout, CPR-MOB-001 | pending |
| D | Tests and harnesses (plant-fail), browser at 375/768/1440, PR | pending |

## Commands

- Staging SQL (one transaction): `echo 'ezhvpgtcqcdsgylrxgdb' | node C:/Users/elish/CompetenBackup/bin/run-staging-sql.mjs <file>`
- Targeted tests: `npx vitest run <paths>`
- tsc: `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p .`
- Harnesses: `npx tsx scripts/<name>.ts`. Relevant: `migration-house-rules`, `plane-boundary`, `hq-nav-registry`, and the competency/verification harnesses (find them under `scripts/`).

## Log

### 31 Oct 2026: slice A done (750 + 751 on STAGING only, production does NOT have them)

**Where things are**
- **Files:** `supabase/migrations/750-framework-design-layout.sql` (sha256 `1316e5a7...75c8`) and `751-competency-outcome-stable-ids.sql` (sha256 `622d97fa...a39e`).
- **Build records:** `750-build-record.md` and `751-build-record.md`.
- **Staging:** both applied twice, rolled back to an exact PRE state, re-applied. VERIFY 32/32 ok.
- **House rules:** ALL CLEAR.
- **Gate:** slice B code must be gated OFF and fail closed while either migration is absent.

**750: columns on `frameworks`**
- `layout_draft` jsonb null;
- `layout_draft_by` uuid null (FK profiles, set null);
- `layout_draft_at` timestamptz (set by the DB);
- `component_order` text[] null (null = `competency_assessment_component.sort_order`).

**750: the trigger `frameworks_layout_guard`**
- Refuses a foreign or cross-parent id, a repeat, an unknown component or a draft with no author.
- Write `layout_draft_by` = the actor in the SAME update as `layout_draft`.
- Setting `layout_draft = null` clears `by` and `at`.

**`layout_draft` v1 schema** (every key but `v` optional, lists may be partial; the applier appends unnamed ids in current order and skips deleted ones)
```json
{"v": 1,
 "domains": ["<domain uuid of this framework>"],
 "competencies": {"<domain uuid>": ["<competency uuid of THAT domain>"]},
 "criteria": {"<competency uuid>": ["<competency_skills uuid of THAT competency>"]},
 "componentOrder": ["<component code>"] }
```
- `criteria` is the order of a competency's skills. Sections group them by `component_code`, in `componentOrder`, then `frameworks.component_order`, then the registry order.

**751: outcome ids**
- `framework_competencies.learning_outcome_ids` jsonb NOT NULL, uuid strings parallel to `learning_outcomes`.
- Kept by the trigger `framework_competencies_outcome_ids`. A same-text outcome keeps its id, duplicates are matched in order, and writing the ids alone is refused.
- Not in the hash.

**751: request and evidence columns**
- `competency_verification_request.outcome_map` jsonb NOT NULL `[{"id","text"}]`, the outcomes at request time.
- `competency_verification_request.outcome_ids` uuid[] NOT NULL.
- `competency_verification_evidence.outcome_ids` uuid[] NOT NULL.
- Each has one id per `outcome_indexes` entry. -1 = nil uuid `00000000-0000-0000-0000-000000000000`.

**751: request and evidence triggers**
- `competency_verification_request_outcome_ids` (BEFORE INSERT) and `competency_verification_evidence_outcome_ids` (BEFORE INSERT OR UPDATE).
- They fill the ids from the indexes, refuse mismatched ids or an out-of-map index, and never rewrite ids.

**751: how app code reads and writes outcome ids**
- **Resolve id to text via the request's `outcome_map`,** never the live competency. This covers the request and all of its evidence.
- **Evidence indexes** are positions in the request map.
- **Writers** may send `outcome_ids` alongside `outcome_indexes`, and they must agree.
- **Helper functions:** `competency_outcome_ids_valid`, `competency_outcome_ids_match`, `competency_outcome_map`, `competency_outcome_ids_of`.

**F4: the audit action `reorder_layout`**
- Use it for every presentation-only order write: a direct reorder of a never-published draft, and saving or clearing a layout draft.
- Submitting a layout = existing `submit_review`. Applying at publication = existing `publish`. Do NOT invent `publish_layout`: the 640 publication guard would count it as contribution and refuse the publisher's own audit-first row.
- **DB:** `clinical_review_decision_sod_guard` (640, redefined in 751, one-line diff) excludes it from authorship. `frameworks_sod_publication_guard` is unchanged and counts it as contribution.
- **App (slice B):** add `reorder_layout` to `NOT_AUTHORSHIP` in `clinical-review.ts`. Do NOT add it to `GOVERNANCE` in `framework-publication.ts`.

**Finding:** the authorship audit read lives in 640 `clinical_review_decision_sod_guard`, not in 395. The 395/690 `clinical_review_decision_guard` reads the app-computed `authored_by` and is unchanged.
