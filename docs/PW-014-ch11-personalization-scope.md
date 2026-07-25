# PW-014 Chapter 11 — Personalization Framework: Delta Scope

**Companion to** `docs/PW-014-orchestration-scope.md` · **Basis:** PW-014 Ch.11 v2.0, audited against this repo
**Question answered:** *what does Chapter 11 add to the PW-014 work already done, and does it change the P5 decision?*

---

## 1. What Chapter 11 is

Chapter 11 is **not a new workspace and not an authorization mechanism.** It is the **user-preference layer (Layer 6)** of the composition inheritance chain — `platform → enterprise → tenant → facility/unit → role/workspace template → context → user → safety/authz filters` — turned into a full governed platform: per-user widget order/size/hidden/tabs, saved views, favorites, device/context profiles, personal AI preferences, versioning/restore/reset, cross-device sync, and the **property-level policy** (required / locked / overridable / optional / prohibited / conditional) that bounds all of it.

It **builds directly on P3** (the config-driven dashboard composition already shipped) and restates the same guardrails we already coded — *visibility is not authorization*, *no duplication of truth*, *policy before preference*. Its own acceptance set is **PXP-AC-01…16** (distinct from PW-AC-01…10).

## 2. What we already have that it builds on (grounded)

| Ch.11 need | §ref | Already in repo | Fit |
|---|---|---|---|
| Layered inheritance incl. **user** layer | 11.4 | `SCOPE_ORDER {…role:4, user:5}` + `resolveDashboardManifest` (P3) merges overrides along it | ✅ foundation exists; resolver reads user-scoped overrides today |
| Widget isolation (one failure ≠ blank page) | 11.14/11.16 | `WidgetBoundary` + `<Suspense>` per widget (P3, PW-AC-07) | ✅ done |
| Widget catalogue w/ contracts | 11.6.1 | `widget-catalog.ts` (WCE-005): `safety`, `layout`, `dataSource`, `displayModes`, `actions` | 🟡 contracts exist; missing `allowedUserOverrides`/`defaultState`/`allowedSizes`/`maxInstances`/`visibilityRule` |
| Entitlement Service (eligibility) | 11.10/11.11 | `resolveEntitlements` + `canEnterWorkspace` (P0) | ✅ done |
| Event Bus (personalization events) | 11.13.3 | `domain_events` outbox (P0) | ✅ transport exists; add `personalization.*` types |
| Override store + versioning + simulate | 11.11/11.17 | `workspace_config_overrides/versions/audit` (076), `simulate.ts`, `versioning.ts`, WCE Designer | 🟡 admin-layer only; `published` jsonb carries just `{enabled,label,order}` |
| Thin user prefs (theme/density/landing/notes) | 11.9/appearance | PW-012 `pw_prefs` cookie | 🟡 per-browser precursor to the profile store |
| Authorization remains authoritative | 11.10 | `canEnterWorkspace` primitive; **cross-tenant RLS gap still open** | 🟡 **P5 closes this** |

**Bottom line of §2:** the *composition spine, widget isolation, entitlement service, event transport and override/versioning machinery already exist.* Chapter 11 is mostly the **user-facing personalization platform + the property-policy governance** layered on top.

## 3. The genuine delta (what's NEW)

Grouped as a new workstream — call it **WS8 Personalization**. `NEW` = nothing today; `EXTEND` = enlarge an existing asset.

1. **Property-level policy states** `NEW` (11.4.1) — required / locked / overridable / optional / prohibited / conditional per widget/property. Today overrides only carry `enabled/order/label`. This is the governance core: `required`/`locked` beat user prefs; `prohibited` removes; `conditional` resolves by expression. Powers PXP-AC-02/03/05.
2. **User overrides beyond order** `NEW` (11.3/11.6) — size, hidden, displayStyle, position, per-user tabs. Resolver honors `order` today; the rest are new.
3. **Personalize mode UI** `NEW` (11.5.1) — the biggest frontend: explicit edit canvas, keyboard-accessible drag/resize, add-widget catalogue, add-tab, layout presets, inspector panel, policy indicators, undo/redo, unsaved-changes, live device preview. Nothing like it exists.
4. **Dashboard tabs** `NEW` (11.6.3) — user-named tabs (Today/Operations/…), breakpoint layouts per tab, lockable Home tab, grid-compaction conflict resolution.
5. **Saved views / navigation** `NEW` (11.7) — saved filters/columns/sort/searches/watchlists, pinned modules, quick actions, recent items — re-authorized at use, PHI-filtered. (Favorites partially exist in the launcher.)
6. **Workspace / context / device profiles** `NEW` (11.8) — per-workspace, per-acting-role, per-device-class layouts; shared-device + untrusted-device safe defaults.
7. **Personal AI preferences** `NEW` (11.9) — response format/verbosity, favorite prompts, personal-memory categories — subordinate to AI governance. (Copilot has static prompts only.)
8. **Personalization data model** `NEW` (11.12) — 10 server-side, RLS-isolated, schema-validated tables: `personalization_profile`, `dashboard_tab`, `widget_instance`, `widget_layout`, `preference_override`, `saved_view`, `favorite_item`, `preference_version`, `personalization_policy`, `sync_cursor`. (PW-012's cookie migrates into this.)
9. **Versioning / restore / reset / export / import** `EXTEND` (11.13) — at the user-profile level (WCE has this for admin config only).
10. **Cross-device sync + conflict detection** `NEW` (11.8.2) — `sync_cursor`, optimistic concurrency, structured merge — not last-write-wins. Cookie is per-device today.
11. **Concurrency + validation API contract** `NEW` (11.13.2) — ETag/If-Match/`expectedVersion`; `409` w/ merge proposal; `422` structured policy-lock/schema errors; `403` for entitlement (not hidden as validation).
12. **Full `resolveExperience()` resolver** `EXTEND` (11.14) — my `resolveDashboardManifest` is the enabled/order subset; Ch.11 wants property-policy enforcement + prohibited/required/locked/conditional + authz + license + safety filters + **provenance** ("why am I seeing this / managed by your organization").
13. **NCP/WCE personalization-envelope admin** `EXTEND` (11.17) — Designer toggles `enabled` today; Ch.11 wants the full envelope (mark required/locked/optional/prohibited/conditional, allowed sizes/positions/max-instances/tab limits, device rules) + per-persona simulation + rollback.
14. **Accessibility floor** `NEW` (11.2.3/11.14) — WCAG target, keyboard-only personalize, screen-reader placement announcements, contrast/zoom minimums users can't reduce.
15. **12 new REST endpoints + 6 events + 16 acceptance criteria + 8 work packages (PXP-01…08)** — a distinct delivery track.

**Size:** this is a **major workstream, comparable to the whole PW-001…013 build** (~20–30 dev-weeks). The bulk is PXP-04 (personalize-mode UI) and PXP-01/02/06 (schema + service + sync). The property-policy resolver (PXP-03) extends existing code.

## 4. Does it change the P5 decision? No — it makes P5 a prerequisite

Chapter 11's own rules are explicit: *"Authorization remains authoritative… hidden/visible state is never permission"* (11.2.3), **PXP-AC-04** ("visibility or placement never grants access to data or actions"), and 11.10.2 (clinical widgets need permission **and** context). **You cannot safely let users hide/add/rearrange widgets while the underlying data authz still has the cross-tenant RLS hole.** P5 (close the RLS gap, field-level access, break-glass, isolation tests) is exactly that authz floor — and it flips PW-AC-04/09/10 regardless.

So the sequencing is unchanged and reinforced:

- **Do P5 next** — it's a Chapter-11 prerequisite *and* independently flips 3 PW-AC.
- **Then WS8 Personalization**, phased PXP-01→08. Recommended **thin first slice** (high reuse, early value): add property-policy states (`required/locked/optional/prohibited`) to `widget-catalog.ts` + extend the manifest resolver to enforce them, and let users set **order / size / hidden** persisted to `workspace_config_overrides` at **user scope** (the resolver already reads that layer). That alone delivers PXP-AC-01/02/03/05/08 by reusing P3 — *without* yet building the profiles/tabs/saved-views/sync platform. Tabs, saved views, device profiles, AI prefs and cross-device sync follow as later PXP packages.

## 5. One-line answer

Chapter 11 adds a **large new governed personalization platform (WS8)** — property-policy governance, a personalize-mode UI, tabs, saved views, device/context profiles, personal AI prefs, a 10-table store, versioning + cross-device sync — layered on the P3 composition spine we already have. **It doesn't replace or defer P5; it depends on P5.** Recommendation: proceed with **P5**, then take WS8 starting from the thin property-policy + user-override slice that reuses the existing resolver.
