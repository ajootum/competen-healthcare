# COMP-ENG-002 engineering stabilisation arc — PAUSED AT SAFE CHECKPOINT

**2026-08-19, owner decision.** Platform development returns to CP screen/HFE optimisation and product
completion. The outstanding security acceptance work below remains tracked and **must be completed
before the relevant production-release gate**, but does not block feature or UI development.

## Why this is a safe place to stop

Nothing is half-applied. Every migration written in this arc is applied to both projects, every control
added is green, and no branch is mid-flight.

| | |
|---|---|
| Working tree | clean, pushed to `main` |
| Migrations 332-338 | applied to production **and** staging |
| Harness suite | **29/29 green**, coverage control accounts for all 36 |
| Fidelity manifest | PASS against production **and** staging |
| Column parity | PASS — 7885 columns each side, allowlist **empty** |
| Smoke suite | 7/7 against staging |

## Completed and frozen

- **002 → 002F** — RLS/function/trigger/storage measurement, canonicalisation, and a clean build proving
  the repository can construct the database from scratch. Four classes of hidden bootstrap were found
  and closed (migrations 001, 188a, 336).
- **002G** — synthetic staging fixture, journeys 3-6 passing, authenticated smoke wired into CI as a
  blocking gate, and a permanent column-parity gate.
- **002H** — the browser 403 root cause (Next's dev-origin control; the `Origin` header was the whole
  browser-versus-curl discrepancy) and the production-target guard proven against simulated production
  with no network.
- **A production incident**, caused and repaired the same day: migration 001 was applied to production
  and reverted two objects migration 249 had hardened. Repaired by 335, verified, and 001 now refuses a
  non-fresh database. See `COMP-ENG-002-RECORD-001`.

## Outstanding — tracked, gated to the production-release gate, not blocking

| Item | State |
|---|---|
| `smoke-authenticated` marked a required check | **owner action** — a repository setting |
| Five staging secrets added to the repository | **owner action** |
| COMP-SEC-002 steps 3-10 | unblocked against staging, not started |
| Email verification flow | unblocked, not started |
| CSP enforcement against real staging routes | unblocked, not started |
| DR rehearsal against staging | unblocked, not started |
| ADR-008 phase 1 — estate capability/grant model | greenfield |
| 91 routes on inline auth | burn-down behind the auth-boundary allowlist |
| 13 REWORKED policy names | measured equivalent, not canonicalised |
| `plat_fk_registry()` | ⚠ `ON DELETE`/`ON UPDATE` actions are reproduced NOWHERE — gap hit twice |

### Three harnesses red on real product defects

Excluded from CI **by record**, not by neglect — each prints its reason on every run:

- `pui-header` — super-admin sidebar renders sign out, which the header doctrine forbids. **Needs an
  owner doctrine ruling**, not a mechanical fix.
- `umw-nav` (10/11) — sub-headings not hidden in the collapsed icon rail.
- `security-headers` (45/46) — structurally needs a built-and-started app; belongs in a future job.

## Two things a future session should know

⚠ **After changing `next.config.ts`, restart the dev server.** A server keeps its config from startup,
and a stale one reproduces the exact 403 the `allowedDevOrigins` fix removes — including the
native-submit sign-in failure that took most of a day to diagnose.

⚠ **Authenticated smoke needs `npm run dev:staging` (port 3100) or a build.** The ordinary dev server on
3000 points at production, and the suite will refuse it by design.
