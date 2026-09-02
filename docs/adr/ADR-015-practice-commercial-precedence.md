# ADR-015 — Practice commercial precedence

**Status:** Accepted · 2026-09-02
**Satisfies:** CPR-PD-PROV-001 §12, §19, AC-10
**Supersedes:** nothing. This is the first written answer to "which source controls access".
**Enforced by:** `src/lib/practice/commercial-precedence.ts`, `src/lib/practice/commercial-precedence.test.ts`

---

## The question

CPR-PD-PROV-001 §12 requires us to "define precedence when billing state, manual promotional
entitlement and administrative suspension coexist", and §19 to "resolve commercial authority
explicitly: identify which source controls access for paid subscriptions, trials,
promotions/internal access and administrative suspension. Do not solve this by adding a single
editable `expires_at` field to Practice."

Four candidate sources exist in the schema. Before deciding anything, each was traced to the code
that reads it.

## What was measured, 2026-09-02

| Source | Table | Who reads it to decide access |
|---|---|---|
| Practice lifecycle | `practice_workspace.status` | `resolveWorkspaceContext` — **checked first, and it can refuse alone** |
| Entitlement period | `practice_entitlement` | `resolveWorkspaceContext` — **the only thing that grants** |
| Paid subscription | `practice_subscription` | **Nothing.** One reader (`subscription-state.ts`, the practice's own billing card) and one writer (payment settlement). The access gate never looks at it |
| Promotion | — | **No table.** The PD promotions surface renders a stated absence: a Practice cannot be the subject of a `plat_subscriptions` row, and `practice_plans` carries no price |

Two consequences follow directly, and neither was obvious before the trace:

- **A workspace can hold an `active` subscription row and still be shut**, or a `cancelled` one and
  still be open. The row records what was paid. It has never decided anything.
- **§12's three-way conflict is really two-way.** There is no separate promotional source: a
  promotion in this schema *is* an entitlement period with a plan code, written by a Director.

## Decision

> **Administrative suspension outranks every commercial fact. Below it, `practice_entitlement` is the
> only thing that grants access, and every commercial source — trial, payment, promotion, Director —
> expresses itself by writing a period into it.**

### Rung 1 — administrative suspension

`practice_workspace.status` outside `ACTIVE` / `ONBOARDING` / `PROVISIONING` closes the practice
regardless of any plan, payment or period. No commercial act can reopen it, and an attempt to write
a period into a suspended practice is **refused** rather than performed — a write that succeeds and
grants nothing is worse than a refusal, because it reports success.

This is not a new rule. It is what `resolveWorkspaceContext` has always done; it had simply never
been written down, so the commercial surfaces did not know they were subordinate to it.

### Rung 2 — the entitlement ledger

One gate, one table, append-only. This is the direct answer to §19's "do not solve this by adding a
single editable `expires_at` field": the field would have been a second gate that agreed with the
first until somebody edited it.

Every source writes through `openAccessPeriod` in `src/lib/practice/entitlement-writer.ts`:

- **Provisioning** writes the first period (the plan's own trial, or the one a Director chose).
- **A settled payment** appends an `active` period. Billing is authoritative *over its own period* —
  it exercises that authority by writing one, not by becoming a second gate.
- **A Product Director** appends on extension and reactivation, and transitions status on End access.
- **A promotion** is a Director-written period. When promotions gain their own representation, they
  join here rather than beside.

### Rung 3 — overriding a live payment

§12: "Billing-authoritative subscriptions must not be silently overwritten by a PD manual entitlement
action."

**"Must not be silently overwritten" is not "must not be overwritten", and the distinction is the
whole design.** A Director has to be able to close a practice that has paid — a chargeback, a safety
suspension, a refund handled elsewhere. Refusing outright would put the product in the way of a
legitimate act and send somebody to the SQL editor, where nothing is audited at all.

So: permitted, named, recorded, and never accidental. When a live paid subscription exists
(`status = active` and the period has not run out) and the act would **reduce** access, the engine
refuses with `BILLING_OVERRIDE_UNACKNOWLEDGED` until the caller passes an explicit acknowledgement,
which is then recorded with the required reason.

**The asymmetry is deliberate.** Extending a paid practice's access asks for nothing — it is a gift,
not a conflict. Demanding a ceremony for it would train Directors to click through the ceremony,
which is how a real warning stops being read.

### Unreadable is not permission

If the lifecycle status cannot be read, the act is refused. A failed read must never resolve to "not
suspended": that is how a caller is told to proceed *because* the thing that would have stopped them
was unreachable.

## What this changed in the code

- **A real defect, fixed.** The payment settlement wrote
  `update(...).eq("workspace_id", …).in("status", ["trial","active","expired"])` — no row filter
  beyond the workspace. It rewrote `plan_code`, `status` and `ends_at` on **every period the practice
  had ever held**. Survivable while a practice only ever had one row; a fabricated ledger from the
  moment periods began to append on 2026-09-01, since a trial, an extension and a lapse would all
  have been resurrected as `active` sharing one end date while each kept its original start.
  It was never reachable — no plan in `practice_plans` is both active and priced, so no checkout can
  be raised — which is exactly why nothing caught it. A latent defect in a payment path runs for the
  first time on the day money arrives.
- Three append implementations became one (`entitlement-writer.ts`).
- `grantAccessPeriod` and `endAccess` consult precedence before writing.

## Consequences and limits

- **Ending a period is still a status transition, never a date rewrite.** Rewriting `ends_at` to
  today would make the record claim the period had always been going to end today (§9).
- **A period does not record which source wrote it.** Authority is judged per *workspace* — "does a
  live paid subscription exist" — not per period. This is honest at today's granularity and needs no
  migration. A `source` column would allow "this specific period was billing-written", and is the
  natural next step if promotions gain their own representation.
- **Nothing in this product bills for a Practice plan.** Rung 3 is written against a payment path
  that cannot currently be reached. It is written now because the alternative is discovering the
  precedence question during the first chargeback.
- **AC-16's billing/manual precedence tests** are the eleven assertions in
  `commercial-precedence.test.ts`. The end-to-end case — a real payment, then a Director override —
  cannot be exercised until a plan is both active and priced.
