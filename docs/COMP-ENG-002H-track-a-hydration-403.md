# COMP-ENG-002H Track A — the browser 403, root cause and fix

**2026-08-19. RESOLVED.** Next's control was working exactly as designed; the host we tested from was
not the one it trusts.

## The discriminator: the `Origin` header

Measured against the running dev server, same chunk, four requests:

| Request | Result |
|---|---|
| `curl`, no `Origin` header | **200** |
| `Origin: http://localhost:3000` | **200** |
| `Origin: http://127.0.0.1:3000` | **403** |
| `Origin: http://evil.example` | **403** |

Next 16 blocks cross-origin requests to dev-only assets, allowing only the hostname the server was
initialised with — `localhost` — per the vendored documentation at
`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/allowedDevOrigins.md`.

**`curl` sends no `Origin`. The browser does**, on the crossorigin script tags Next emits. That single
header is the entire browser-versus-curl discrepancy, and assuming a 200 from curl meant the browser
request was equivalent is precisely what §3 warned against.

## Why it looked like everything except what it was

The chunk that was refused is a Next **runtime** chunk, so React never hydrated. The sign-in form was
inert markup, and its submit button fell through to the browser's default GET submission. Over the
investigation the same root cause presented as:

- a navigation timeout with no explanation
- `locator.fill` timing out on a field that was plainly visible
- "no Supabase request was ever made", with no error shown on the page
- a URL that gained a bare `?` — the only clue that pointed at a native submit

## The fix, and why it is in `next.config.ts` rather than the test

`allowedDevOrigins: ["127.0.0.1"]`.

`playwright.config.ts` pins the literal loopback address on purpose: on Linux, `localhost` can resolve
to `::1` while `next dev` listens on IPv4 — a failure that cannot reproduce on this Windows machine and
therefore reached CI once already. **Switching the suite back to `localhost` would trade this defect for
that one.**

⚠ **The boundary is preserved, and re-verified after the change**: `127.0.0.1` now returns 200,
`evil.example` still returns 403. `allowedDevOrigins` has no effect on a production build, so no
production-specific workaround is introduced.

## Corrected characterisation

I previously wrote that this "affects ordinary local development". **That was too broad.** Ordinary
development at `http://localhost:3000` was never affected — only access via `127.0.0.1`, which is what
the smoke suite uses. The narrower statement is the true one.

§3 also asks why Playwright succeeded where hydration failed: **it did not.** It passed only against a
production build, which has no dev-origin check. Against `next dev` it failed exactly as a browser did.

## Regression protection

`scripts/dev-origin-harness.ts`, in the blocking CI subset (28/28 green). It asserts the two configs
agree — `allowedDevOrigins` contains `127.0.0.1`, and Playwright's default base URL still uses it — and
fails on a wildcard origin, because widening who may reach a dev server is a security decision and
should not be reachable by accident while fixing a test. Comments are stripped before matching, so the
explanation above cannot satisfy the assertion. Break-tested: removing the entry turns it red.

## §4 Definition of Done

| Item | |
|---|---|
| Root cause identified and documented | done — the `Origin` header |
| Browser/curl difference explained | done |
| Correct local browser hydration succeeds | done — **7/7 journeys pass against `next dev`** |
| Security boundary preserved or strengthened | done — foreign origin still refused, re-verified |
| Regression protection where mechanically testable | done — harness in CI |
| No production-specific workaround | done — dev-only setting |
