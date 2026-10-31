# FRAMEWORK-DESIGN-STUDIO-01: no-code ordering in the HQ Competency Studio

Gap-only design, read against main @500df4d4 (31 Oct 2026). Nothing built yet.

## What already exists (reused unchanged)

- **Stable ids, separate from order.** Every level has its own uuid and its own `sort_order`: frameworks, domains, competencies and criteria (`competency_skills`). Reordering never touches an id, so assessments, verification, Scholar and Professional references stay intact.
- **Approval is not tied to order.** The clinical content hash (395, redefined in 670) leaves out the display order of domains, competencies and criteria, so reordering them does not make an approval stale.
- **Governance.** The Studio, the authoring route with an audit row before every write, the publication route (submit, then decide by a separate publisher), the 466 approved-at-current-hash gate, the 640 publisher-not-contributor guard, `framework_versions` snapshots on publish, and major/minor/revision labels.
- **Preview.** The review pack (`?view=pack`) renders a framework in its stored order.

## Gaps

1. **No reorder anywhere in HQ.** There is no move action, no criteria edit route, and no drag-and-drop library. An estate-only native drag exists, but it has no keyboard alternative.
2. **Published frameworks are edited live.** Learners, Scholar and verification read the live tables, so writing a new order would change what they see immediately, with no governance.
3. **Learning-outcome order is clinically meaningful.** The order of outcomes is inside the hash, and verification evidence points at outcomes by position (`outcome_indexes`, 510). Reordering outcomes would silently re-point existing evidence.
4. **Section order is global.** The component registry (660) has one order shared by every framework.
5. **Order can be unstable.** Equal `sort_order` values have no tie-break. The learner catalogue sorts competencies across all domains at once, not domain by domain.
6. **Snapshots can't rebuild a version's order.** `framework_versions` snapshots leave out domain and criterion ids, so a past version's order cannot be faithfully rebuilt from them.

## Design

- **Drag-and-drop plus Move up/down buttons** on the Studio explorer, for domains, competencies within a domain, sections within a framework and criteria within a section. Uses native HTML5 drag with no new library, keyboard buttons on every row, live-region announcements, `pointer-coarse` touch sizing and the single `md` breakpoint.
- **Change classification is decided by the system, not by the editor.**
  - **Presentation-only:** domain, competency, section and criterion order. These are outside the hash, need no clinical re-review, and are published as a **revision**.
  - **Clinically substantive:** outcome order, outcome wording, moving a criterion to another section (its component is in the hash), and moving a competency to another domain. These go through the existing content-edit, clinical review and publication path, with **minor** or **major** chosen by the publisher as today.
- **Draft framework (never published):** a reorder is written directly. There are no learners yet.
- **Published framework:**
  - A reorder is saved as a **layout draft**, and learners keep seeing the published order.
  - Authors preview the draft order in the review pack ("Draft layout" banner) and submit it.
  - A separate publisher applies it through the existing publication decision as a **revision**. The existing guards apply: the publisher cannot be a contributor, and the 466 gate is unaffected because no hash changes.
- **History.** Each publish snapshot is extended to include domain, competency and criterion ids with their order and component, so every published version's exact order can be rebuilt. Earlier snapshots are not touched.
- **Stable reads.** Every Studio, pack and learner read breaks ties by `sort_order`, then name, then id. Learner reads sort domain by domain.
- **Migration 750** (additive): `frameworks.layout_draft jsonb` (the pending order, validated against the framework's own ids) and `frameworks.component_order text[]` (per-framework section order; the global registry order stays the fallback). Staged twice, with rollback. Production apply by you.

## Owner decisions

- **F1. Outcome order: substantive (recommended).** Because evidence points at outcomes by position, an outcome move is treated as a content change: the competency goes stale, needs clinical review, and existing evidence keeps its stored snapshot. The alternative is giving outcomes stable ids, a larger change to 384 and 510 that would need its own decision.
- **F2. Cross-parent moves are substantive (recommended).** Moving a competency to another domain, or a criterion to another section, goes through review. Within-parent reorder is presentation-only.
- **F3. Published-framework reorders publish as a "revision" through the existing publisher (recommended).** The alternative, applying presentation changes live without publication, is not recommended because learners would see unreviewed changes.
- **F4. Clinical-review eligibility (recommended).** A person who only reorders still counts as a contributor for the publication rule (publisher is not a contributor), but does **not** become an "author" who is barred from clinical review, because reordering changes no clinical content.
