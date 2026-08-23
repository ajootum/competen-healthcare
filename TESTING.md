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
| Acceptance | 226 scripts under `scripts/*-harness.ts` | Does a specific, spec-derived invariant hold against the real system — a constraint, a boundary, a governance rule proven by a write that fails? | **25 in CI, blocking** (`scripts/ci-harnesses.ts`). The other 188 are local-only, run by a person with real credentials. See `docs/HARNESS-INVENTORY.md`. |

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

> ### ⚠ DO NOT RUN THE WHOLE SUITE WHILE ANYONE IS USING THE PRODUCT
>
> Measured 2026-08-21. Sixty-eight harnesses into a full sweep, **Supabase Auth on the shared project
> was returning HTTP 504 after 35–50 second timeouts** — to the dev server, to plain `fetch`, and to the
> owner trying to sign in. It reads exactly like an outage. It is not: it is the sweep.
>
> ```
> before stopping   504 in 50357ms / 504 in 35815ms / 504 in 43726ms
> after stopping    503 in 3955ms / 503 in 5042ms / 200 in 3039ms / 200 in 366ms
> ```
>
> The privileged-live harnesses provision workspaces and call GoTrue admin APIs. Run enough of them
> back to back and the auth service sheds load — which it is entitled to do, and which every OTHER
> harness in the run then fails against, for a reason that has nothing to do with the code.
>
> Two consequences, and the second is the one that costs time:
>
> 1. **Schedule a full sweep for when nobody is working.** It degrades a shared dependency.
> 2. **A red harness late in a sweep is not evidence until it is re-run alone.** Under this load the
>    failures are indistinguishable from real ones. Two partial runs on 2026-08-21 agreed on the same
>    five reds inside the first 68, which is what made those five trustworthy — agreement across runs,
>    not their presence in one.
>
> The `pure/local` harnesses cause none of this. When the question is "did I break something in the
> last hour", run those and the ones for the area you touched, not the estate.

**Full inventory, classification method, and every caveat: `docs/HARNESS-INVENTORY.md`.** Summary, not a
substitute for reading it:

- **221 scripts.** 32 need no database at all (`pure/local`). **That pass has now been done** (2026-08-18):
  every one of the 32 was run twice with a scrubbed environment, and **22 are in CI as a blocking job**.

  ⚠ **`pure/local` did not mean `CI-safe`, and the gap was not small.** Ten of the 32 do not belong in CI:

  - **Six were RED on real, pre-existing defects** the pass discovered rather than introduced. **Two are
    now fixed and in CI** (see below); the rest remain excluded with the defect named: three clinical
    timestamps rendered with no explicit locale (`clock-format`); sign out rendered in the super-admin
    sidebar (`pui-header`); stray text in the collapsed icon rail (`umw-nav`); and `security-headers`,
    which also needs a built and started server.
  - **Four would have reported green for a reason unrelated to what they check**: `practice-bundle` skips
    to PEND without a build and still exits 0; `practice-outbox-durability` needs a dev server and Chrome,
    and only passed screening because a dev server happened to be running; `pui-migration` compares a
    working-tree diff, and a clean checkout has none; `sso` fetches live Supabase, loading `.env.local`
    via `loadEnvConfig` — which is how it survived an `env -u` scrub and reported real data.

  Wiring all 32 in on the strength of the tier label would have produced a pipeline born red **and** four
  checks that pass while proving nothing.

  **`pui-a11y` and `pui-components` are now fixed and in CI (2026-08-19) — and they were red for opposite
  reasons, which is why both had to be read rather than assumed:**

  - **`pui-a11y` was right.** Two surfaces declared `aria-modal="true"` while Tab walked out behind the
    overlay (`PracticeShortcuts`, `HqSearchLauncher`), and a third — the lock screen — had a hand-rolled
    trap bound to its own panel's `onKeyDown`, so it **only engaged once focus was already inside, and
    nothing moved focus in**. Somebody locked out mid-record kept focus on the record. All three now use
    `useModalFocus`; the hook gained a `dismissOnEscape` option so the lock screen keeps its no-Escape
    semantics instead of keeping its own broken copy.
  - **`pui-components` was itself stale.** It asserted that the focus implementation lived in
    `interactive.tsx`, but a refactor had moved it into `use-modal-focus.ts` — the components were
    correct and the harness was pinned to where the code used to be. Its checks now assert the behaviour
    where it lives *and* that every modal surface still consumes it, which is the part that actually
    regresses. One check also matched its own explanatory comment (`"Focus the CANCEL control first"`)
    and now asserts the mechanism instead: the hook focuses the first focusable, and Cancel is rendered
    before Confirm, verified by source position. `scripts/ci-harnesses.ts` records every exclusion with its
  reason, prints them on every run, and fails if a newly added `pure/local` harness lands in neither list.
  The six red ones are tracked bugs, not disappeared ones — fixing each and moving it into `INCLUDED` is
  the intended end state.
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
   **And the 22 credential-free harnesses pass** — CI `harnesses` job, always.
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
