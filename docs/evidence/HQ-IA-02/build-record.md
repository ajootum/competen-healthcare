# COMPETEN-HQ-IA-02: Mission Control navigation redesign (S1–S3), build record

**Owner GO:** implement S1–S3, D1–D10 as recommended, S4 (WCE presentation overrides) deferred.
**Review:** `RELEASE-2026-10-25/HQ-IA-02-REVIEW.md` (outside the repo) and its per-route map.
**Migrations:** none. **Schema, capabilities, route intent, page guards:** unchanged.

## What changed

| Step | Change | Files |
|---|---|---|
| S1 | `nav-tables.ts` is now the versioned HQ navigation registry (`HQ_NAV_REGISTRY_VERSION` 1.0.0): seven workspaces → sections → items, each with a stable key and an optional `children` list and switch badge, plus `deep` links. No capability field. `ALL_NAV_TABLES` (one per workspace), `GENERAL_NAV` (every drawn section) and `HQ_SEARCH_TABLES` are derived from it. | `src/app/super-admin/_components/nav-tables.ts` |
| S2 | All 309 static HQ pages registered once as a home entry (307 drawn, 2 legacy deep links). This closes the CKRI research (8) and Quality Intelligence (3) gaps. The Practice section is **derived from PD_NAV** (11 modules + 74 children), which stays unchanged. Search reads the registry, children included and cross-links skipped. | `nav-tables.ts`, `src/lib/hq/search-catalogue.ts`, `layout.tsx` |
| S3 | The sidebar lists the seven workspaces. The active workspace (the page's home, by longest prefix) expands into its sections. An item's children show while you are inside it, and the lit row scrolls into view. Workspace labels go to the first destination the viewer can open (no new routes). Clinical Content Approval is homed in Governance & Administration, with cross-links (↗) from Learning and Research. D8 labels are disambiguated. Below `md`, HQ gets a menu bar and drawer showing the same sidebar (it had no mobile navigation before). | `WorkspaceSidebar.tsx`, `HqMobileNav.tsx`, `layout.tsx` |
| Switches | An "Off" badge appears where a product's own launch flag is off. It is read with one query using the products' own constants, and gives no badge when the read fails. It is never a visibility input. | `src/lib/hq/nav-switches.ts`, `NavLink.tsx` (optional `status`) |
| Filter | `filterHqNav` filters children by the same rule. Owners still get the same object back. | `src/lib/hq/nav-filter.ts` |

## Proofs

| Harness | Result | Note |
|---|---|---|
| `hq-nav-registry-harness` (new, CI) | 32/0 | Six planted breaks went red (missing page, wrong-capability child, second home, capability field, same-workspace cross, ambiguous label, bad `via`), and the file was restored byte-identical |
| `hq-nav-filter-harness` | 30/0 (1 live skip) | `itemsOf`/`countItems` now count children |
| `sidebar-active-harness` | 15/0 | Children are evaluated as rows; C6 is re-pointed to the row helper; 325 paths, one lit row each |
| `pd-nav-harness` | 34/0 | PD_NAV untouched |
| `hq-guard`, `plane-boundary`, `individual-config` | 51/0, 35/0, 43/0 | — |
| `individual-foundation` | 74/0 | 12j: the registry names switches by product, so `individual_app` is still spelled only in `gate.ts` |
| `pd-screen-doctrine` | 16/5 | **Same 16/5 on clean `origin/main`.** The failures are in PD pages this change does not touch. |
| vitest `src/lib/hq` | 58/58 | — |

**Browser** (dev server against staging, owner's existing staging session, read-only):

- Seven workspaces render, and each of 19 representative paths lights exactly one row.
- The legacy `/hospitals` deep link opens Products with no row lit.
- Search finds PD children (e.g. "errors" → Errors & Failures).
- The Off badges match staging's flags exactly.
- At 375px, the drawer opens, navigates and closes, with no sideways scroll once the page has loaded. The pre-existing `loading.tsx` skeleton (`w-96`) overflows while a page is loading.

## Not changed

- URLs.
- `HQ_ROUTE_INTENT`.
- Any `requireHqCapability`.
- PD_NAV and the PD sidebar.
- The Practice navigation.
- Flags, flag writers, schema.
- The WCE override layer (S4, deferred).
