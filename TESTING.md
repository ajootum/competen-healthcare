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

- **230 scripts** (re-measured 2026-08-27; was 221). **48** need no database at all (`pure/local`). **That
  pass has now been done** (2026-08-18): every one was run twice with a scrubbed environment, and **43 are
  in CI as a blocking job**, 5 excluded by record.

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
- **182 are `privileged-live`** — they touch a real Supabase project. Per this repo's existing CI design
  (`ci.yml`'s own header: *"the database harnesses authenticate with the service-role key, and that key
  does not belong in GitHub"*) and per COMP-ENG-001 §7 (*"never run acceptance harnesses that mutate data
  against production as a routine CI action"*), **none of these 182 run in CI.** They run locally, by a
  person holding the real `SUPABASE_SERVICE_ROLE_KEY`.

  ⚠ **THIS ENTRY USED TO SAY "There is no staging project." THAT STOPPED BEING TRUE.** A staging project
  exists and carries the schema — verified 2026-08-27: `/auth/v1/health` answers, and `hq_capability`
  holds 50 rows there against production's 50. `scripts/production-guard.ts` already knows both refs, and
  `STAGING_SUPABASE_URL` / `STAGING_SERVICE_ROLE_KEY` / `STAGING_DB_URL` are configured locally. So the
  161 mutating harnesses are no longer *unrunnable* — they are *unrun*, which is a different problem with
  a different fix.

  ⚠⚠ **AND UNTIL 2026-08-27 NOTHING TRACKED THESE 182 AT ALL.** `ci-harnesses.ts` has a coverage control,
  but it filters `tier === "pure/local"` — so it guaranteed only that those 48 were accounted for. That is
  the structural reason `anon-exposure-harness.ts` sat written, correct and never run while two tables
  served a real patient's diagnosis and medication to the anon key. **"Written, correct, and unwired" was
  not an accident that happened once; it was the default state of 79% of this estate's checks.**
  `scripts/privileged-harnesses.ts` is the missing half — see below.
### `scripts/privileged-harnesses.ts` — the runner and coverage control for the other 182

```
npx tsx scripts/privileged-harnesses.ts              the SECURITY subset (12, read-only)
npx tsx scripts/privileged-harnesses.ts --all        also the 7 triaged non-security ones
npx tsx scripts/privileged-harnesses.ts --list       every list, running nothing
npx tsx scripts/privileged-harnesses.ts --untriaged  the 161 nobody has screened
```

Four lists — **SECURITY** (12, read-only, security-critical, run by default), **TRIAGED** (7, read-only,
verified, not a boundary), **EXCLUDED** (2, with the reason, printed every run), and **UNTRIAGED**, which
is *derived*: anything privileged-live in none of the other three. A harness added tomorrow lands there
automatically and pushes the count past `UNTRIAGED_CEILING`, which goes red. **Lower the ceiling as
harnesses are screened; never raise it.**

⚠ **A green run means the screened subset passed. It does not mean the estate is checked** — it means 161
checks have still never been run by anybody, and the run prints that number every time.

⚠⚠ **THE AUTO-RUN SET IS CHECKED, NOT PROMISED — AND IT IS CHECKED TWICE.** 161 of the 182 write to the
database and `.env.local` points at production, so a curated "these are read-only" list would be one
fixture away from writing to the live project. Every run re-derives it:

1. **The classifier's `mutates` flag.** A harness that gains a single `.insert(` leaves the auto-run set
   by going red, not by being remembered.
2. **A raw-SQL detector**, because the first has a known blind spot. `harness-classify.ts` looks for
   `.insert(` / `.delete(` *method calls*; a harness holding a raw `pg` client writes
   `await c.query("delete from …")` and matches none of them.
   **`cascade-immutability-ratchet-harness.ts` is exactly that: it creates a real workspace over a raw
   connection, reports `mutates:false`, and screened GREEN.** On the classifier's evidence alone it would
   have joined the security set and begun writing to production on every run. It is now EXCLUDED with
   that reason, and the second detector is deliberately over-sensitive — it flags prose too, and each hit
   must carry a recorded review. A false positive costs one line; a false negative costs a production
   write.

The detector has its own inertness control (it is fed a known raw `DELETE` on every run), and all four
gates are break-tested: a mutating harness admitted, `cascade-immutability-ratchet` admitted, one file in
two lists, and one file dropped from every list. All four go red.

### The writing harnesses, against staging

```
npx tsx scripts/privileged-harnesses.ts --staging                run the screened writing harnesses
npx tsx scripts/privileged-harnesses.ts --staging --screen 20 --from 40   triage the next batch
```

`--staging` remaps the same three variables `dev-staging.mjs` and `smoke-staging.mjs` already remap, so
the harness and the guard agree about which project is under test. The remap is **spawn-time** — no
harness file is edited — and it rests on one fact: `loadEnvConfig` must not overwrite an already-set
variable, or every harness would hit production while the runner printed the staging ref.

⚠⚠ **THAT FACT IS CHECKED ON EVERY RUN, NOT TRUSTED.** `scripts/_staging-probe.ts` is spawned with exactly
the environment the harnesses get, runs `loadEnvConfig` the way they do, and reports which project it
resolved. Nothing executes unless the answer is staging. Break-tested by removing the URL remap: it names
the production ref, says the remap did not survive, and refuses to run any writing harness.

⚠ **The key is checked by USING it, not by reading it.** The first version decoded the service-role key's
JWT for its project ref — which works for production's legacy JWT and returns nothing for staging's newer
`sb_secret_…` key (41 chars, no dots, no payload). It reported "belongs to project unreadable" and refused:
the guard being right for the wrong reason. Keys are project-scoped, so authenticating with it is the real
test, and it holds for both formats. The probe reads and never writes.

**Staging is real but BEHIND:** 665 of production's 671 tables. The six missing come from migrations
**349, 352, 353 and 357**. Measured, not assumed: none of the 161 writing harnesses reference any of them,
so the drift does not block this — but applying those migrations is outstanding, and owner-only.

**Triage so far (2026-08-27): 46 of 161 screened, 27 promoted.** The rest are UNTRIAGED and the ceiling is
`134`. Failure classes found, none of which are defects in this runner:

- **Four genuinely hang** against staging (`practice-audit`, `practice-availability-config`,
  `practice-billing`, `practice-booking-rules`) — 240s timeout, twice, in independent runs. ⚠ My first
  reading blamed the 504 load-shedding above, because they clustered at the end of a 40-harness batch.
  Re-running that slice **alone** reproduced them exactly while their neighbours passed, which is what
  makes them trustworthy: agreement across runs, not presence in one.
- **Missing staging seed data** — `cgr-gate` ("at least one required competency is needed"),
  `hww-census` (a `NOT NULL` on `op_patients.hospital_id`), `learning-provenance` (null id).
- **Real assertion failures worth reading** — `identity-join` 22/1, `platform-flag-gate` 19/1,
  `hq-guard`, `governance-context`, `platform-membership`.
- **Two die on a libuv `UV_HANDLE_CLOSING` assertion at exit** — the Windows `process.exit()`-during-flush
  crash `mail-send-check.ts` already documents ("set the code, do not call `process.exit`").

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
