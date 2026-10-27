# COMPETEN-SCHOLAR-GOV-IMPLEMENT-01 Addendum V1.2: build record (migration 620, Organisation & Governance Studio)

**Authority:** owner Addendum V1.2, 27 Oct 2026 (`ADDENDUM-V1.2.md`). Extends 610, which is applied in production. 610 is not edited.
**Branch:** `scholar/gov-studio-01`, off main `3dd4d8c6`.

## State of migration 620

| State | Status |
|---|---|
| 1. Authored | Done. Local rehearsal below. |
| 2. Applied and verified on staging ×2 | **Pending: coordinator.** The file is not in the PR until then. |
| 3. Merged into main | Not yet. |
| 4. Applied to production | **Not applied.** Needs its own owner GO. |

**sha256 of the file to stage:** `c890deba6a9baf1ed7105d41e0cd4ef2fc494d33d4c7990924311cde59617ae6` (LF, ASCII, 904 lines).

| Companion file | sha256 (first 8) |
|---|---|
| ROLLBACK-620.sql | 1cb2c765 |
| VERIFY-620.sql | 72e0461b |
| FINGERPRINT-620.sql | d0c17006 |
| LOCAL-ONLY-PROBES-620.sql (never on staging) | e97d0264 |

**Order and dependencies:** apply after 610. Depends on 610, 500 (hq_actor_is_owner and the grant guard), 511 (whose `hq_capability_sensitive_class` it replaces, with one code added), 281, 264 and 116/117.

**⚠ CI is red until 620 is in the PR, by design.** The code catalogue gains `hq.platform.governance.manage`, so hq-guard D1/D2 (DDL vs code) and the sensitive-class test in `positions.test.ts` need 620 in the tree. With 620 present they are green (checked). Without it they are red (checked: D1 74 vs 75, D2, and 1 test). The coordinator commits 620 after staging, as with 610.

**Code on a database without 620:**
- The Studio and History pages say they are unavailable, and Studio writes answer 503.
- The governance page stays exactly the V1.1 board: its 620 reads are optional and ignored when they fail.

## The gate (the smallest safe one)

- **Edit:** open and edit a draft, submit, return, discard, and add a relationship type.
  - Allowed for an owner, or a holder of the new `hq.platform.governance.manage` through an active HQ appointment.
  - The capability is granted to **no position**. It is platform-sensitive, so a grant needs the 500 acknowledgement (probe S22).
  - The Studio page is declared in `HQ_ROUTE_INTENT` on that right, above `/super-admin/users`.
- **Approve, publish, create a structure:** platform owner only, in the route and in the database.
- **Self-approval:** an owner approving a version they also edited or submitted is recorded as `self_approved` and shown. A second-owner rule is an open owner decision.
- **History:** readable by `hq.platform.users.view` at `/super-admin/users/governance/history`.

## What 620 adds

- **`hq_gov_structure`:** one governance context per product line. Scholar = `individual`. Other product lines get their own structure, created by the owner.
- **`hq_gov_structure_version`:** the whole structure (levels, units, positions, relationships, links, independence pairs) as one definition.
  - **Lifecycle:** Draft → Review → Approved → Published → Superseded. A draft or a review can be discarded.
  - **One open version** per structure, and a **revision** number refuses stale saves.
  - **The guard trigger:**
    - only a draft changes;
    - a published version only becomes superseded, with its definition, title and date unchanged;
    - superseded and discarded versions never change;
    - nothing is deleted.
- **Publication projects the version into the 610 tables:**
  - Every 610 constraint and guard applies, so a version that breaks one does not publish (atomic).
  - Submit and approve run the same projection as a rolled-back dry run, so a broken version cannot even reach review.
  - Projection refuses removal: published items must be retired. It also refuses retiring a position with a live record, a retired unit holding active positions, an inactive relationship type, a code owned by another structure, an undefined level, and a unit inside itself.
  - New relationships are always **pending**. Existing ones keep their status and decisions, and their units, type and scope never change.
- **`hq_gov_relation_type`:** configurable relationship types (8 seeded: interim authority, corporate reporting, mandate, delegation, specialist oversight, escalation, shared service, joint review). `hq_gov_delegation.relation` now references it.
- **610 tables:**
  - version columns: `introduced_version_id`, `retired_version_id` and `is_active` where it was missing;
  - `hq_gov_seat.appointment_requirements`, and `hq_gov_body.structure_code`;
  - wider unit kinds (department, portfolio, unit), position kinds (position, member) and levels (1 to 9). A service still has no level.
- **History ties:**
  - an appointment stamps the version in force (trigger), and a relationship decision stamps `decided_version_id`;
  - earlier rows carry null, which means version 1, the only structure before 620. Nothing is re-pointed.
- **Seed:** the Scholar structure, and the live 610 content as **version 1, published, effective 27 Oct 2026**: 5 units, 21 positions, 7 relationships, 20 links, 1 pair and 3 levels. Holdings Technology Services keeps no level, every vacancy stays, the Holdings interim authority stays interim, and the status register is untouched.
- **Unchanged:** every appointment, decision, grant, framework, AI setting and flag. Nobody is appointed.

## Local rehearsal (postgres:17, stub plus the real 116, 117, 264, 281, 500, 580, 610 and 620)

- **FINGERPRINT (tables, functions, triggers, columns):** PRE 0 0 0 0 → apply #1 3 15 3 8 → apply #2 3 15 3 8 → ROLLBACK 0 0 0 0 (610 still 8 9 3, VERIFY-610 17/17) → re-apply 3 15 3 8.
- **VERIFY-620:** 12/12 after apply #2 and after re-apply.
- **Acceptance probes (`LOCAL-ONLY-PROBES-620.sql`), all as designed:**
  - An editor holding the capability through a test position and appointment opens a draft of Scholar. A user without it is refused, and so is a second open draft and a stale revision.
  - The editor adds the department "Scholar Quality Office" and a vacant position in it with appointment requirements, moves Finance and Administration into it, renames Student Success, and adds a pending escalation relationship.
  - Removing a published position instead of retiring it is refused at submit. Restoring it lets the draft through.
  - Submit works. Submitting again, editing during review, and approval by the editor are all refused. The owner approves (not self-approved). Publishing by the editor, or without a basis, is refused. The owner publishes v2, effective 1 Nov 2026.
  - **Live structure = v2**: the new department (introduced by v2), the moved and renamed positions, and the escalation relationship pending.
  - **History:** v1 is superseded with its definition intact (still "Student Success"). Rewriting either version, and deleting a version, are refused.
  - The nomination recorded under v1 still records v1. A new one records v2, and a relationship decision records v2.
  - Retiring a position with a live record is refused at submit. The draft is discarded and the live structure stays v2.
  - A second structure (Enterprise, owner-only) cannot take a Scholar unit code.
  - Relationship types: the editor can add one, and a user without the capability cannot.
  - Granting the capability without the sensitive acknowledgement is refused.
- **Defect found by a probe and fixed before staging:** submit on a version already in review was accepted as a no-op. Each lifecycle action now checks its source state.

## App checks

- **Vitest (HQ and HQ API, 11 files):** 105/105, including governance-studio 12 (with a definition-level acceptance scenario) and the studio route 6.
- **Static:** `tsc` clean, eslint clean.
- **Harnesses, with 620 in the tree, all green:** plane-boundary 35/0, hq-guard 51/0 (I6: the Studio page and the intent map agree), hq-nav-filter 30/0, hq-nav-registry 32/0, sidebar-active 15/0, access-scanner 22/0 and access-doors 39/0.
- **Not browser-verified:** that needs 620 on a database and an owner sign-in.

## Production steps (separate owner GO)

1. Take a fresh good backup first: the 27 Oct 20:30 run had failed.
2. Run FINGERPRINT-620 and expect `0 0 0 0`.
3. Apply 620 whole and confirm its sha256.
4. Run FINGERPRINT-620 and expect `3 15 3 8`.
5. Run VERIFY-620 and expect 12/12 true.
6. Deploy the app after 620. The app is safe before it too, with the Studio unavailable.
