# COMP-ENG-001A — Required Developer Output

Parent: COMP-ENG-001 §9 Step 6. This document is the §8 deliverable table required by the owner's
decision response — six items, in the order specified. Everything below is grounded in a real
read/grep/run performed on 2026-08-18; no claim here is inferred from the spec's own wording.

## 1. Route assessment

| Journey | Spec's route intent | Actual route (confirmed by reading the code) | Divergence |
|---|---|---|---|
| 1. Public site loads | root/public application | `/` (`src/app/page.tsx`) | None |
| 2. Practice gateway loads | Practice gateway route | `/practice` (`src/app/practice/page.tsx`) | None |
| 3. Synthetic practitioner auth | existing supported sign-in flow | `/practice/sign-in` (`src/app/practice/sign-in/SignInForm.tsx`) — email+password via Supabase `signInWithPassword`, same auth as every other workspace (IAM-ADR-01) | None |
| 4. Post-login product routing | correct Practice workspace, not another product | on success, hard-navigates to `return_to` or `/practice/home`; the shell (`src/app/practice/(shell)/layout.tsx`) re-resolves membership server-side and would divert a non-Practice or incomplete account to `/practice/no-account`, `/practice/select-workspace`, `/practice/onboarding`, or `/practice/access-status` | None in route; the routing *logic* is exactly the two-gate split this repo already enforces |
| 5. Command Centre loads | primary Practice landing/command workspace | `/practice/home` (`src/app/practice/(shell)/home/page.tsx`, component `PracticeCommandCentre`, heading "Practice Command Centre") | None |
| 6. Practice Planner loads | Practice Planner route | `/practice/calendar` (`src/app/practice/(shell)/calendar/page.tsx` → `PlannerWorkspace.tsx`, heading "Practice Planner") | **Yes — reported per §3.** CPR-V5-005 deliberately renamed the *nav label* from "Calendar" to "Practice Planner" but kept the URL at `/practice/calendar` ("a URL rename is churn" — comment in `planner-ui.ts`). There is no `/planner` or `/practice/planner` route. This is a pre-existing, documented decision, not something introduced by this change, and the spec directive not to rename routes to fit the test was followed: the test targets `/practice/calendar`. |
| 7. Protected-route denial | protected Practice route denies unauthenticated access | any `(shell)` route (tested via `/practice/home`) → 307 to `/practice/sign-in?return_to=<original path>` (`src/app/practice/(shell)/layout.tsx`, `shell.state === "AUTH_REQUIRED"`) | None |

## 2. Playwright configuration

`playwright.config.ts` (repo root). Single Chromium project, no cross-browser matrix, no visual
regression, no component testing — deliberately excluded per §5 ("do not expand... into comprehensive
E2E coverage"). `webServer` starts `npm run dev` and reuses an already-running one locally
(`reuseExistingServer: !process.env.CI`). Trace and screenshot capture on failure only.

**One correction made after real execution, not left as a known issue:** the framework's own default
(`fullyParallel: true`, multiple workers) caused all three credential-free journeys to fail on a
genuinely cold run — several workers hitting different uncompiled routes on the single `next dev`
process at once exceeded the 30s navigation timeout. Config now pins `workers: 1` /
`fullyParallel: false` unconditionally. Re-run cold after killing the dev server entirely: 3 passed, 4
skipped, ~20s, no flakiness. See the config file's own header comment.

## 3. Smoke specs

Seven files under `e2e/smoke/`, one per approved journey (numbered by credential requirement, not
spec order — see `e2e/README.md`'s table for the file↔journey mapping). Journeys 1, 2, 7 need no
credentials and run unconditionally. Journeys 3-6 call
`e2e/helpers/synthetic-practitioner.ts`'s `requireSyntheticPractitioner()`, which calls
`test.skip(condition, reason)` when `SMOKE_PRACTITIONER_EMAIL`/`SMOKE_PRACTITIONER_PASSWORD` aren't
set — they report as **skipped**, with the reason printed, never as a false pass and never silently
omitted.

## 4. Environment note

Required variable names — no value is committed, logged, or was ever typed into this session:

- `SMOKE_PRACTITIONER_EMAIL`
- `SMOKE_PRACTITIONER_PASSWORD`

**Test-account prerequisite, checked and confirmed absent, 2026-08-18:** no synthetic automation
practitioner identity currently exists in this database. Searched `profiles.full_name` for
test/automation/synthetic/smoke/e2e/playwright patterns and `practice_workspace.name` for a test
workspace — no real match. This account is not created by this change; creating accounts is outside
what this change does unattended, consistent with §4 ("use a dedicated synthetic automation
practitioner identity") describing a prerequisite to provision, not an action for the agent to take
silently.

**Setup instructions, once the owner decides to provision it:** create the account directly (global
signup stays closed by standing decision — see `CLAUDE.md`), give it a real Practice membership
resolving unambiguously to the Practice product line (not Platform/HQ — journey 4 depends on this
distinction being real), and enough of a workspace behind it that `/practice/home` and
`/practice/calendar` reach their normal authenticated render rather than an onboarding/chooser/access-
restricted redirect. Full detail in `e2e/README.md`.

## 5. CI recommendation

**Not yet ready for a PR gate — partially.** Journeys 1, 2, and 7 are CI-safe today: no secrets, no
external state, confirmed deterministic across repeated cold runs. Journeys 3-6 are blocked by the
single, exact prerequisite above: no synthetic automation practitioner identity exists yet, and per §6
("a test that requires unavailable production credentials must not be made a mandatory CI gate"), they
must not be forced into a required check while that's true.

Two honest options, not a decision this document makes:
- Wire only 1/2/7 into CI now (a real subset gate, not padded), and add 3-6 once the identity exists.
- Wait for the identity and wire all seven at once.

Recommendation is the first: three of seven journeys are genuinely ready and gain nothing by waiting on
the other four. Either way, this is a Stage C action (§6) — deliberately not taken in this change,
which stops at Stage B (local validation).

## 6. Execution evidence

Real local run, cold (dev server fully killed and restarted, not reusing a warm compile):

```
Running 7 tests using 1 worker

  ok 1 [chromium] › e2e\smoke\01-public-site.spec.ts:7:5 › home page renders and identifies itself (1.1s)
  ok 2 [chromium] › e2e\smoke\02-practice-gateway.spec.ts:8:5 › practice gateway renders for a signed-out visitor (2.0s)
  ok 3 [chromium] › e2e\smoke\03-protected-route-denial.spec.ts:8:5 › an unauthenticated visit to a shell route redirects to sign-in with return_to preserved (1.8s)
  -  4 [chromium] › e2e\smoke\04-practitioner-sign-in.spec.ts:11:5 › a practitioner signs in and leaves the sign-in page
  -  5 [chromium] › e2e\smoke\05-post-login-routing.spec.ts:11:5 › post-login lands in /practice/home, not another product
  -  6 [chromium] › e2e\smoke\06-command-centre.spec.ts:10:5 › command centre renders after sign-in
  -  7 [chromium] › e2e\smoke\07-practice-planner.spec.ts:13:5 › practice planner renders after sign-in

  4 skipped
  3 passed (18.2s)
```

3 passed, 0 failed, 4 skipped (each with the missing-credential reason printed by Playwright's own
`test.skip` reporting). No journey failed for a code reason — the 4 skips are all the same single,
already-identified environment gap, not four separate problems.

`npx tsc --noEmit -p tsconfig.json` and `npx eslint e2e` both clean against every new file.

## Acceptance criteria check (§10)

- No unapproved application architecture change — confirmed; only `playwright.config.ts`, `e2e/**`,
  and `.gitignore` (two ignore lines) added.
- Existing CI/security controls remain operational — unchanged; this suite is not wired into
  `ci.yml` in this change.
- Seven journeys represented or documented as blocked — all seven have a spec file; 3-6 are the
  documented, single-cause block above.
- Routes discovered, not assumed — §1 above, including the one reported divergence.
- No real patient/clinician data, no production credentials — confirmed; the suite has never had a
  credential value in this session.
- No database-harness or staging change — none made.
- Whether Playwright can be promoted to a PR gate — answered in §5 above.
