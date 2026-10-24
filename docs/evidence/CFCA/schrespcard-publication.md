# SCH-RESPCARD: staging publication record

**Authority:** owner GO, pasted directly in the IND-007 session on 2026-10-24: "GO to publish the respiratory and cardiovascular catalogue (SCH-RESPCARD)". Staging only (ezhvpgtcqcdsgylrxgdb). Production does not have migration 394 and is not part of this GO.

**What was published:** SCH-RESPCARD, "Scholar: Respiratory and Cardiovascular", framework 00d87240-17c1-499f-9829-be799c52f4a6.
- A shared framework, layer profession (Nursing), with no competencies of its own.
- It names 6 existing competencies, all in the committed production export, so nothing is copied:
  - Core Nursing's Airway, Breathing and Circulation competencies;
  - the three Oxygen Therapy competencies under CPU-OXYSAFE-001 (PRA-OXY-001).
- **Every entry is "unreviewed"**, with the note "Staging seed: not clinically reviewed. Chosen by practice code and domain name, not by a clinician." Publication is governance of what the catalogue names. It is not a clinical review of the content.

**How:** the existing governed lifecycle, over HTTP, on the staging dev server running this branch. There was no direct write to `frameworks`.

| Step | Route | Result |
|---|---|---|
| submit for review | PATCH /api/content/lifecycle submit_review (submitter) | 200; content_approvals 861e2c9d |
| self-approval control | PATCH /api/content/review approve (submitter) | **403 refused** |
| independent approval | PATCH /api/content/review approve (reviewer) | 200; approved |
| publish | PATCH /api/content/lifecycle publish (submitter) | 200; version 1 (framework_versions b7974100) |

- **Audit:** submit_review 3d781cde, approve_content f10fb198, publish 13136acc.
- **Approval:** submitted_by aee89277 differs from reviewed_by bfa5b987, so the approval was independent.

**After publication:**
- The version snapshot records `catalogue_entries`: 6, all unreviewed.
- A status change on an entry is refused by the 394 trigger, so the entries are frozen.
- `controlled-catalogue-acceptance` passes 14/14.
- SCH-RESPCARD is in **no** Individual allowlist, so nothing reaches a person until HQ chooses it.

**Temporary identities:**
- Two synthetic staging super-admins: schrc-submitter and schrc-reviewer @staging.competen.invalid.
- Retired after the run: roles cleared, no platform membership, no appointments, banned until 2126, sessions revoked globally.
- They are kept, not deleted, so the approval and audit rows that name them stay intact.
