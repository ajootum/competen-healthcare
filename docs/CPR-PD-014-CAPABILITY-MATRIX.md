# CPR-PD-014 §14 — capability matrix for Product Operations

**2026-08-19.** What each of the five Product Operations surfaces requires, who holds it, and where the
requirement is actually enforced.

Every row below was **read from the live staging database and from the guard call sites**, not from the
seed migrations that were supposed to have produced them. `hq_position` (6 rows) and
`hq_position_capability` (64 rows) were queried directly; each route's requirement is the literal
argument to its `requireHqCapability` / `hqApiGate` call. Nothing here is inferred from a spec sentence.

---

## 1. The five screens

All five are reads, and all five declare the same capability.

| # | Surface | Route | Guard | Capability |
|---|---|---|---|---|
| 1 | Operations Overview | `/super-admin/pd/operations` | `requireHqCapability` | `hq.practice.operations.view` |
| 2 | Provisioning & Onboarding | `/super-admin/pd/operations/provisioning` | `requireHqCapability` | `hq.practice.operations.view` |
| 3 | Practice Workspaces | `/super-admin/pd/operations/workspaces` | `requireHqCapability` | `hq.practice.operations.view` |
| 4 | Launch Readiness | `/super-admin/pd/operations/launch-readiness` | `requireHqCapability` | `hq.practice.operations.view` |
| 5 | Technical Operations | `/super-admin/platform-ops/practice` | `requireHqCapability` | `hq.practice.operations.view` |

A refusal from `requireHqCapability` redirects to `/dashboard` and writes an `hq_access_observation`
row — the same refusal shape every other `/super-admin` guard uses, deliberately, so a refused operator
does not land somewhere that looks like a different kind of failure.

## 2. The writes

The three controls that change something declare their own capability, and none of them accepts
`operations.view`.

| Action | Endpoint | Method | Guard | Capability | Refusal |
|---|---|---|---|---|---|
| Provision a pilot workspace | `/api/v1/practice/provisioning/individual` | `POST` | `hqApiGate` | `hq.practice.provision.execute` | 401 / 403 JSON |
| Retry a failed run | `/api/v1/practice/provisioning/[requestId]` | `POST` | `hqApiGate` | `hq.practice.provision.execute` | 401 / 403 JSON |
| Flip a launch flag | `/api/v1/practice/flags` | `PATCH` | `hqApiGate` | `hq.practice.flags.manage` | 401 / 403 JSON |

`hqApiGate` rather than `requireHqCapability` on all three, because a `fetch` caller cannot act on a
redirect — it receives an opaque 200 from the page it was bounced to. A status code is the only refusal
a client can branch on.

The `GET` on `/api/v1/practice/provisioning/[requestId]` uses the gate as a **predicate** rather than a
guard: it calls `hqApiGate` and discards the 403 body, using only whether it refused, so a caller
without `provision.execute` still reads the run and simply sees no retry affordance.

## 3. Who holds these capabilities

Six positions are defined. Exactly **one** holds any of the three.

| Position | Space | `operations.view` | `provision.execute` | `flags.manage` |
|---|---|---|---|---|
| **Practice Product Director** | practice | ✅ | ✅ | ✅ |
| Platform Director | platform | — | — | — |
| Chief Executive | executive | — | — | — |
| Chief Financial Officer | executive | — | — | — |
| Learning Product Director | learning | — | — | — |
| Quality Council Member | quality | — | — | — |

`practice_product_director` holds 20 capabilities in total, of which 19 are `hq.practice.*` and one
(`hq.platform.home.view`) is the shell.

This satisfies §9's requirement that the Product Director not be equated with Super Admin — the position
is a real, separately-granted thing, and no estate role confers it. **See §6 for what it does not do.**

## 4. Getting in is a different question from what you may do

⚠ **A capability alone does not open any of these screens, and finding that out cost a build.** The
synthetic HQ operator was appointed Practice Product Director, the resolver confirmed all 20
capabilities, and every route still redirected to `/practice/no-account`.

`src/app/super-admin/layout.tsx` calls `admitToEstate` **before** any capability is consulted. That is
COMP-ARCH-PSA-001's two-gate split working exactly as specified:

| | Gate | Asks | Mechanism |
|---|---|---|---|
| 1 | Membership | Does this person belong to Competen Platform at all? | an active `platform_membership` row |
| 2 | Capability | What may they do here? | the active appointment's capabilities |

An identity satisfying only gate 2 holds every permission the product defines and cannot open the door.
Any future HQ fixture, synthetic operator, or first real Product Director needs both, and granting the
appointment is the half that looks finished.

**The door is the union; the room is the active context.** The layout resolves *every* live appointment,
so nobody is locked out of the building because their currently-selected context is narrow. What they may
*do* inside answers from the one active appointment alone (PLAT-GOV-MC-001 §8) — an identity appointed to
two products cannot act in both from one screen.

## 5. Break-glass

`super_admin` or `platform_owner` short-circuits the capability test entirely: `decideHq` returns
`decision: "allow_owner"`, `mode: "observe"`, and — importantly — **`capabilities: []`**.

An owner therefore holds no capability while being allowed everything, so any screen that decides what to
render by testing `ctx.capabilities` shows an owner *less* than a Product Director. Technical Operations
handles this correctly:

```ts
const canRetry = hq.isOwner || hq.capabilities.includes("hq.practice.provision.execute");
```

The `hq.isOwner ||` is load-bearing. Without it the break-glass account — the one used precisely when
something is broken — would be the account that cannot retry a failed provisioning run.

## 6. Two honest findings

### 6.1 There is no read-only Product Operations access

The single position that can *see* Product Operations is the same position that can provision workspaces
and flip the launch flags that open the product to the public. Today it is not possible to give somebody
the five screens without also giving them both writes.

Nothing is mis-enforced — every guard does what it declares. But a matrix with one row is not a
separation of duties, and the first person who needs to watch provisioning without being able to execute
it will need a second position, not a configuration change.

### 6.2 Two of the three write controls are not conditioned in the UI

| Control | API enforces | UI conditions the affordance |
|---|---|---|
| Retry a failed run | ✅ | ✅ `canRetry` |
| Provision a pilot workspace | ✅ | ❌ renders for anyone with `operations.view` |
| Flip a launch flag | ✅ | ❌ renders for anyone with `operations.view` |

This is invisible today for exactly the reason in §6.1: everyone who can see the page can also do both
writes, so the affordance is never offered to somebody who would be refused. It stops being invisible the
moment the grants are split, and the symptom would be a button that 403s.

It is recorded rather than fixed because fixing it means choosing what a refused operator should see, and
that choice belongs with whoever decides §6.1.

## 7. Evidence

Screenshots of all five surfaces at 1440px, in `docs/evidence/cpr-pd-014/`, captured as the synthetic
Practice Product Director against **staging** — never production, so no real practice or practitioner name
appears in a delivery document. Staging also holds the exception states §14 asks for: a practice stalled at
0/6, a launch gate with four outstanding controls, and a failing automatic check.

`scripts/capture-pd014-evidence.ts` asserts the path it landed on before writing each file. Its first
version counted files instead, and reported "5 screenshot(s) written" while every one of them was the same
`/practice/no-account` redirect — the §4 finding above, announced as evidence.
