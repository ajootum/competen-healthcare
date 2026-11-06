# HQ-PLATFORM-SEARCH-REGATE

Owner decision: RETAIN AND RE-GATE `/api/platform/search`. Retirement is not done here.

## Consumers (grep of src, scripts, docs, harnesses, 6 Nov 2026)
- `src/app/super-admin/platform-ops/search/SearchConsole.tsx` (client): the only caller of the route. Reads `groups`, `total`; now also `searched`.
- `src/app/super-admin/platform-ops/search/page.tsx`: imports `SEARCH_SOURCES` from `lib/platform/search.ts`; admits `hq.platform.operations.view`.
- `src/lib/platform/search.ts`: imported only by the route and that page.
- Links to the page: platform-ops landing tile and `nav-tables.ts` (`platform.no-code.search`).
- Scripts and harnesses: none call the route or the service. `scripts/plane-boundary-harness.ts` walks `src/app/api/platform` (ENTRY_DIRS), so the route is in its closure; it judges `practice_*` reads only and this route reads none. No allowlist change needed.
- Docs: `docs/PLATFORM-ARCHITECTURE-CONFORMANCE.md` lines 77 and 101 list it as built.

## What it reads (service role)
tenants(name, slug), hospitals(name), profiles(full_name, email), frameworks(name), framework_competencies(name, code), plat_workspaces(label, code; description matched), audit_log(entity_name, action; created_at ordering).

## Before
Route: legacy `isSuper` only. Page: `hq.platform.operations.view`, so an appointee saw "0 results" from a 403. Users and tenants links did not match their pages (`?id=` vs `?user=`; tenant detail is `/tenants/[id]`). Framework links pointed at the non-existent `/super-admin/frameworks`.

## After: capability per source
Tenants, Workspaces: hq.platform.operations.view. Organisations: hq.platform.tenants.view. Users: hq.platform.users.view. Frameworks: hq.learning.competencies.view (active only for non-owners, as that page lists). Activity: hq.platform.audit.view. Competencies (framework_competencies): owner only, no page found that governs those names. Owner reads all. Refused sources are not queried and not named.

## Limits
Min 2, max 60 cleaned (400 above 120 raw), 10 per source cap (default 6), `_` `%` `\` escaped in ilike. Framework description is no longer matched. No rate-limit helper exists in the repo (only a research-provider config field), so none was built.

## Redundancy (recommendation only)
Not redundant by consumer count (one console, wired in nav). Every source has its own page and directory with filters, so the console is a convenience layer; if usage is low, propose retirement separately.
