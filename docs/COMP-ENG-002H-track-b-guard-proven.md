# COMP-ENG-002H Track B — the production-target guard, proven

**2026-08-19.** `scripts/production-guard-harness.ts` — permanently blocking, no network, break-tested.

## Why it needed proving rather than reviewing

The guard was written, reviewed, and **twice found to be silently inert**:

1. `page.route()` returns a promise, and the first version discarded it with `void` — the interceptor
   was not guaranteed to install before the page navigated.
2. A path-oriented glob (`**/*.supabase.co/**`) cannot match a project id that lives in the **host**.

Both times it reported *no violation* — not because nothing was wrong, but because it was not running.
**A control that has never been seen to refuse anything is a claim, not a control.**

## One predicate, so the test proves the real path

`scripts/production-guard.ts` is now the single implementation. The fixture provisioner and the smoke
helper both call it; previously each carried its own copy and a hardcoded ref, so a negative test could
only have proved a third copy correct — §5: "Exercise the same guard code path used by real
smoke/provisioning automation."

## The §5 matrix, all green

| §5 row | Result |
|---|---|
| Known staging target | permitted |
| Synthetic non-production target | permitted |
| Simulated production project ref | refused |
| Simulated production Supabase URL | refused |
| Production identifier inside a plausible target (3 shapes) | refused |
| Missing / unidentifiable identity (5 shapes) | refused — **fails closed** |
| Bypass attempt | refused with `SKIP_PRODUCTION_GUARD`, `ALLOW_PRODUCTION`, `CI` all set |

Plus the request-level block, driven through the **real handler** with a fake route: a production auth
request is **aborted, not continued**; the abort precedes any dispatch, so nothing leaves the machine; a
staging request is allowed through; the violation names a host and is checked to contain no credential
shape.

⚠ **No network.** The production ref is used as data, never as a destination — nothing in the file can
open a socket.

## Break-tested two ways

| Injected defect | Harness |
|---|---|
| `isProductionUrl` always returns false | RED — 4 failures, including "aborted=false continued=true" |
| `UNIDENTIFIABLE` made to fail open | RED — all 5 missing-identity rows |

## §5 Definition of Done

| Item | |
|---|---|
| Demonstrably refuses a simulated production target | done |
| Exercises the same code path as real automation | done — one shared predicate |
| Never points at live production | done — no network at all |
| Failure occurs before privileged/network mutation | done — `route.abort()` precedes dispatch |
| No credentials in failure messages | done — asserted, not merely intended |
| Version-controlled and permanently blocking | done — 29/29 in the CI subset |

## One incidental finding

⚠ **A dev server keeps its `next.config.ts` from startup.** The suite regressed to native-submit
failures against a server that had been running since before the `allowedDevOrigins` fix; a clean
restart returned it to 200 and 7/7. Worth knowing: after changing `next.config.ts`, restart the dev
server — a stale one reproduces the exact 403 the fix removes.

Two harness corrections came out of the same run: the per-test timeout was arithmetically smaller than
its own retry loop (60s against 3 x 20s), and `waitForURL` was waiting for full page **load** when the
question it asks is whether the navigation **committed** — a successful sign-in timed out because the
dev-mode shell was still compiling.
