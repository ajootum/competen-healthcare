# CP-SPLIT-001 — Two gates, one building

**Status:** scoped, not built. Reserved migration: **279**.

**The owner's words:**

> "It is like there are two entry gates to the Competen building — Competen Platform is the main gate
> (gate 1, with access to a different part of the building), CompetenPractice is accessed through gate 2.
> I am unable to access gate 1 from gate 2. We may share some of the core services — the lift, foundation,
> utilities — but we are a different part (interdependent)."

And the concrete complaint: *"I did not want to create a nurse account for Mullen E. I wanted to create an
account only and only as a practitioner in CompetenPractice."*

---

## 1. Why a Practice signup becomes a nurse

It is not a decision. It is a constraint nobody could satisfy honestly.

`profiles.role` carries a CHECK whose every value is an **estate** role:

```
check (role in ('nurse','assessor','educator','hospital_admin','country_admin','group_admin','super_admin'))
```

There is no value meaning *"this person is not on the estate at all."* So
`src/app/api/v1/practice/signup/route.ts` writes `role: "nurse"` twice — once into the auth metadata
(line 96) and once into `profiles` (line 103) — because it must write *something* and `nurse` is the least
privileged thing the constraint permits.

Everything downstream then believes it. `/dashboard` reads `profiles.role`/`roles`, so a practitioner who
has never seen a ward is issued a Healthcare Worker workspace, a shift briefing and a competency passport.

**Gate 2 issues a gate-1 badge.** That is the whole bug, and it is one column wide.

## 2. What is already correctly separated

Worth stating, because the split is smaller than it looks:

- **The data boundary exists.** `src/lib/access/plane-boundary.ts` enforces what the platform plane may read
  of a practice — an allowlist of tables *and columns*, with a harness. Platform staff cannot read clinical
  content.
- **Practice authorisation never consults `profiles.role`.** It uses `practice_membership` +
  `requirePracticeContext` + ~52 capability codes. A practitioner's rights come from their membership.
- **Gate 1 → gate 2 is already shut.** Practice access requires a `practice_membership` row, which only
  provisioning creates. Being a nurse on the estate grants no practice.

So the leak is one-directional: **gate 2 → gate 1**, through `profiles.role`.

## 3. The change, in the safest order

### Step 1 — a value meaning "not on the estate" (migration 279)

Widen the CHECK to admit `practice_only`.

⚠ **A NEW ENUM VALUE, NOT A NULLABLE COLUMN.** Making `role` nullable is the obvious alternative and the
dangerous one: every `roles.includes(...)`, `highestRole(...)` and `ROLE_PRIORITY` lookup in the codebase
would meet a null it was never written for, and the failure mode of a role check meeting an unexpected null
is not predictable. A new value is naturally excluded by every existing check for a *specific* role — the
estate keeps refusing it without a single call site changing.

⚠ **Widening a CHECK cannot fail on existing rows** (every current value stays legal), so this is safe to
apply. Nothing is migrated by it.

### Step 2 — gate 2 stops issuing gate-1 badges

`practice/signup/route.ts` writes `practice_only` in both places. One line each.

### Step 3 — the estate refuses it, and says where to go

`/dashboard` and the role workspaces must not admit `practice_only`, and must send them to
`/practice/home` rather than a dead end. ⚠ PW-014's WS1 currently routes **all** roles to `/dashboard`; that
rule needs a practice-only branch, not an exception bolted on at each screen.

### Step 4 — the reverse, asserted rather than assumed

A harness assertion that a `practice_only` account reaches no estate surface, **paired with a control** that
a nurse still does. Without the control, "denied" also passes when the estate is broken for everybody.

### Step 5 — existing accounts

⚠ **This is the step that can do damage, and it is a judgement, not a script.**

Migrating "anyone with a practice membership" to `practice_only` would demote a **super_admin who also owns
a practice** — which is exactly the owner's own situation, twice over. Any migration must exclude anyone
holding a genuine estate role, and should be a reviewed list rather than a `WHERE` clause.

Today there is exactly one candidate: **Mullen E.** (`mullen.elisha777@gmail.com`, `role=nurse`), who owns
the Trial practice and has never used the estate.

## 4. What "shared services" means, and what it must not mean

Shared — the lift and the utilities:

- Supabase Auth (one directory of people, one sign-in mechanism)
- the database and its RLS posture
- notifications, the design system, the audit trail

⚠ **Not shared — and this is the line:** what an identity *means*. One person may hold a badge for each
gate, but a badge for gate 2 must never be readable as a badge for gate 1.

## 5. The thing this does NOT fix, and the owner should know it does not

**One session cookie per origin.** `/practice` and `/super-admin` share it, so signing in at gate 2 still
signs you out of gate 1 in every tab. That is a browser fact, not a role fact, and no amount of role
separation changes it. `SessionIdentityNotice` now explains it when it happens; genuinely holding both at
once needs two browser profiles, or a different origin for Practice (`practice.competenhealthcare.com`),
which PIS-000 §8 considered and rejected for the booking address.

## 6. Decisions the owner must make

1. **Does a practice-only account get a dashboard at all**, or land straight in `/practice/home`?
2. **May one person hold both badges** — an estate role *and* a practice — or is it strictly one or the
   other? (Today the answer is "both", and the owner's own accounts rely on it.)
3. **Mullen E.** — migrate to `practice_only` now, accepting that the Healthcare Worker workspace disappears?
