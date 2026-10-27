# COMPETEN-SCHOLAR-GOV-IMPLEMENT-01: build record (migration 610, Model V1 + Addendum V1.1)

**Authority:** owner GO, 27 Oct 2026 (Scholar Governance Model V1, baseline `scholar-governance-model-v1.webp`), and owner Addendum V1.1 of the same day (baseline `scholar-governance-model-v1.1.webp`).
**Branch:** `scholar/gov-implement-01`, off main `6a8ab176`.

V1.1 was folded into the same unstaged 610 before any staging run. The V1 bytes (sha256 `f4694830…`) were never applied anywhere except the local rehearsal, and they are superseded.

## State of migration 610

| State | Status |
|---|---|
| 1. Authored | Done. Local rehearsal below. |
| 2. Applied and verified on staging ×2 | **Pending: coordinator.** The file is not in the PR until then. |
| 3. Merged into main | Not yet. |
| 4. Applied to production | **Not applied.** Needs its own owner GO. |

**sha256 of the file to stage:** `ba7873e61f364ee23157e65deca3e29fd436cec69cbb2cfcb045ace083672a12` (LF, ASCII, 896 lines).

| Companion file | sha256 (first 8) |
|---|---|
| ROLLBACK-610.sql | c1a9acce |
| VERIFY-610.sql | 283e5d05 |
| FINGERPRINT-610.sql | ba4c539b |
| LOCAL-ONLY-PROBES-610.sql (never on staging) | abd5a53a |

**Application order and dependencies:** apply after 580. Depends on 040 (audit_log), 116/117 (ogs offices and appointments), 264 (positions, capabilities, grants), 281 (plat_product_line), 370/376 (individual_product_administrator), 395 (clinical_content_reviewer), 410 (platform_director AI rights), 500 (hq_actor_is_owner) and 580 (hq_capability_exclusions, last definition). A missing linked position is stored as no link (VERIFY then reports fewer than 5 linked seats).

**Code on main without 610:** the screen says the registry is not available and draws no structure. Every write returns 503. Nothing else reads the new tables. No gate opens.

## What 610 adds

- **Tables (8):** `hq_gov_body`, `hq_gov_seat`, `hq_gov_seat_exclusion`, `hq_gov_seat_appointment`, `hq_gov_interest_declaration`, `hq_gov_delegation` (with `relation`), `hq_gov_link` (with `clearance_domain`) and `hq_gov_status_item`.
  - No body, seat or appointment table has a capability column. The HQ guard reads none of them.
- **Guards (3 triggers):**
  - seat appointment, for every writer:
    - no director while the board is not incorporated, and no interim director;
    - one live record per seat, and one board seat per person;
    - an exclusive seat (the independent director) beside no other seat;
    - the seat-level independence pair;
    - the 580 capability pairs across the person's live seats and active HQ appointments;
    - history only.
  - interest declarations: append-only.
  - relationships:
    - only an established body delegates;
    - a withdrawn relationship never reopens;
    - the bodies, scope and relation never change.
- **Constraints added by V1.1:**
  - a service body has no level, and every other body has level 1 to 3;
  - a clearance with no product workflow carries a note, and every routed link names a capability;
  - a status item is `verified` only with written evidence and a named decider.
- **Writers (5, owner-only, audit row first):** `hq_gov_admin_appoint`, `_end`, `_declare_interest`, `_set_delegation` and `_set_status_item`.
- **Seed (V1.1):**
  - **Bodies (5):** Holdings (L1), Board (L1, proposed and not incorporated, draft SHA-001), Committee (L2), Product and Operations (L3), and **Holdings Technology Services** beside the levels (no level, configured, PGC mandate unverified).
  - **Seats (21), all vacant:** 5 board, 6 committee, the Product Lead and 6 portfolios, and the 3 Holdings technology functions. The **Scholar Technology Liaison / Product Technology Lead** is the Product and Technology portfolio, with no linked position and an explicit no-privilege description.
  - **Relationships (7):**
    - Holdings interim authority (interim);
    - Product Lead to corporate authority (corporate reporting, pending);
    - Board to Committee and Committee to Product (specialist oversight, pending);
    - Holdings to Technology Services (mandate, pending);
    - Technology Services to Product (service, pending);
    - Committee and Technology Services (joint review, pending).
  - **Links (20):**
    - 13 workflow and AI escalation links;
    - 7 joint clearances. Scholar: clinical safety (enforced by 395/466), educational suitability and product acceptance (no product workflow). Holdings: technical eligibility (enforced by 410), architecture (code review and CI), cybersecurity (security operations view) and production release (owner GO only).
  - **Status register (5), nothing verified:** Board proposed, PGC mandate unverified, technical appointments pending, recovery capability unverified (with its evidence and residual risk), and paid backup/PITR deferred (owner decision of 23 Oct).
- **Unchanged:** every hq_position, grant, ogs appointment, framework, AI setting and flag.

## Local rehearsal (postgres:17, stub plus the real 116, 117, 264, 281, 500 and 580)

- **FINGERPRINT (tables, functions, triggers):** PRE 0 0 0 → apply #1 8 9 3 → apply #2 8 9 3 → ROLLBACK 0 0 0 → re-apply 8 9 3.
- **VERIFY:** 17/17 true after apply #2 and after re-apply.
- **Probes:** 39, all as designed (`LOCAL-ONLY-PROBES-610.sql`). V1.1 adds 9 of them:
  - refused: verified without evidence, by function and by direct update;
  - refused: a non-owner status change;
  - accepted: an owner status change is audited;
  - refused: a relation change;
  - the Technology Authority mandate can be approved by the established Holdings, but only with a basis;
  - refused: the joint-review bridge while the Committee is not established;
  - refused: the body level rules and the link route rules.
- **Defect found by probe P37 and fixed before staging:** a non-service body with a NULL level passed the level CHECK. The CHECK now requires `level is not null`.

## App checks

- **Vitest:** governance-model 17, governance route 6 and positions 15: 38/38.
- **Static:** `tsc` clean, eslint clean.
- **Harnesses (V1 run, unchanged since):** plane-boundary 35/0, hq-guard 51/0, hq-nav-filter 30/0, hq-nav-registry 32/0, sidebar-active 15/0, access-scanner 22/0 and access-doors 39/0. V1.1 touched no gate, route, plane or nav.
- **CI on the V1 commit e30ecd68:** 8/8 green.
- **Not browser-verified:** that needs 610 on a database and an owner sign-in.

## Production steps (separate owner GO)

1. Record the recovery reference (OPS-001). Note that the 27 Oct 20:30 backup failed, so take a fresh good backup first.
2. Run FINGERPRINT-610 and expect `0 0 0`.
3. Apply 610 whole and confirm its sha256.
4. Run FINGERPRINT-610 and expect `8 9 3`.
5. Run VERIFY-610 and expect 17/17 true.
6. No deploy ordering is needed.
