# COMP-ENG-002 §7 — Admin-client construction audit

**Scope:** the routes the Playwright smoke journeys exercise, per §12 step 2. Performed 2026-08-19,
before any staging project exists, because §6 forbids normalising a privileged key in CI *"merely
because a route currently throws without it"* — and that is exactly what had just been done.

## What prompted it

The smoke job went red twice. The cause was mechanical: `createAdminClient()`
(`src/lib/supabase/server.ts`) passes `process.env.SUPABASE_SERVICE_ROLE_KEY!` straight into
supabase-js, which throws `supabaseKey is required` when it is undefined. The first response was to add
a placeholder value to the CI job. §6/§7 require asking whether the route should be constructing a
privileged client at all. It should not. **The placeholder has been removed.**

## The five questions, per smoke-hit route

| Route | Constructs admin client? | Privileged access required? | Could an RLS client do it? | Construction | Fails safely? | Browser-reachable? |
|---|---|---|---|---|---|---|
| `/` | **No** | n/a | n/a | n/a | n/a | No |
| `/practice` (signed out) | **No** — `hasPracticeMembership()` returns at `shell.ts:319` on no user, *before* the client is built at `:320` | n/a on this path | n/a | Correctly lazy | Yes | No |
| `/practice/home` (signed out) | **No** — `resolvePracticeShell()` returns `AUTH_REQUIRED` at `shell.ts:80`, *before* the client is built at `:89` | n/a on this path | n/a | Correctly lazy | Yes | No |
| `/practice/sign-in` | **Yes** — `platformFlag(createAdminClient(), "practice_sign_in")` | **No** (see below) | **Yes**, with one policy | **Eager, unconditional, on every anonymous request** | **No — it crashed the route** | No |
| `/practice/home` (signed in) | Yes — membership, workspace, entitlement, session | **Yes** | No | Lazy, after auth | Loud, appropriately | No |

**Q5 answer for every row: NO.** All construction is in server components or server-only modules; no
privileged key reaches browser JavaScript or a `NEXT_PUBLIC_*` variable. Verified by inspection of every
`createAdminClient` import site on these paths.

## The finding

Two of the three unauthenticated smoke routes were **already correct** — they check for a user and
return before building anything privileged. The failure came from exactly one route, and generalises to
**five public, unauthenticated pages** that build a privileged client solely to read one boolean:

- `src/app/practice/sign-in/page.tsx`
- `src/app/practice/login/page.tsx`
- `src/app/practice/sign-up/page.tsx`
- `src/app/signup/page.tsx`
- `src/components/marketing/JourneyPage.tsx`

⚠ **The fail-safe already existed and was unreachable.** `platformFlag()` catches its own read error and
returns `false`, with a comment stating the intent plainly: *"a flag read failing must not take a public
marketing page down with it."* But the call site was `platformFlag(createAdminClient(), …)`, and an
argument is evaluated before the function it is passed to. **The safety net sat downstream of the thing
that broke.** Nothing was wrong with the author's reasoning; the construction simply moved out from under
it.

**Is privileged access functionally required here?** No. These pages read one boolean from
`practice_platform_flags` — a launch flag whose value is already observable from the rendered page. They
need a service-role client only because that table has RLS enabled with **no policy**, so an anon client
reads nothing. The privilege is compensating for an authorization gap, not expressing a real need.

## What was changed

`createAdminClientOrNull()` returns `null` rather than throwing when the environment cannot supply a
privileged client, and `platformFlag()` treats `null` as "cannot read → OFF" — the same verdict it
already reached for a failed read, for the same stated reason. The five pages above now use it.

**The CI placeholder was removed, and its absence is now part of the test:** the smoke job runs with
`SUPABASE_SERVICE_ROLE_KEY` unset, so a regression that reintroduces eager privileged construction on a
public page turns the job red instead of being masked.

⚠ **This is a mitigation, not the fix.** The architecturally correct answer is a policy permitting anon
`SELECT` on `practice_platform_flags`, which would remove the privileged dependency outright. RLS posture
on `practice_*` is a governance decision with real blast radius (`CLAUDE.md` § Tenant and data isolation
— 209 of 209 tables carry RLS with zero policies, and application-layer guards currently carry the whole
load). **Recorded here, deliberately not taken.**

## Scope note, stated rather than glossed

There are **802** `createAdminClient()` call sites in `src`. This audit covers the smoke path and the
public flag-reading pages only, which is what §12 step 2 asks for. The other sites are overwhelmingly
authenticated, server-side operations where privileged access is legitimate and where failing loudly is
correct — degrading those to `null` would convert a misconfiguration into silently missing data, which is
worse than a crash. A broader inventory is a separate exercise and is **not** claimed as done here.

## Recommendations

1. **Do not add `SUPABASE_SERVICE_ROLE_KEY` to the smoke job.** Its absence is now load-bearing.
2. **Consider the anon-SELECT policy on `practice_platform_flags`** as a governed change, which would
   let public pages drop the privileged client entirely rather than tolerate its absence.
3. **When staging exists**, the authenticated journeys will need a privileged key for *provisioning*
   only — a server-side step, per §6, never the browser job that runs Playwright.
