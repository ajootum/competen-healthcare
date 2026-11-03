# UNIFIED-GOVERNANCE-V1 — Competen Holdings unified governance (owner GO 3 Nov 2026)

Owner spec: "COMPETEN HOLDINGS — UNIFIED GOVERNANCE V1, Approved Design and Implementation GO" (3 Nov 2026). It supersedes and absorbs ASMT-PATHWAY-01 ("pathway to publication" as a standard), whose rules module and panel became the P0 governance header and action panel. **Core principle: strong governance in the background, simple actions in the foreground. One item, one status, one obvious next action.**

## Existing capabilities reused (nothing rebuilt)
| Need (spec) | Reused |
|---|---|
| Positions, capabilities, grants | `hq_position`, `hq_capability`, `hq_position_capability` (264), no-code admin `hq_position_admin_*` (500), appointment rules (641) |
| Appointments, many-to-many, scope, term dates, acting/temporary | `ogs_office_appointments` with `capability_scope`, `is_primary`, `term_start/term_end`, statuses (117, 641); the HQ appointments board and API |
| Effective permissions from the person's appointments | `individual_holds_capability` (451), `hq_appointment_in_force` (641), `withOwnAppointments` for owners |
| Item-level separation of duties across all appointments | 640/641 guards; the 890 `asmt_review_decision_sod_guard` (a reviewer never decides their own work, across every version); `asmt_version_people` |
| Review queues and governance records as the source of truth | Checklist Studio `reviewOverview` / `reviewQueue`, `asmt_definition_event`, `asmt_review_decision`; competency `reviewQueue`, `content_approvals`, `clinical_review_decision`, `framework_versions`; `audit_log` |
| Holdings vs subsidiary governance | untouched: `hq_gov_*` registry (610/620) stays the Scholar legal-governance record; HQ positions stay the Holdings authority |
| Specialist studios | Checklist Studio, Competency Framework Governance Workspace, Clinical Review, untouched in function |

## Actual gaps corrected
1. **Publication by the author of the exact approved version** (spec section 3). 890 refused publication by anyone involved in authoring. Migration **940** replaces `asmt_version_lifecycle_guard` whole with one changed block: publish needs the publish capability, the content hash, the required independent governance approvals on that exact hash by reviewers who are not among the version's people, and no rejection on that hash. Review and approval independence are unchanged. Returning to draft clears the hash, so a change after approval invalidates the approval (AC11). `transitions.ts` and the pathway follow the same rule in the app.
2. **Review and approval in one interaction** (AC9). `POST /api/hq/checklist-studio/versions/{id}/decisions` with `andApprove: true` records the governance decision (and the domain decision when the checklist requires one and the reviewer holds that right), then marks the version approved when the count is reached. Distinct records remain (decision rows, the approved event).
3. **Reporting relationships** (sections 1, 6): `hq_position.reports_to` with a loop guard and `hq_position_admin_set_reports_to` (owner, audit first), surfaced as the hierarchy on the Organisation page.
4. **The initial organisation** (acceptance 1-2): five executive and eight management positions seeded by 940 with the standard content-governance profile; clinical approval only on the clinical and academic portfolio. Ordinary later changes are no-code through the positions screen.
5. **A single place to find one's responsibilities** (section 4): the Governance Inbox.

## The simplified journey
- **Governance Inbox** `/super-admin/governance/inbox` (every HQ appointee): My actions, Returned for correction, Items in progress, Overdue (none configured yet, said so), Recently published. Each task: title, type, scope, status, required action, deadline, one contextual action, or the reason and who can.
- **Controlled Content** `/super-admin/governance/controlled-content`: every governed item with status and next action; links into its studio.
- **Organisation & Appointments** `/super-admin/governance/organisation`: Positions (hierarchy, the existing positions board), Appointments (the existing board), Capabilities (grants, Executive / Management profiles, clinical approval as an explicit specialist addition).
- **Governance History** `/super-admin/governance/history`: decisions, approvals, publications and organisation changes across sources.
- **On every governed item** (Checklist Studio version pages, the instrument version list, scales, scoring and layout templates, progression rules; the catalogue drawer, page and finish steps): the three visible stages **Prepare → Review & Approve → Publish** with the internal state in words, the one next action (Submit for Review / Review & Approve or Request Changes / Publish / Create New Version), who can act by name with their independence, blockers with the fix, and the viewer's own standing. Rules: `src/lib/assessment/studio/pathway.ts`; loader `pathway-data.ts`; panel `PathwayPanel.tsx`; catalogue card `PathwaySummaryCard.tsx`.
- Navigation: a "Governance" group with the four doors at the top of Governance & Administration (nav registry 1.6.0); the specialist entries remain; legacy pages link to the consolidated ones.

## Two-person workflow, as enforced
Person A (author; may also hold publish) creates or edits the draft, submits; cannot review or approve it from any of their appointments (database guard, across every version). Person B (reviewer) opens it from the inbox, approves (or requests changes with a note) in one interaction. Person A sees "Publish v1" in the inbox and publishes the exact approved version. A material change needs a return to draft, which clears the hash: the approval no longer counts and the version goes through review again. Every step is a record with the person, action, version and time.

## Acceptance (staging two-person walk)
`docs/evidence/UNIFIED-GOVERNANCE-V1/WALK-2026-11-03.md` with screenshots: Person A = staging owner fixture appointed Chief Executive Officer; Person B = synthetic "ASMT demo reviewer". Checks map to acceptance criteria 1, 2, 4, 5, 7-14, 16, 18. Criteria 3 and 6 are the existing no-code positions screen and scoped appointments (641) exercised on the Organisation page; 15 and 17 hold by construction (no studio, source record, scale or clinical guard was changed).

## Migrations
940 only (`supabase/migrations/940-unified-governance-v1.sql`, build record in `docs/evidence/UNIFIED-GOVERNANCE-V1/`). Applied and verified on staging; production needs a separate owner GO.

## Remaining production release actions (owner)
1. Merge; deploy the app.
2. Apply 940 in the SQL editor (read NOTICE lines), run VERIFY-940.sql (expect pass=12).
3. Appointments on HQ Positions (owner-only): elisha.okaisu → `chief_clinical_academic_officer` or at least `assessment_studio_author` in addition to his review and publish (so he can edit and submit the imports he registered; he still cannot approve them); competenelisha → a position with review (e.g. `assessment_studio_reviewer` or `quality_risk_manager`) so an independent reviewer exists; the owner → an executive position if the owner is to act (an owner without an appointment can only look).
4. Then the three imported drafts (CA-000001, CA-000002, DA-000001): the author sets a delivery mode in Settings, publishes CA-000001-SCALE first (its own review), submits each checklist, the reviewer approves from the inbox, the author publishes. Nothing is published automatically.

## Not done, deliberately
- Document Studio (550) holds personal professional documents, not controlled content; the policy manager has no review lifecycle to attach to. Both are listed as "where compatible" and are left for a later increment.
- Competency framework publication keeps its own stronger rule (publisher ≠ submitter/contributor, `publisher_not_approver` where configured); the spec's two-person rule was applied where the data model had the gap (checklists).
- Deadlines: no governed item carries a configured deadline yet; the inbox says so instead of inventing one.
