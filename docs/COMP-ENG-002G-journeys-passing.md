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
