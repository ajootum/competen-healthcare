# CP-SPLIT-002 — Separating the two products: what it costs, and what it breaks

**Status:** survey. Nothing built. Supersedes CP-SPLIT-001's mechanism; its intent is unchanged.
**Governing document:** `docs/COMP-ARCH-PSA-001-product-separation.md` (status: GOVERNING ARCHITECTURE).

---

## 1. The one-line summary

The Practice half of the separation is **already built**. The Platform half is **implicit**, and that is the
entire problem: every identity is a Platform member by construction, so Practice signup has nowhere to put a
person except on the estate.

## 2. Measured state

| | |
|---|---|
| profiles | **47** |
| profiles with a NULL `role` | **0** — platform membership is implicit and universal |
| practice memberships | 8 rows, 4 workspaces, **4 distinct people** |
| of those, harness fixtures with no profile row | **3** |
| **real people holding a practice** | **1** — Mullen E., `estate=["nurse"]` |
| Platform-only identities | 46 |
| estate route groups | 20+ |
| **layouts gating on an estate role** | **11** — admin, assessor, competency-office, dashboard, educator, hospital-executive, platform-admin, quality-accreditation, super-admin, supervisor, unit-manager |
| API routes gating on an estate role | **174** (`isAdmin` / `isSuper` / `ADMIN_ROLES`) |
| `practice_*` tables | 162 |
| other (Platform-owned) tables | 378 |
| call sites of `highestRole` | 4 |

⚠ **The migration is one account.** Not 47. That is the single most useful number here: the change is
structural, but its data footprint today is a single row.

## 3. What already complies with COMP-ARCH-PSA-001

Worth stating plainly, because the work is much smaller than the document implies:

- **§10 Practice authorization domain** — exists. `practice_membership` (workspace, user, `role_code`,
  status), ~52 capability codes, `requirePracticeContext`. It never reads `profiles.role`.
- **§7 explicit membership, Practice side** — absence of a `practice_membership` row already means no
  access. Being a nurse on the estate grants no practice.
- **§15 product-owned data** — the `practice_*` prefix is a real boundary, 162 tables wide, and
  `plane-boundary.ts` enforces which of them the Platform may read, by table AND column, with a harness.
- **§12 distinct entry gates** — `/login` and `/practice/sign-in` already exist as separate surfaces.
- **§19 no hidden coupling** — the platform reads practice data through one allowlisted module.

## 4. What does not comply, in priority order

### 4.1 §7 — Platform membership is implicit (the root cause)

`profiles.role` is populated for all 47 rows with a CHECK admitting only estate roles. There is no way to
express "this identity is not on the estate". So `practice/signup/route.ts` writes `role: "nurse"` twice
(auth metadata line 96, profiles line 103) because it must write something.

### 4.2 §5 and §11 — Practice creates Platform membership

§5: no product may "create, infer, assign… membership, roles, permissions" in another. §11 lists what MUST
NOT occur during Practice registration: *Create Competen Platform User, Assign Platform Nurse.* Practice
signup does both.

### 4.3 §8 — profession is conflated with authorization

*"Profession: Nurse is a professional characteristic. It DOES NOT mean Platform Role: Nurse."* Today they are
the same column. Practice already holds the honest field separately — `profiles.specialization`,
`practice_practitioner_identity.self_declared_profession` — so the profession has somewhere to live.

### 4.4 §14 — no automatic cross-product access

A Practice account currently lands on `/dashboard`, the Personal Workspace, which aggregates *estate* work:
competencies, learning, shifts, assigned patients. §14 forbids seeing Platform functionality merely because
both belong to Competen.

### 4.5 ⚠ §13 — session and token isolation. THE HARD ONE, AND IT IS NOT A CODE CHANGE.

> *"A token/session issued for CompetenPractice MUST NOT be accepted automatically by Competen Platform
> APIs."*

Supabase issues **one session cookie per origin**, with no product audience. `/practice` and `/super-admin`
share it — which is why signing in at gate 2 signs you out of gate 1, as the owner hit. Three ways to satisfy
§13, and none is free:

1. **A separate origin for Practice** (`practice.competenhealthcare.com`) — a different cookie jar, so both
   sessions coexist and neither token reaches the other product. Genuine isolation. PIS-000 §8 previously
   considered and rejected a subdomain *for the booking address*; this is a different question and the
   earlier decision does not settle it.
2. **An application-level audience check** — record which gate a session was established through, and refuse
   it at the other product's boundary. Cheaper, but it is a convention enforced in our code rather than by
   the token, and §13 asks for the token not to be *accepted*.
3. **Accept the gap and document it** — one session, two products, with `SessionIdentityNotice` explaining
   the switch. Honest, and does not meet §13.

⚠ Only (1) actually satisfies the requirement as written. It is also the only one that lets somebody hold
both gates at once, which the owner has asked for.

## 5. What breaks, and what does not

**Does not break.** Practice — nothing in it reads `profiles.role`. All 162 `practice_*` tables, every
capability check, `requirePracticeContext`, the whole Practice product is untouched by making Platform
membership explicit.

**Breaks, and must be handled deliberately:**

- ⚠ **`highestRole` fell back to `"nurse"`.** Anyone with no estate role would have been silently handed a
  nurse identity by every screen that asked — the badge gate 2 must not issue, re-issued by a default. Already
  changed to return `null`; **but all 4 call sites do `?? highestRole(x) as AppRole`, and the cast swallows
  the null**, so the type system did NOT force them. Each must be handled explicitly.
- **11 estate layouts** must refuse an identity with no platform membership, and send it to `/practice/home`
  rather than a dead end. PW-014's WS1 rule ("all roles → `/dashboard`") needs a no-platform-membership branch.
- **174 API routes** gate on `isAdmin`/`isSuper`. These already refuse a nurse, so they refuse a
  no-membership identity too — but that should be asserted, not assumed.

## 6. The staged path

Each stage is independently shippable and leaves the product working.

**Stage 1 — make Platform membership expressible.** Either a `platform_membership` table (§7's own model,
cleaner, duplicates nothing) or a nullable `profiles.role` (smaller, and `null` already means "no estate
role" now that `highestRole` returns null). ⚠ Recommend the table: §7 asks for membership, not for the
absence of a role, and a table carries status, joined_at and who granted it — which a null cannot.

**Stage 2 — Practice signup stops writing Platform state.** Two lines. §11's flow otherwise already matches
what provisioning does.

**Stage 3 — the estate requires membership.** 11 layouts, one shared guard, and a landing rule. Harness: a
no-membership identity reaches no estate surface, **paired with a control** that a nurse still does —
without the control, "denied" also passes when the estate is broken for everybody.

**Stage 4 — migrate the one account.** Mullen E. loses the Personal Workspace and keeps Trial. Reviewed by
name, never a `WHERE` clause: "anyone with a practice membership" would demote a super_admin who also owns a
practice, which is the owner's own situation.

**Stage 5 — §13 session isolation.** Separate decision, separate cost. See 4.5.

**Stage 6 — §8 profession.** Move professional discipline off the authorization column onto the profile.

## 7. Decisions needed

1. **Stage 1: table or nullable column?** (recommend: table)
2. **§13: which of the three?** ⚠ Only a separate origin satisfies it as written, and only that lets one
   person hold both gates simultaneously — which the owner has asked for.
3. **Do the 46 Platform-only identities get an explicit membership row backfilled**, or is absence-of-row
   read as legacy-member until they are touched? (recommend: backfill — an implicit rule that decays is how
   the current problem started.)
