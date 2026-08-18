# COMP-ENG-002 — Staging provisioning runbook

**What this is:** the owner-executed half of COMP-ENG-002 §12. Steps 1, 2 and 11 are done and recorded
below. Steps 3-6 create a cloud project and mint credentials, which is your action, not an agent's —
so they are written to be followed rather than described.

**Status of §14 Definition of Done: not met.** No staging project exists yet. Nothing in this document
claims otherwise.

## Already done

| § | Step | Status |
|---|---|---|
| 12.1 | Confirm smoke job status; record route statuses | **Done.** Run `0261e36d`, all six CI jobs green including `Playwright smoke`. 3 journeys passed, 4 skipped. |
| 12.2 | Audit admin-client construction on smoke-hit routes | **Done** — `docs/COMP-ENG-002-admin-client-audit.md`. Found five public pages building a privileged client to read one boolean; fixed. |
| 6 | Privileged key must not be normalised into CI | **Done.** The placeholder added during triage has been removed, and its absence is now load-bearing in the smoke job. |
| 11 | Retain route HTTP-status diagnostics | **Done.** The `Route status before the suite` step prints `/`, `/practice`, `/practice/home` and distinguishes 200 / 500 / connection-refused. It prints no secret values. |

## Step 3 — Provision the staging Supabase project

Create a **new** Supabase project. It must not share the production project ID or database (§4).

- Name it so the environment is unmistakable in dashboards and logs (§4): e.g. `competen-STAGING`.
- Record the project URL and the anon/publishable key — these are the two values the browser is allowed
  to receive.
- Record the service-role key **into secret storage only**. It is needed for provisioning and reset, and
  per §6 must never reach the browser job.

## Step 4 — Apply schema

Apply the migration history through the normal controlled path — the same hand-applied route production
uses, so staging is exercised by the same procedure rather than a shortcut.

⚠ **Order matters and this repo has been bitten by it.** A capability catalogue insert without its
backfill locks every existing practice out while all harnesses stay green — it has happened twice
(migrations 192, then 303/305, healed by 307). Applying history in order avoids it; applying a subset
does not.

Then verify what §4 actually asks for — that RLS, functions, triggers, storage policies and auth config
match production *behaviour*, not just that the schema loaded:

```bash
npx tsx scripts/migration-house-rules.ts <each changed file>
```

⚠ **Verify RLS posture explicitly.** Production carries RLS enabled with **zero policies** on 209
`practice_*` tables, with application-layer guards carrying the whole load. Staging must reproduce that,
not "improve" it — otherwise staging passes tests production would fail.

## Step 5 — Create the synthetic Practice and practitioner

Once staging exists, point the environment at it and run the script that is already written:

```bash
SMOKE_PRACTITIONER_EMAIL='...' SMOKE_PRACTITIONER_PASSWORD='...' SMOKE_PROVISION_CONFIRM=yes npx tsx scripts/provision-smoke-practitioner.ts
```

It reuses the application's own `runProvisioning` rather than hand-writing inserts — deliberately, because
provisioning a practice is seven steps including capability grants, and the recorded failure mode above is
exactly what hand-rolling produces. It then activates the workspace, and verifies three things before
declaring success:

- workspace `ACTIVE` — otherwise the shell answers `ONBOARDING_REQUIRED`, never `READY`
- exactly **one** active membership — two would trigger the workspace chooser
- a live entitlement — otherwise `ACCESS_RESTRICTED`

It is idempotent, creates no clinical rows, and never prints the password.

**§5 lifecycle, still to decide:** password rotation cadence, who owns the account, and the
disable/recreate procedure. The script handles creation; it does not decide ownership.

## Step 6 — Configure secrets

| Variable | Where | Exposure |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | CI env (staging value) | Browser — by design |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | CI env (staging value) | Browser — by design |
| `SMOKE_PRACTITIONER_EMAIL` | GitHub secret | Never hard-coded |
| `SMOKE_PRACTITIONER_PASSWORD` | GitHub secret | Never hard-coded |
| `SUPABASE_SERVICE_ROLE_KEY` (staging) | GitHub secret | **Server-side provisioning/reset steps only. Never in the Playwright job.** |

⚠ The smoke job currently runs with **no** service-role key at all, and that is now a property worth
keeping: it proves no public page has regressed into eager privileged construction. When authenticated
journeys arrive, give the Playwright job the staging URL and anon key — not the service-role key.

## Steps 7-9 — Promotion

Per §8, and in this order:

1. Validate journeys 3-6 **locally against staging** first.
2. Enable them in CI and **observe stability** — §8 says promote *after* deterministic pass history, not
   on first green.
3. Promote all seven to a required gate once deterministic.

The four gated specs already skip cleanly with a stated reason when the credentials are absent, so no
spec change is needed — only the secrets.

## Step 10 — Harness classification

`docs/HARNESS-INVENTORY.md` already classifies all 213 harnesses, and 25 run in CI today. §9's tiers map
onto that work rather than replacing it:

| §9 tier | This repo | Status |
|---|---|---|
| A — pure/non-DB | 25 in CI | **Done** |
| B — critical DB acceptance | subset of the 188 privileged-live | Not started; needs staging |
| C — broader integration | remainder | Not started |
| D — exhaustive/release | full run | Not started |

⚠ §9 requires deterministic seed prerequisites and cleanup behaviour **before** CI enablement. The
inventory already flags 29 harnesses that mutate without using the shared cleanup helper — those need
individual verification before any of them run anywhere unattended.

## Open governance question

The audit recommends a policy permitting anon `SELECT` on `practice_platform_flags`, which would let
public pages drop the privileged client entirely instead of tolerating its absence. That changes RLS
posture on a `practice_*` table, which `CLAUDE.md` treats as a governance decision. **Not taken.**
