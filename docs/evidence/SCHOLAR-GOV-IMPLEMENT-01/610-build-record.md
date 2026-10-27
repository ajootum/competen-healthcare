# COMPETEN-SCHOLAR-GOV-IMPLEMENT-01: build record (migration 610)

**Authority:** owner GO, 27 Oct 2026 (Scholar Governance Model V1, visual baseline `scholar-governance-model-v1.webp`).
**Branch:** `scholar/gov-implement-01`, off main `6a8ab176`.

## State of migration 610

| State | Status |
|---|---|
| 1. Authored | Done. Local rehearsal below. |
| 2. Applied and verified on staging ×2 | **Pending: coordinator.** The file is not in the PR until then. |
| 3. Merged into main | Not yet. |
| 4. Applied to production | **Not applied.** Needs its own owner GO. |

**sha256 of the file to stage:** `f4694830c56d3e2ea205f5ae9fcf7fc73ca27b0eba91688a564f6dc3d5d176ee` (LF, ASCII, 747 lines).

| Companion file | sha256 (first 8) |
|---|---|
| ROLLBACK-610.sql | 806c8e21 |
| VERIFY-610.sql | cdfe8dae |
| FINGERPRINT-610.sql | 3fad1de9 |
| LOCAL-ONLY-PROBES-610.sql (never on staging) | 9f4b9e52 |

**Application order and dependencies:** apply after 580. Depends on 040 (audit_log), 116/117 (ogs offices and appointments), 264 (positions, capabilities, grants), 281 (plat_product_line), 370/376 (individual_product_administrator), 395 (clinical_content_reviewer), 410 (platform_director AI rights), 500 (hq_actor_is_owner) and 580 (hq_capability_exclusions, last definition). A missing linked position is stored as no link (VERIFY then reports 4 or fewer linked seats instead of 5).

**Code on main without 610:** the screen says the registry is not available and draws no structure. Every write returns 503. Nothing else reads the new tables. No gate opens.

## What 610 adds

- **Tables (7):** `hq_gov_body`, `hq_gov_seat`, `hq_gov_seat_exclusion`, `hq_gov_seat_appointment`, `hq_gov_interest_declaration`, `hq_gov_delegation`, `hq_gov_link`. None has a capability column. The HQ guard reads none of them.
- **Guards (3 triggers):**
  - seat appointment, for every writer:
    - no director while the board is not incorporated, and no interim director;
    - one live record per seat, and one board seat per person;
    - an exclusive seat (the independent director) beside no other seat;
    - the seat-level independence pairs;
    - the 580 capability pairs across the person's live seats and active HQ appointments;
    - history only: never deleted, never rewritten once ended.
  - interest declarations: append-only.
  - delegations: only an established body delegates, and a withdrawn delegation never reopens.
- **Writers (4, owner-only, audit row first):** `hq_gov_admin_appoint`, `_end`, `_declare_interest`, `_set_delegation`. An interim or active record needs a lawful basis and a declaration of interests. An owner cannot record their own appointment.
- **Seed:**
  - 5 bodies;
  - 22 seats, all vacant: 5 board, 6 committee, the Product Lead and 6 portfolios, and the 4 IT functions;
  - 5 informational position links: Clinical Content Reviewer → clinical_content_reviewer, Clinical Governance Lead and Competency Framework Lead → quality_council_member, Scholar Product Lead → individual_product_administrator, Holdings Technology Authority → platform_director;
  - 1 seat independence pair;
  - 4 delegations: Holdings interim authority = interim, and three pending;
  - 13 workflow links, including the 5-step AI escalation path.
- **Unchanged:** every hq_position, grant, ogs appointment, framework, AI setting and flag.

## Local rehearsal (postgres:17, stub schema plus the real 116, 117, 264, 281, 500 and 580)

- **FINGERPRINT (tables, functions, triggers):** PRE 0 0 0 → apply #1 7 8 3 → apply #2 7 8 3 → ROLLBACK 0 0 0 → re-apply 7 8 3.
- **VERIFY:** 13/13 true after apply #2 and after re-apply.
- **Probes:** 30 behaviour probes, all as designed (`LOCAL-ONLY-PROBES-610.sql`):
  - refused: a non-owner, a missing reason, recording yourself, active without a basis or interests, a director before incorporation, an interim director, two board seats, an independent director beside another seat, reviewer plus clinical content operations, reviewer plus clinical governance lead (580 approve/govern), and an HQ Competency Author as committee reviewer (580 across the HQ appointment);
  - refused: one seat with two live records, a rewrite, a delete, a change to an ended record, an update to a declaration, approving the board's delegation, interim without a basis, and reopening a withdrawn delegation;
  - accepted: a nomination moving to active keeps one row and writes its declaration;
  - accepted: an external holder recorded by name;
  - a removed profile keeps the record and its holder name.
- **Side effects:** 10 audit rows were written, and no ogs appointment or grant was created.

## App checks

- **Vitest:** governance-model 13, governance route 6 and positions 15: 34/34.
- **Static:** `tsc` clean, eslint clean.
- **Harnesses, all green:** plane-boundary 35/0, hq-guard 51/0 (static sections), hq-nav-filter 30/0, hq-nav-registry 32/0, sidebar-active 15/0, access-scanner 22/0 and access-doors 39/0.
- **Not browser-verified:** that needs 610 on a database and an owner sign-in.

## Production steps (separate owner GO)

1. Record the recovery reference (OPS-001).
2. Run FINGERPRINT-610 and expect `0 0 0`.
3. Apply 610 whole and confirm its sha256.
4. Run FINGERPRINT-610 and expect `7 8 3`.
5. Run VERIFY-610 and expect 13/13 true.
6. The app needs no deploy order: the screen goes live when 610 is present.
