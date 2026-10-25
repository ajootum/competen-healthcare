# ADR-017 — Competen Learning is a Holdings shared service: shared content, a personal record, and a sibling course ledger

**Status:** Accepted · 2026-10-25. The owner approved discovery options C (D1) and E2 (D2) in the COMPETEN-LEARNING-01 Phase 2 GO, and directed that the shared-service boundary be recorded here with ADR-016 preserved.
**Satisfies:** COMPETEN-LEARNING-01 Phase 2 decisions D1–D8, and the Competen Learning Consolidated Product Definition §2, §9, §12 and §22.
**Supersedes:** nothing. **ADR-016 is unchanged**: its D1 isolation rule and gate 3 stand exactly as written.
**Enforced by:**
- Migrations 460–464 (`supabase/migrations/46[0-4]-*.sql`)
- `src/lib/learning/*` and its tests
- `scripts/individual-foundation-harness.ts` (unchanged and green)
- `scripts/hq-guard-harness.ts`
- `scripts/learning-acceptance-harness.ts` (database, staging)
- Discovery: `docs/COMPETEN-LEARNING-01-phase1-discovery.md` §2

---

## The question

Learning has to serve Professional, Scholar and later Enterprise from **one** catalogue and **one** personal learning record. ADR-016 D1 says Individual data must never sit in tables hospital analytics read, and the foundation harness (3a) bars Individual code from the estate learning tables. The estate learning tables are also thin (discovery §1). Separately, course access must not require a Scholar or Professional subscription, and the experience ledger that gate 3 reads is CHECK-limited to those two experiences.

## Decision

1. **Learning content is Holdings-owned shared content.**
   - It lives in the 460 catalogue: `learning_provider`, `learning_offering`, `learning_offering_version` and `learning_offering_version_outcome`.
   - These tables are global, carry no `hospital_id` and hold no personal data. They are service-role only: RLS is on with no policy.
   - They follow the case-library pattern (422): versions are hashed and frozen from submission. Hosted learning is approved by the one 395 clinical-approval process (461, content kind `learning`). Publication is a separate act by someone who wrote nothing of the version.
   - Any product may read **published, deliverable** content through the Learning service (`learning_offering_deliverable`). No organisation-owned learning row is read or widened.
2. **The personal learning record is a Holdings record, and it is personal data under ADR-016 D1.**
   - It covers `learning_record` with its activity, check attempts and certificates (462).
   - Rows are keyed by `user_id`, with own-row read policies and service-role writes.
   - **No estate analytics module reads these tables.** Professional, Scholar and the Passport reference them through `src/lib/learning/products.ts` and copy nothing.
   - Enterprise (P1, D4) may see only records created under its own assignment or funding, through a link this ADR leaves to that work. It never gets a general read.
3. **Course access is a sibling ledger on the existing commercial engine.** This is E2.
   - `individual_course_entitlement` sits beside `individual_entitlement`, which is **not** widened.
   - A course checkout is a row of the same `individual_checkout` table, with `item_kind = 'course'`. It copies an approved `learning_offering_price` exactly.
   - It settles through the same Holdings engine (`src/lib/commerce/settlement.ts`): three checks, and an idempotent delivery log.
   - It uses its own `lrn-` reference and adapter. The Individual experience adapter never sees it.
   - One checkout opens at most one entitlement (unique `checkout_id`).
4. **Gate 3 is unchanged.**
   - A course-only member is an ordinary active member with no live experience. The `(app)` layout already admits them.
   - The member-only Learning area (`/individual/(app)/learning`) needs no experience. The `[experience]` routes stay experience-gated.
   - Membership still comes only from the HQ invitation: public purchase registration stays off (D5), and course settlement never creates a membership.
5. **Authority is position-based and separated** (D8, 464).
   - Authoring, publication, price approval and certificate issuance are four capabilities, each held by a new position. Clinical approval is the existing `hq.quality.clinical.approve`.
   - Nothing is granted to an existing position.
   - The database re-checks independence for every one of them. It also re-checks the capability for price approval and certificate issuance.

## Consequences

- No change to ADR-016, to `individual_entitlement`, to `individual_plan`, to `individual_live_entitlement`, to the estate learning tables, or to the foundation harness.
- The experience registry does not change: Learning is not a third experience.
- Shared contracts touched, each kept byte-compatible:
  - the 395 review guards. 461 carries 422's and 442's branches unchanged and must be applied after 442.
  - the shared payment webhook: one more dispatch branch, guarded by `learning_commerce`.
  - the HQ capability catalogue and route map (`src/lib/hq/spaces.ts`).
- Professional, the Passport and the Individual home page integrate by **reading** `products.ts`. Their renderers are owned by their workstreams, and the hand-off is in `docs/COMPETEN-LEARNING-01-phase2-build-record.md` §6.
- Production stays dark. `learning_app` and `learning_commerce` are absent unless written, no migration writes them, and real charging needs a separate owner GO.
