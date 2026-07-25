# WS-PCS — Product Portfolio & Suite Configuration (PCS-PORT-001): placement + status

**Companion to** `docs/PW-014-orchestration-scope.md` · **Basis:** PCS-PORT-001

## Where it fits

PCS-PORT-001 is a **commercial packaging + licensing layer**, orthogonal to the user experience: `Portfolio → Suite → Product → Workspace → Module → Page → Widget`. Its own acceptance criteria mandate that *users keep accessing role-based workspaces, not suites* and *existing workspace architecture stays unchanged*. So it neither competes with nor blocks the PW-014 user-facing tracks (Realtime P2b, Chapter 11 personalization WS8).

It is an **extension of infrastructure already built** — more than the spec assumes:
- The **Platform Config Registry** (migration 092) already registers objects by `object_type`, and the enum already includes `PRODUCT_SUITE`, `WORKSPACE`, `MODULE`, `PAGE`, `WIDGET`, `FEATURE_FLAG`.
- `src/lib/platform/` already has a feature-flag + control-plane layer.
- The **Workspace Registry** + **`resolveEntitlements`** (P0) are the runtime it plugs into.

Crucially it **fills a slot PW-014 already reserves**: Chapter 11's `resolveExperience()` (§11.14) has a `licenseAndFeatureFilter(composed, tenant)` step, and §11.10 names a "Feature Management Service … before catalogue eligibility." PCS-PORT-001 *is* that layer. The composite gate becomes: **Licensed (suite/product) → Entitled (role/org) → Personalized (user) → Authorized (server re-auth).**

## Phasing

- **(a) Model — ✅ SHIPPED.** `105-product-portfolio.sql`: `product_portfolios`, `product_suites` (nestable), `products` (license_type), `product_workspaces` (Product→Workspace-registry-key map), `tenant_product_licenses`. Service-role only.
- **(b) Runtime license filter — ✅ SHIPPED.** `src/lib/orchestration/licensing.ts` (`loadTenantLicensing` / `isWorkspaceLicensed`) composed into `resolveEntitlements` — so launcher, landing and `/api/me/workspaces` all honour licensing. **Fail-open + non-breaking:** a workspace is licence-gated only when mapped to a product; unmapped workspaces, unknown tenant, or unprovisioned store all resolve to available. Proven end-to-end by `scripts/verify-licensing.mjs`.
- **(c) Admin UIs — follow-up (the bulk).** Portfolio Manager, Suite Designer, Product Assignment, Licensing Matrix, Dependency + Impact viewers, in `super-admin/platform-ops`; register `PORTFOLIO`/`PRODUCT` as Config-Registry object types so the Designer/dependency views surface them. Also the manifest/`resolveExperience` composition path gets the same license pre-filter (currently applied at workspace entitlement).

## Security note

Licensing is a gate, not just navigation: a workspace hidden as "unlicensed" must **also** be denied server-side (same *visibility ≠ authorization* rule enforced in P5). The filter lives in the server resolver (`resolveEntitlements`), not only the nav generator — correct by construction.

## Sequencing

A **parallel platform-config track**, independent of the remaining PW-014 user-facing work. Its runtime integration was cheap because the resolvers already existed (done here); the admin UIs are where the real remaining effort is (~a mid-size super-admin section).
