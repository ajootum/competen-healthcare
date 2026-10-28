# HQ-SOD-CROSSCUT-01 Governance Consolidation addendum — migration 641 build record

Owner addendum, 28 Oct 2026: few configurable role types, unlimited authorised holders, flexible responsibilities,
mandatory independent decisions. Extends 640, which stays exactly as staged.

| State | Status |
|---|---|
| 1. Authored | Done. Local rehearsal below. |
| 2. Applied and verified on staging ×2 | **PASS 28 Oct** (coordinator): FINGERPRINT 0→7|4|3|5|1 ×2, VERIFY-641 9/9 (row 7 true), VERIFY-640 13/13, rollback 0 with 640 intact, re-applied. See 640-staging-record.md. |
| 3. Merged into main | Not yet. |
| 4. Applied to production | **Not applied.** The owner applies it by hand, after 640. |

**sha256 of the file to stage:** `1fd79b6a5c30137f09eaf6b655df4b87ec0a52637cd62330ed87257fabf5ba95` (LF, ASCII, 445 lines).
Companions: ROLLBACK-641 `b2b88fad`, VERIFY-641 `92945a68`, FINGERPRINT-641 `6d817f46`.

**Application order.** After 640. Needs 440, 451, 462, 510 and 620 (all in production). Additive, idempotent,
appoints nobody, changes no existing appointment.

## What was measured before building

- **One holder per position or office:** none in the schema. `ogs_office_appointments` has no unique index or
  constraint (116/117/281/287). The HQ appointments route refuses only the same person twice in the same position.
  The board lists every holder. So many-to-many already held; 641 adds rules, not capacity.
- **610/620 seats:** one live record per seat (610 guard). Seats are capability-free governance records (board,
  committee, portfolio) and never cap HQ position holders. Left unchanged: board composition and committee
  voting stay with their legal documents and terms of reference.
- **Capability resolution through appointments in the database:** five functions (440 `ckri_holds_capability`,
  451 `individual_holds_capability`, 462 `learning_holds_capability`, 510 `competency_appointment_holds`, 620
  `hq_gov_studio_can_edit`) and the inline check in the 461 decision guard. All are narrowed by 641.
- **Independence across appointments:** 640's guards already evaluate the PERSON. 395's unique index allows one
  decision per reviewer per version, so two appointments never give two approvals.

## Local rehearsal (postgres:17, stub plus the real 076 … 620 and 640)

- FINGERPRINT-641: PRE `0|0|0|0|0` → apply #1 `7|4|3|5|1` → apply #2 same → ROLLBACK `0|0|0|0|0` → re-apply same.
- VERIFY-641 9/9 after apply #2 and after re-apply. VERIFY-640 13/13 throughout, including after the 641 rollback.
- 451 and 510 apply only partially on the stub (tenant tables absent). Their holds-capability functions, the only
  parts 641 touches, were exercised (641 redefines them, the rollback restores their exact bodies).
- **Probes (`LOCAL-ONLY-PROBES-641.sql`): 36 pass, 0 fail**, 4 red-proofs:
  - appointment independence: no authoriser refused (red-proof), self-appointment refused even for the owner,
    non-owner authoriser refused
  - broad role: an unscoped Scholar lead appointment refused, a scope naming a capability the position lacks refused
  - multiple holders: three people hold Scholar Clinical Lead with different scopes; one primary only; Ben carries
    approval, Cat holds the same role and does not
  - multiple appointments: Ann also holds Clinical Content Reviewer; Dan too (no maximum set)
  - self-widening of an appointment scope refused (red-proof); a change riding on an old stamp refused
  - rules: non-owner refused, maximum below live holders refused, primary not_used refused while a primary exists,
    owner caps at 3, fourth holder refused, audit rows written for the rules and every appointment
  - overlapping scopes: Ann approves under one appointment, a second approval under her other appointment refused;
    Cat (role held, approval not carried) refused (red-proof); Ann's own content refused under either appointment;
    Cat without governance cannot grant a scope
  - term: end before start refused, a lapsed term carries nothing though its status is active
  - ending clears the primary flag; every appointment and decision row kept

## App code (same PR)

Resolver and door narrow each appointment by its scope and term (fail-soft to today's behaviour before 641).
Appointments screen: scope picker, primary designation, holders against an optional maximum, a missing required
primary shown. Route: POST stamps the authoriser and takes scope/primary; PATCH `set_scope` / `set_primary`,
owner only, never your own appointment. Positions screen: appointment rules (maximum, primary policy, scoped
appointments, product line). Reviewer lookups count only appointments that carry approval today. 13 staging
harness scripts stamp their fixtures (`scripts/_hq-fixture-authority.ts`).
