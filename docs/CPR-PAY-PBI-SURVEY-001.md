# CPR-PAY-PBI-SURVEY-001 — Payment-before-invoice, measured

**Date:** 2026-08-16 · **Asked by:** the owner ("survey the payment-before-invoice question"), raised
while assessing which offline capture entity could follow the completed measurements → encounters →
follow-ups arc. The motivating case: **cash collected in the field** during a home visit, with no
connection — a genuine loss surface in a cash economy, and the one finance fact that can vanish with
the network the way an unrecorded reading could.

**What was measured:** the deployed billing estate (migrations 303/304, `src/lib/practice/billing.ts`,
the allocation constraints in the live schema) and the two governing specs
(`CPR-PAY-001`, `CPR-PAY-002`, both re-read from ~/Downloads for this survey). No code was changed and
no migration is attached — this is a decision document.

---

## 1. THE FINDING FIRST: "payment-before-invoice" is three different questions, and one is already answered

The phrase bundles three shapes that have nothing in common except the missing invoice:

| Shape | What happened | Deployed answer |
|---|---|---|
| **1. Paid for work done, not yet invoiced** | Patient hands over cash for today's consultation; no invoice was ever raised | **ALREADY SUPPORTED.** A payment allocates to a **charge** directly — no invoice anywhere |
| **2. Paid before any recorded work** | Deposit / advance for a future procedure; money on account | **REFUSED BY DESIGN**, at the engine AND the schema. Building it is its own arc |
| **3. Paid more than was due** | Overpayment surplus that would need somewhere to sit | **REFUSED BY DESIGN** — same machinery as shape 2 |

The decisive sentence is PAY-002's own summary (spec, closing section): *"service/charge records
establish **what is due**; invoices **communicate** what is due; payments record what was actually
paid."* An invoice is a communication, not a precondition of owing. The deployed model matches the
spec exactly — which means the offline cash question mostly dissolves into shape 1, which needs **no
new financial semantics at all**.

## 2. The deployed model, measured

**A payment must point every unit somewhere — but "somewhere" includes an uninvoiced charge.**
`recordPayment` (`billing.ts:417`) refuses an allocation total that mismatches the payment
(`ALLOCATION_MISMATCH`, s20) and accepts allocation targets of two kinds: an **ISSUED invoice**
(drafts "not yet owed", voids "never were") or a **charge**, checked only for existence and currency
(`billing.ts:458-462`). The schema enforces the same floor: `practice_allocation_target_check`
(migration 303) — `invoice_id is not null or charge_id is not null`. **An unallocated payment cannot
exist in this database.** That constraint is the hard boundary of the whole question.

**Charges do not need an encounter, an invoice, or a fee.** `createCharge` (`billing.ts:159`) takes
`source: consultation|procedure|report_document|manual`, an optional encounter (validated when named,
never required), an optional fee (snapshotted, overridable with a reason), or a bare manual
description + amount. Charging "does not read the encounter's STATUS at all" — financial judgement,
never a clinical gate (s6).

**The credit/unapplied feature is deliberately absent, and the specs say so in as many words:**
- PAY-001: *"Payment allocations must reconcile to the payment amount **unless an explicit unapplied
  balance feature is implemented**."* — named as a feature that does not exist, not an oversight.
- PAY-001 (overpayment): *"requires explicit handling/credit/refund rule."*
- PAY-002: *"Overpayment requires a governed credit/refund/unapplied-balance rule; **do not silently
  create negative balances**."*
- The engine honours all three: `OVERPAYMENT` refusal at `billing.ts:457` ("overpayment needs an
  explicit credit or refund, not a silent surplus").

**Receipt numbering is server-side and atomic with the payment.** `recordPayment` allocates
`CP-RCT-YYYY-NNNNN` via the `practice_next_billing_number` RPC and **deletes the payment** if
numbering or the receipt snapshot fails (`billing.ts:492-526`) — a payment without a receipt cannot
be reported as recorded. Voided numbers are never reused. This is the one part of the model that
**cannot move onto a device**, for the same reason offline document issuance was ruled out: devices
allocating official numbers unseen is a collision and fraud surface.

**Neither PAY spec mentions offline at all.** Zero matches for offline/connectivity in PAY-001. The
offline question is CP-OFFLINE-SURVEY-001's to govern, and its rules (capture screen + applier
together, same write path as online, refuse at the bedside in the server's words) apply unchanged.

## 3. Shape 1 offline: the "field collection" entity — what it would actually take

A capture of *"I took N from patient P for service S, at time T"*, filed at sync as **charge +
payment against that charge**, through `createCharge` and `recordPayment` — the same write path the
online product uses. Sketch, following the three shipped entities:

- **Capture screen** (fourth sanctioned producer on `/practice/offline`): patient (from the cached
  set), what for (description), amount + currency, method (cash/mobile money vocab), when collected
  (device time, required, never defaulted). Refusals at the bedside in the applier's sentences.
- **Applier**: welds actor (`ctx.userId`), correlation (`tx.id`), collector (`"practitioner"` — a
  device cannot claim the facility collected), and `paidAtIso` from the device. Wraps a
  `fileOfflineCollection` in `offline-filing.ts` that calls `createCharge` then `recordPayment`
  allocated fully to that charge.
- **Idempotency**: device-minted entityId becomes the **payment row id** (the follow-up pattern —
  `recordPayment` gains an optional `id`, exact primary-key replay). The charge side rides the same
  guard: replay finds the payment, done. Crash between charge and payment: retry finds no payment,
  re-uses the charge via `sourceRef` = the transaction id (the existing `ux_practice_charge_source`
  duplicate guard turns the charge insert idempotent for free — `CHARGE_EXISTS` at `billing.ts:240`).
- **The receipt is numbered at sync, never in the field.** At the bedside the only true sentence is
  the held-note family: money recorded on this device, a numbered receipt will exist when it is
  filed. Nothing is issued offline. (If the patient needs paper in the field, that is a handwritten
  acknowledgment outside this product — the product must not print an unnumbered receipt-shaped
  document.)
- **Mapping trap to defuse** (the follow-up lesson): `createCharge` and `recordPayment` both answer
  400 `VALIDATION_ERROR` for failed inserts; the wrapper pre-refuses every payload fault so a late
  VALIDATION_ERROR is infrastructure → remapped 500-retryable. And `recordPayment`'s 503s
  (`NUMBERING_UNAVAILABLE`, `RECEIPT_FAILED`) already map correctly to retryable.
- **What it does NOT need**: no new tables, no migration (unless the optional `id` column default is
  counted — it is not; the column exists), no credit ledger, no change to collected≠received (field
  cash is `collector: practitioner`, received directly, settlements untouched), no fee cache in v1
  (manual description + amount; the fee catalogue is reference data and could be cached later exactly
  like parameter definitions).

**Honest size: comparable to entity three.** One wrapper, one applier, one screen, harness section,
break-tests. The only genuinely new thinking is the two-write idempotency, and `sourceRef` +
device-minted payment id close it with existing machinery.

## 4. Shapes 2 and 3: the on-account arc, if it is ever wanted

True prepayment (deposit for a future procedure) or an overpayment surplus needs the **governed
credit rule** both specs name and defer:

- a `practice_patient_credit` ledger (or a `credit` allocation target) — signed entries, currency,
  derived balance, never editable;
- allocation semantics: payments may allocate TO credit; invoices/charges may be settled FROM credit;
- `patientStatement`'s sign contract gains a row type, and the statement's opening-balance proof
  changes;
- refund interaction: refunding from credit vs refunding a payment;
- fraud posture: credit balances are the first place invented money hides, so the platform-plane
  banded counts and the audit surface both grow.

This is an **online-first arc** (nothing about it is offline-specific), it is real design work, and
nothing currently shipped is blocked on it. The specs' own language ("unless an explicit unapplied
balance feature is implemented", "governed credit/refund/unapplied-balance rule") reads as: build it
deliberately or not at all. **Field cash does not need it** — that was the load-bearing discovery of
this survey.

## 5. Decisions for the owner

| # | Question | Recommendation |
|---|---|---|
| **D1** | Build the shape-1 **field collection** offline entity (charge + payment at sync, receipt numbered at sync)? | **Yes, as entity four** — it closes the real loss surface with existing semantics |
| **D2** | Bedside acknowledgment: held-note sentence only, or any receipt-like rendering before sync? | **Held-note only.** Nothing receipt-shaped exists until the number does |
| **D3** | Should a field collection be linkable to an offline-captured visit (charge names the encounter at sync via the visit's natural key)? | Stand-alone in v1; linkage is an additive enhancement |
| **D4** | Fee catalogue cached on the device (reference data, like parameter definitions) or manual amounts in v1? | Manual v1; cache the catalogue when practitioners ask for it |
| **D5** | Build the shape-2/3 **on-account credit arc** at all? | **Not now.** Online-first, its own spec, only if real practices ask for deposits |
| **D6** | `payment.record` is checked at sync — should the device warn from cached shell capabilities so a person without the capability is not refused days later? | Yes — a bedside warning, never a bedside grant |

## 6. What this survey did not do

No code changed, no migration written, no entity built. The three shipped capture entities and the
billing estate are untouched. If D1 is taken, the build follows the standing offline rules: screen +
applier together, harness section with break-tests, `.next-verify` before commit.
