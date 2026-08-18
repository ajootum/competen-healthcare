# Playwright smoke suite

COMP-ENG-001A: the seven owner-approved smoke journeys, and nothing beyond them. See
`docs/COMP-ENG-001A...decision.docx` (the source spec — not converted to a `docs/` markdown file in this
change) for the full authorization; this file documents what actually got built and what it needs to run.

## Run it

```bash
npx playwright test
```

`playwright.config.ts` starts `npm run dev` for you (`webServer`, reused if already running locally) and
runs against `http://localhost:3000` unless `PLAYWRIGHT_BASE_URL` is set. First run needs the browser
binary once: `npx playwright install chromium`.

## The seven journeys

| # | File | Route(s) | Needs credentials? |
|---|---|---|---|
| 1 | `smoke/01-public-site.spec.ts` | `/` | No |
| 2 | `smoke/02-practice-gateway.spec.ts` | `/practice` (signed-out) | No |
| 7 | `smoke/03-protected-route-denial.spec.ts` | `/practice/home` → redirect to `/practice/sign-in` | No |
| 3 | `smoke/04-practitioner-sign-in.spec.ts` | `/practice/sign-in` | **Yes** |
| 4 | `smoke/05-post-login-routing.spec.ts` | post-login → `/practice/home`, not `/super-admin` | **Yes** |
| 5 | `smoke/06-command-centre.spec.ts` | `/practice/home` | **Yes** |
| 6 | `smoke/07-practice-planner.spec.ts` | `/practice/calendar` (nav label "Practice Planner" — see file header for the CPR-V5-005 route/label divergence) | **Yes** |

Journey numbers are the spec's own numbering (§3 of COMP-ENG-001A), not file order — files are ordered by
credential requirement so the runnable-today ones sort first.

## The synthetic automation practitioner identity

Four journeys need a real, signed-in Practice session. Central Competen identity (IAM-ADR-01) means
there's no test-only auth path to shortcut this — `signInWithPassword` against the same Supabase auth
every real practitioner uses is the only sign-in this app has.

**As of 2026-08-18, this account does not exist.** Checked directly and read-only: no `profiles.full_name`
matching test/automation/synthetic/smoke/e2e/playwright patterns, no `practice_workspace.name` suggesting
a test workspace. Nobody has provisioned one, and this change does not create one — creating accounts is
outside what an agent does unattended (see `CLAUDE.md` § Git safety and the standing account-creation
rule).

**Required environment variables (names only — no value is ever committed or logged):**

- `SMOKE_PRACTITIONER_EMAIL`
- `SMOKE_PRACTITIONER_PASSWORD`

**What the account needs, for all four gated journeys to actually pass once it exists:**

- Real Supabase auth credentials (email + password sign-in enabled for it specifically — global signup
  stays closed per the standing decision in `CLAUDE.md`, so this has to be created directly, not through
  `/practice/sign-up`).
- An active Practice membership resolving to `platform_membership` = Practice (not Platform/HQ) — journey
  4 explicitly asserts the post-login landing is `/practice/home`, never `/super-admin`, so an account with
  ambiguous or dual membership would make that assertion meaningless.
- Enough of a real workspace behind it that `/practice/home` and `/practice/calendar` render their normal
  authenticated state rather than an onboarding/chooser/access-restricted redirect (see the shell states in
  `src/app/practice/(shell)/layout.tsx` — `WORKSPACE_REQUIRED`, `CHOOSER_REQUIRED`, `ONBOARDING_REQUIRED`,
  `ACCESS_RESTRICTED` all divert away from the pages these tests check).

Until then, `e2e/helpers/synthetic-practitioner.ts`'s `requireSyntheticPractitioner()` makes journeys 3-6
report **skipped**, with that reason printed, every run — never a false pass, never a silent omission.

## What runs in CI

**Journeys 1, 2 and 7 run on every push and PR** as the `smoke` job in `.github/workflows/ci.yml`.
Journeys 3-6 skip there, exactly as they do locally, until the synthetic identity above exists.

⚠ **CI runs the app with no database reachable, on purpose.** The job sets
`NEXT_PUBLIC_SUPABASE_URL` to a closed port and the anon key to a placeholder — not secrets, not a
staging database. Every data read therefore fails closed, and the app logs
`could not read launch flag ... treating it as OFF` rather than throwing. So what the CI smoke job
proves is that the app **boots, serves its public routes, and denies a protected one**. It does not
prove that any data renders; that is what the credential-gated journeys are for.

⚠ **This forced a real correction to journey 7, worth knowing before editing it.** The original
assertion checked that the sign-in page's *form heading* was visible. But `/practice/sign-in` is
flag-gated on `practice_sign_in`, read from the database — so with no database the page renders its
"Sign-in is not open yet" panel instead, and the test went red **while the security control it exists
to protect was working perfectly**. The assertion now checks the redirect and the `return_to`
round-trip, which is the control; which panel the sign-in page then shows is product state, not
security, and belongs to journey 3.

## Why the other four aren't wired into CI yet

Journeys 1, 2 and 7 are in CI (above). The other four
can't run in CI until the synthetic identity above exists somewhere CI can reach it (this repo has one
Supabase project, no staging — see `docs/HARNESS-INVENTORY.md`'s "Environment reality" section for the
same constraint affecting the acceptance harnesses). Making four of seven owner-approved journeys
permanently skip in a required CI check is worse than not gating on them yet: a green check that's
structurally incapable of catching a regression in those four paths is a false signal, not a safety net.

**Status:** the owner approved wiring the credential-free subset on 2026-08-18, and it is now the
`smoke` job. Adding the remaining four needs `SMOKE_PRACTITIONER_EMAIL` and
`SMOKE_PRACTITIONER_PASSWORD` as GitHub secrets **and** a Supabase URL/anon key the CI runner can
actually reach — the placeholder values above deliberately cannot connect, so setting the two smoke
secrets alone would not be enough.

## A real local-execution finding, already fixed

`fullyParallel: true` (this framework's default) with more than one worker overwhelms a single `next dev`
process compiling several cold routes at once — enough to blow past the 30s navigation timeout. Confirmed
locally, 2026-08-18: with default concurrency, all three credential-free journeys failed on first cold
run; serialized (`workers: 1`, `fullyParallel: false`), the same three passed from a genuinely cold dev
server in ~20s, zero flakiness across repeated runs. `playwright.config.ts` now pins `workers: 1`
unconditionally (not just in CI) — see that file's own header comment for the full reasoning.
