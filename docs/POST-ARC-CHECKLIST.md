# After the in-flight arcs land — things that must wait for a quiet tree

These are small, and every one of them is wrong to do while agents are mid-write. Kept here because a
one-line task is exactly what gets lost across a long session.

**Run each only when `git status` is quiet and `npx tsc --noEmit` is clean.**

---

## 1. Regenerate the access matrix ⚠ THE ONE THAT MUST BE LAST

```
npx --yes tsx scripts/gen-access-matrix.ts
```

`src/lib/access/matrix.generated.json` is stale — several arcs added API routes
(`/api/v1/practice/{capabilities,register-and-book,scheduling-offer,investigation-capture,treatment-capture}`,
`/api/hq/appointments`). `scripts/umw-permissions-harness.ts` asserts the file matches a fresh scan, so it is
red until this runs.

⚠ **Run it ONCE, when nothing is half-written.** The generator scans the whole repo, so running it mid-arc
sweeps another agent's unfinished routes into the committed matrix — which is worse than the staleness,
because it records a route's access as whatever it happened to look like mid-edit.

⚠ And the matrix is a SECURITY artefact: `scan.ts` was once stale by 112 routes and classified 98 gated
practice routes as `none`, i.e. open to the world. Read the diff, do not just commit it.

## 2. Screens that shipped with no door

The door sweep exists because this keeps happening. Each of these is built and reachable only by URL:

- `/practice/setup/capabilities` — needs a tile on the Setup landing (`src/lib/practice/setup.ts`)
- `/practice/setup/investigations` and `/practice/setup/treatments` — modules 20/21 were added to `setup.ts`,
  confirm they render
- `/super-admin/users/appointments` — the HQ appointment screen, not linked from the sidebar

Then re-run `npx --yes tsx scripts/practice-door-sweep.ts` and check the "NO WAY IN" list shrank.

## 3. The HQ page-count baseline

`scripts/hq-guard-harness.ts` `E1` is red: **205** page patterns under `/super-admin` against a baseline of
**204**. The extra is the appointments screen. ⚠ Move the baseline deliberately, after confirming the new
page carries its own gate — the count control exists precisely so a page cannot be added unnoticed.

## 4. `SessionIdentityNotice` on every workspace shell

Currently only on the `/super-admin` refusal. Every authenticated shell should render
`RememberSessionIdentity` on the success path and `SessionIdentityNotice` on any refusal, so "the account
changed under this tab" is answerable everywhere rather than in one place.

## 5. Wire the capability registry

`src/lib/practice/capabilities.ts` resolves what a practice has activated, and **nothing consumes it yet** —
navigation, dashboards and screens are untouched by design, because four agents were live in those files.
CPR-CAP-001 §2 wants capability-driven navigation and dashboard composition. ⚠ The gate is BOTH: activated
(commercial) AND permitted (security). They are different tables and must stay so.

## 6. Known-red harnesses that are nobody's current work

- `practice-patient-intake` **5c** — pre-existing; calls `bookUnderRules` with no intake, so a
  non-overridable refusal outranks the override check
- `practice-patient-manage` **4c** — pre-existing, about cancellation-reason storage
- `practice-schedule-exception` — its own fixture inserts two appointments at the same instant, which
  migration 255's exclusion constraint refuses regardless of location
- `practice-search` — several failures that predate this session's change; confirmed by restoring the
  committed `search.ts` and getting the identical count
- `practice-setup-domains` **6a/6d/6g** — pins the availability parts at six named keys; a seventh
  (`booking_address`) was added and the harness was left stale

⚠ None of these is a product defect anybody has demonstrated. Each is worth an hour to either fix or delete —
a red harness nobody trusts is worse than no harness, because it trains people to ignore red.

## 7. Migrations

Applied: 274, 275, 276, 278. Sent, awaiting apply: none.
⚠ **273 is written but NOT sent** — the operator licence door. It waits for the oversight agent to report and
for validation against live data.
Reserved: **277** (booking-request states), **279/280** (platform membership + the one-account migration).
