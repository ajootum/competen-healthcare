# C5 Verification Studio: staging acceptance, §15 items 17–22 (25 Oct 2026)

**Owner GO:** COMPETEN-PROFESSIONAL-COMPETENCY-01, focused staging acceptance.

**Owner decisions:**
- **Option A:** IND-007 creates two labelled synthetic identities, and the owner appoints them.
- **M1:** IND-007 grants staging gate-1 platform membership, and revokes it at retirement.

**Staging only** (ezhvpgtcqcdsgylrxgdb). Nothing was done in production.

**Run by:** `scripts/staging-c5-verification-acceptance.ts`. It ran over HTTP against a staging-pointed dev server on 3100, built from this branch. The identities acted with their own sessions, through `hqApiGate`, the real routes and 510's triggers.

## Identities

| Identity | Profile | Appointed by the owner (staging HQ board) | Gate 1 (M1) |
|---|---|---|---|
| SYNTHETIC C5 studio administrator (IND-007, staging, retire after), `c5-studio-admin@staging.competen.invalid` | f184e0bf-953f-41e1-8403-fe1368ead3b8 | competency_verification_administrator, appointment 45136bde (20:09:40Z) | b537855e |
| SYNTHETIC C5 assessor (IND-007, staging, retire after), `c5-assessor@staging.competen.invalid` | 61acd47e-cb51-4595-be56-2d6a92455624 | competency_assessor, appointment 836c73f2 (20:09:56Z) | 63105027 |

- **Requester:** the portfolio workstream's synthetic member `harness-prof05-requester@competen.test` (df8503a0). Its CPD entry was 512722cc.
- **Competency:** CF-CR-001, "Gathers and interprets clinical information systematically" (CF-FOUND, published, three outcomes).

## Results

| # | Item | Result |
|---|---|---|
| 17 | Configure an assessment method in the no-code Studio | **PASS** on content. The method was created, saved and published, its criteria fixed by hash (v1 `996f4529…`). |
| 17b | The Studio Administrator opens the Studio and not the assessor queue | **PASS** (the queue answers with a streamed redirect to /dashboard) |
| 17c | The Competency Assessor opens the assessor queue and not the Studio | **PASS** (the Studio answers with a streamed redirect to /dashboard) |
| 18 | Appoint and scope a narrowly scoped synthetic assessor through the authorised controls | **PASS.** The owner appointed. The Studio scoped one competency, one method and a highest level. The assessor's attempt to scope itself was refused. |
| 19 | Request and undertake a governed verification | **PASS.** The request was submitted in the portfolio's hand-over shape (outcome words, plus the CPD entry linked to the first outcome). The Studio assigned it, and the assigned assessor decided it from their own queue. |
| 20 | Self-verification is refused | **PASS.** Refused by the route (403), by assignment, and by the database for a direct service-role decision ("no self-verification"). |
| 21 | The decision is recorded with criteria, evidence and assessor provenance | **PASS.** It carries the method version and its hash, the competency content hash, both criteria, the evidence reviewed, the assessor and their appointment, and its validity. It is audited, with the actor being the assessor. |
| 22 | Verification history stays intact | **PASS.** The decision cannot be rewritten or deleted. Revocation is a new event. Publishing v2 retired v1, and the decision keeps v1's pinned hash. The person's reader shows the decision as "revoked". |

**The first run's item 17 FAIL was a defect in my check, not in the door.** The check read "the assessor cannot open the Studio" from the HTTP status. When a page's `redirect()` is thrown after streaming starts, the response is HTTP 200 with the redirect in its body, so the status cannot say whether the page opened. The script now reads a page's door from its content (`--doors`).

**Planted defect:** with the Studio page gated on `assess`, 17b and 17c went **RED**. With the file restored byte-identical, they were **GREEN**.

## Retirement

- **Scopes:** all three ended through the Studio route (HTTP 200) and are kept as history.
- **Gate-1 memberships:** both revoked. No route revokes a membership, so this was a labelled direct update, the reverse of M1.
- **Sessions:** revoked before the ban. Both identities are banned and kept, and sign-in is refused.
- **Appointments:** ending one is the owner's control (`/api/hq/appointments` PATCH, owner only). Both were ENDED on the staging board through the owner-only "Set status → Ended" control, by the coordinator at the owner's instruction. Both are now `removed`.
- **Final check, read-only:**
  - both appointments `removed`;
  - both memberships `revoked`;
  - both identities banned to 2126-10-01;
  - 0 live scopes;
  - `individual_holds_capability` is false for both rights, for both identities.
- **A misreading, corrected:** I first reported that the board wrote `term_end` earlier than the start. It did not. `term_start` and `term_end` are DATE columns, and both appointments hold 2026-10-25 (read raw on staging by the coordinator, server TimeZone UTC). The "2026-10-24 21:00 UTC" came from my read-only script's database driver, which turned the date into a local (UTC+3) midnight timestamp. Nothing is wrong on the board.
- **Staging dev server:** stopped after the run.

## Rows created (all kept as the record)

| Table | Rows |
|---|---|
| profiles / auth.users | 2 (above) |
| platform_membership | 2, revoked (b537855e, 63105027) |
| ogs_office_appointments | 2 (45136bde, 836c73f2), ended (`removed`) on the owner's board control |
| competency_verification_method | 1: `c5_synthetic_ecg_observation` (c0c34dd2) |
| competency_verification_method_version | 2: v1 e1ff841e retired, v2 d86827b2 published (labelled synthetic, staging only, left published at the coordinator's instruction unless the owner says otherwise) |
| competency_assessor_scope | 3 (competency, method, max_level), ended |
| competency_verification_request | 2. 3c80b70c by the requester: verified at level, then revoked. 52a1c3d9 is the assessor's own self-verification probe: withdrawn. |
| competency_verification_evidence | 1 (cpd, fa54f2e9) |
| competency_verification_event | 3 by them (assigned, withdrawn, revoked) |
| competency_verification_decision | 1 (b8cdcffe: verified_at_level, class verified, revoked) |
| audit_log | 14 (create, save, draft, 2 publish, 3 grant_scope, assign, decide, revoke, 3 end_scope) |

The requester (df8503a0) belongs to the portfolio workstream, which deletes it. Its request, evidence, events and decision go with it by cascade.
