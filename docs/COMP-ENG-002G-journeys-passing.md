# COMP-ENG-002G §5 — journeys 4-7 pass against staging

**2026-08-19.** `7 passed` — the three credential-free journeys and all four authenticated ones,
against a staging-pointed build with the synthetic practitioner.

⚠ **No assertion was weakened to get here** (§5, §10). Every failure along the way was a real fault in
the harness or the fixture, and each was fixed at its cause.

## What was actually wrong, in the order it was found

| # | Fault | Where |
|---|---|---|
| 1 | `practice_sign_in = false` on staging, so the page rendered **no form at all** | fixture |
| 2 | `page.route()` promise discarded — the production block may never have installed | harness |
| 3 | Route matched by glob, which cannot match a **host** | harness |
| 4 | Port collision: staging on 3001, suite watching 3000 | harness |
| 5 | `waitForLoadState("networkidle")` never settles against a live Supabase connection | harness |
| 6 | React 19 exposes no `__reactFiber` marker, so the hydration wait could only time out | harness |
| 7 | Click before hydration → native GET submit, no auth call | harness |
| 8 | **Retry after a successful sign-in**, waiting for a field that no longer existed | harness |

**Fault 8 was the one that looked most like a product bug and was not.** The failure read
`locator.fill: Test timeout ... waiting for getByLabel(/email/i)` — for a sign-in that had already
succeeded. The page snapshot at failure showed the signed-in Practice shell. The shell is
server-rendered and arrived after the 7s window, so the loop retried on a page that had already left
the sign-in form.

## The dev-server hydration failure is real and remains

A Next runtime chunk (`node_modules_next_dist_20wefz_._.js`) returns **403 to the browser and 200 to
curl** on `next dev`, and the HMR WebSocket handshake fails. React never hydrates, so the form is inert
markup. Reproduced on ports 3000 and 3100, against both production- and staging-pointed dev servers.

**The production build has neither problem** — that is how the journeys pass. `src/proxy.ts` excludes
`_next/static` and contains no 403 path, so this is not the application's middleware.

⚠ **This means authenticated smoke must run against a BUILT app, not `next dev`, on this machine.** The
underlying dev-server fault is unexplained and is a separate investigation.

## Now verified, having previously been unproven

The **production traffic block** has still never fired in anger, because no run has produced a request
to the production project. It is implemented, reviewed, and its two silent-failure modes are fixed —
but it remains a control that has not been observed doing its job.

## §11 Definition of Done

| Item | |
|---|---|
| Deterministic synthetic practitioner + Practice fixture in staging | done |
| Fixture reaches the Practice workspace without onboarding or chooser diversion | done |
| Journeys 3-6 pass locally | **done — 7/7** |
| Version-controlled column diff, unknown drift fails | done |
| Column parity permanent in the fidelity system | done |
| Journeys blocking in CI | **outstanding** |

---

## §6/§8 — wired into CI as a blocking gate, 2026-08-19

A second job, `smoke-authenticated`, runs the four credential-gated journeys against staging. The
existing credential-free `smoke` job is retained unchanged, as §6 requires — it proves a different
property (the app boots and fails closed against an unreachable database).

### Three properties, each rehearsed locally against the real CI invocation

| Property | Rehearsal | Result |
|---|---|---|
| Missing credentials **fail**, not skip | `CI=1`, staging env, secrets blanked | ✅ fails with the credential message |
| The job's own server command works | `PLAYWRIGHT_WEB_SERVER_CMD="npm run start -- -p 3100"` | ✅ suite ran against it |
| The journeys pass under CI settings | same, with credentials | ✅ **4 passed** |

⚠ The fail-closed test first failed on the **production guard** instead, because `.env.local` names
production — correct ordering, and it meant the credential path was not yet proven. Isolating it needed
the staging environment, which is the whole point of rehearsing the real invocation rather than a
convenient approximation.

### Secrets, and what the job does with them

Five repository secrets, all **staging-only**: `STAGING_SUPABASE_URL`, `STAGING_ANON_KEY`,
`STAGING_SERVICE_ROLE_KEY`, `SMOKE_PRACTITIONER_EMAIL`, `SMOKE_PRACTITIONER_PASSWORD`.

A pre-flight step names any that are missing and exits non-zero **without echoing values**. The
`NEXT_PUBLIC_*` pair must be present at BUILD time, not only at run time, because Next inlines them
into the client bundle.

### ⚠ No trace artifact from this job, deliberately

§4 forbids exposing secrets in traces. **A Playwright trace records the arguments of every action**, so
`fill(password)` would put the practitioner secret into an artifact any workflow-run viewer could
download. `playwright.config.ts` sets `trace: "off"` under CI. Verified in the rehearsal: **zero
`trace.zip` files written.** Screenshots are kept — a password input renders as dots.

### It builds rather than running `next dev`

Under `next dev` on this machine a Next runtime chunk is refused to the browser and React never
hydrates, so the sign-in form is inert. The job therefore runs `npm run build` then `npm run start`,
which is also the more representative artifact to test.

### Still unproven

The **production traffic block** has never fired. Both of its silent-failure modes are fixed and the
env guard above it is proven, but the network-level abort has not been observed doing its job.
