# Testing

COMP-ENG-001 §7: *"Create TESTING.md documenting when each test layer runs and what evidence is
required before merge/release."*

This repo has three distinct test layers, and they exist for different questions. Confusing them —
treating a harness result as proof of what a unit test proves, or vice versa — is how a real gap passes
review looking covered.

## The three layers

| Layer | Tool | Question it answers | Runs |
|---|---|---|---|
| Unit | Vitest | Does this function do what it claims, in isolation? | **CI, every push/PR, blocking** |
| Smoke | Playwright | Does the app boot and serve its critical routes? | **Not yet wired.** Installed (`@playwright/test`), zero spec/config files exist. Deferred — see below. |
| Acceptance | 212 scripts under `scripts/*-harness.ts` | Does a specific, spec-derived invariant hold against the real system — a constraint, a boundary, a governance rule proven by a write that fails? | **Local only, run by a person with real credentials.** See `docs/HARNESS-INVENTORY.md`. |

## Unit tests (Vitest) — CI, blocking

`npm run test` runs everything under `src/**/*.test.ts` (the include pattern in `vitest.config.ts`).

**Confirmed before wiring into CI** (COMP-ENG-001 §9 step 5's own requirement — "confirm deterministic
pass/fail behavior"):
- 10 test files, 84 tests, two consecutive local runs, identical result both times.
- None of the 10 imports `@supabase/supabase-js` or references any Supabase env var — grep-confirmed,
  not assumed. This is why the CI `test` job needs no secrets: it genuinely doesn't touch the database.

**Evidence required before merge:** the `test` job in `.github/workflows/ci.yml` is green. No separate
sign-off needed — this layer is fully mechanical.

## Smoke tests (Playwright) — deferred, not yet built

`@playwright/test` is a devDependency. There is no `playwright.config.ts` and no spec files. COMP-ENG-001
§9 step 6 asks for *"a minimal Playwright smoke suite"* covering *"critical smoke paths only."*

**Why this isn't done in the same pass as Vitest:** picking which routes count as "critical" is a
product decision (which paths, across Practice / Enterprise / HQ / landlord, would actually indicate the
app is broken if they 500), not a mechanical wire-up like adding an existing, already-passing test suite
to CI was. Building a real, useful smoke suite needs that decision made first, or it becomes an arbitrary
list nobody agreed to.

**Status:** open. Next step is deciding the initial route list, not writing Playwright config — the
config is the easy part once the list exists.

## Acceptance harnesses — local only

**Full inventory, classification method, and every caveat: `docs/HARNESS-INVENTORY.md`.** Summary, not a
substitute for reading it:

- **212 scripts.** 32 need no database at all (`pure/local`) and are theoretically CI-safe today, pending
  a pass to confirm each runs cleanly and deterministically outside a developer's machine — not yet done,
  not claimed as done.
- **180 touch the one live Supabase project this repo has.** There is no staging project. Per this repo's
  existing CI design (`ci.yml`'s own header: *"the database harnesses authenticate with the service-role
  key, and that key does not belong in GitHub"*) and per COMP-ENG-001 §7 (*"never run acceptance harnesses
  that mutate data against production as a routine CI action"*), **none of these 180 run in CI.** They run
  locally, by a person holding the real `SUPABASE_SERVICE_ROLE_KEY`.
- Every harness in this codebase follows the same discipline: it proves a constraint or a boundary by
  attempting the violation and watching it fail, not just by reading a happy path. A harness that has
  never been made to go red by a deliberately broken change is not yet trusted — several harnesses in
  this repo's history have been rewritten after passing for the wrong reason (asserting a refusal
  happened without checking *which* rule caused it, a control with an escape hatch, a needle that matched
  its own explanatory comment).

**Evidence required before merge, for a change touching an area with a harness:** the relevant
harness(es) re-run locally against the real database, and the result — pass or fail, with output — is
stated in the PR or commit, not just claimed. **Evidence required before release:** the harnesses covering
the release's changed areas, at minimum; a full 212-script run is not a routine requirement (COMP-ENG-001
§11 non-goal: *"running all 212 harnesses on every commit"*) but is the release-gate expectation for
anything touching a broad or security-relevant surface.

## What "done" looks like for a change

1. **Types and lint pass** — CI `quality` job, always.
2. **No secret shipped, no new high/critical unallowlisted dependency** — CI `security` job, always.
3. **Any migration touched passes house rules** — CI `migrations` job, on migration changes.
4. **Unit tests pass** — CI `test` job, always.
5. **Any harness whose invariant the change could affect has been re-run locally**, and the result is
   stated, not assumed. If unsure whether a harness applies, `docs/HARNESS-INVENTORY.md`'s spec-ref
   column is the fastest way to find one by the spec ID you're implementing against.
6. **A migration is not committed until the repository owner confirms it was applied** — see `CLAUDE.md`
   § Database. This isn't a testing rule, but it's the same discipline: don't claim something is true of
   the live system without having checked the live system.

## Regenerating the harness inventory

`docs/HARNESS-INVENTORY.md`'s table is generated, not hand-maintained. After adding, removing, or
substantially changing a harness:

```bash
npx tsx scripts/harness-classify.ts        # human-readable summary
npx tsx scripts/harness-classify.ts --md   # the table docs/HARNESS-INVENTORY.md embeds
```

The classifier's own header comment (`scripts/harness-classify.ts`) documents exactly what it can and
cannot detect — read it before trusting a column you haven't independently checked.
