# ASMT-PATHWAY-01 — The pathway to publication as a standard across Checklist Studio and the Assessment Catalogue

Owner question (3 Nov 2026), after the first three imported instruments sat in production as Drafts: *"who submits for review? Can we make it a standard to give helpful prompts and show the pathway to publication of a tool."*

This note is the standard and the map of its implementation. It changes no governance stage, no separation-of-duties rule and no editor. The 890 lifecycle guard decides; the screens explain.

## The standard

**Every page that shows a tool (a checklist version, a response scale, a scoring template, a layout template, a progression rule set, or a catalogue identity) states, in this order and in plain words:**

1. **The stage** it is at on the one pathway: Draft → Submitted for review → Approved → Published → Retired (or Superseded). Each stage shows done / current / blocked / not yet, and the role responsible for it.
2. **The next action**, as a sentence a person can act on: *"Submit v1 for review"*, *"Approve or return v1"*, *"Publish v1"*, *"Set product availability in the catalogue"*, *"Create the first draft"*. The button for it is the obvious one on the page.
3. **Who can act**: the capability the step needs, the positions that grant it, and the appointed holders **by name** from the live appointments, each marked *can act* or *cannot act: <reason>*. Independence is content-specific: nobody approves, reviews or publishes a version they authored, edited or submitted, this one or an earlier one. "Nobody is appointed", "no position grants this right" and "the appointments could not be read" are said, never left blank.
4. **The viewer's own standing**: *you can act on this*, or *you: <reason>* (not an author of this draft; not independent, another appointee must approve; needs the publish capability …).
5. **What blocks it, with the fix**: validation problems, no response scale chosen or the scale not yet published, no delivery mode, a required domain review missing, approvals that no longer count because the content changed, a reviewer's request for changes, no eligible independent publisher.
6. **A helpful prompt for the moment**: after registration or import (*"Your draft is registered. Next: open it in Checklist Studio, complete its content, then Submit for review. Authors: …"*), after submission (*"Submitted by X. Waiting for a reviewer: Y, Z can approve. You authored this, so another appointee must approve."*), after a return (*"Returned with notes by Y: "…". Edit and resubmit."*), after approval (*"Ready to publish: P can publish."*), after publication (*"Published. To make it available in a product, set its product availability in the catalogue."*), after retirement (*"Retired: v2 supersedes it."*).

The same five stages, the same words and the same colours appear wherever a tool is shown, so a person learns the pathway once.

## Where it is implemented

| Layer | File | What |
|---|---|---|
| Pure rules | `src/lib/assessment/studio/pathway.ts` | `pathwayOf(input)` → stages, next action, blockers, who can act, prompt. `standingOf` (independence per holder), `stagesOf`, `blockersOf`, `summarize` (the short form). Builds only on `availabilities()` and `approvalStatus()` in `transitions.ts`; adds no rule. Same pattern as `src/lib/competency/governance-rules.ts`. |
| Tests | `src/lib/assessment/studio/pathway.test.ts` | 25 cases: every stage, every blocker, independence (author, reviewer who already decided, involved publisher), who-can-act with holders, without appointees, without grants, unreadable; the no-version identity; `latestReturn`. |
| Server loader | `src/lib/assessment/studio/pathway-data.ts` | `loadHolders` (hq_position_capability → ogs_office_appointments → profiles, as the framework workspace's `actorsFor`), `pathwayModel`, `pathwaySummary`, `pathwaySummaryByVersion`, `latestReturn`. `page-data.ts` now also returns the raw events and the involved people so the pathway reuses the page's one lifecycle read. |
| Studio panel | `src/app/super-admin/checklist-studio/_components/PathwayPanel.tsx` | Tracker, next action with the viewer's standing and a button that posts to the SAME transition route the LifecyclePanel uses, the prompt, the blockers, and a *Who can act?* drawer. `compact` form for lists. |
| Studio pages | checklist version workspace (above the tabs, "Record your decision" switches to Settings & Review), instrument version list (latest version's pathway + a *Next step* column per version; the identity's pathway when there is no version), scales, scoring templates, layout templates, progression rule sets | The `LifecyclePanel` keeps every action button and gained the anchor `#lifecycle`. |
| Reviewer side | `src/lib/assessment/studio/read.ts` `reviewOverview` (every version in review with need, involved people and the viewer's standing; `reviewQueue` is now the decidable subset of it), `review/page.tsx`, `DefReviewQueue.tsx` | *Needs your decision* first, then *Other versions in review*; each row: who submitted, what is needed, who can decide (by name), and *Independent* / *Not independent* with the reason. |
| Catalogue | `src/lib/assessment/catalogue/detail.ts` (`pathway: PathwaySummary` for the latest version or the identity, for the viewer), `PathwaySummaryCard.tsx`, `InstrumentView.tsx` (drawer and page), `ImportWizard.tsx` finish step (one card per registered draft from the register API's `pathways`), `TemplateDialog.tsx` finish step (`pathway` from the templates API) | The catalogue reads the Studio's pathway; it decides nothing and links into the Studio where the action is taken. |

No migration. No new table, column, capability or position.

## What the pathway says about independence

- The **author** (anyone in `authored_by`, `edited_by` or `submitted_by` of this or an earlier version, as `asmt_version_people` returns) can never approve, review or publish. The panel says so to the author in the first person and names who can.
- A **reviewer** who already decided on the exact content hash is no longer eligible for that kind of decision.
- When everyone appointed is involved in the content, the stage is **blocked** and the fix is "another appointee must act" — not a quiet empty list.
- A platform owner holds nothing without an appointment (`withOwnAppointments`), so the owner sees the same answer the database would give.

## Owner decisions

None required. One question for later: whether the registering person (import, template) should be told, before registering, that they will be the author and therefore cannot approve their own import. The finish step says it now; saying it on the Register step too is a copy change.

## Evidence

`docs/evidence/ASMT-PATHWAY-01/` — staging walk (owner fixture, staging project) with screenshots of: an imported draft showing *Submit v1 for review* with the named reviewers; after submission the panel naming who can approve and that the author cannot; a scale page pathway; the catalogue drawer summary; the import finish step; the review queue with independence; tablet width 820.
