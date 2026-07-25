// PCS-PORT-001 admin loader — the full product-portfolio tree (Portfolio → Suite → Product) with each product's
// workspace mappings + per-tenant licence status, plus the tenant list and dependency/impact stats. Backs the
// no-code admin console (Portfolio Manager / Suite Designer / Product Assignment / Licensing Matrix / Dependency
// + Impact). Reads the PCS packaging model (migration 105) — distinct from the POP-001 billing model
// (plat_products/plans/subscriptions behind the Licensing & Subscription Centre); reconciling the two "product"
// concepts is a noted follow-up. Fail-soft: unprovisioned store → empty tree.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { WORKSPACE_REGISTRY } from "@/lib/orchestration/registry";
const q = async (p: Promise<any>) => { try { const r = await p; return r?.error ? [] : (r?.data ?? []); } catch { return []; } };

export async function loadPortfolioAdmin(admin: any) {
  const [portfolios, suites, products, mappings, licenses, tenants] = await Promise.all([
    q(admin.from("product_portfolios").select("id, name, description, status").order("created_at")),
    q(admin.from("product_suites").select("id, portfolio_id, name, code, icon, color, sort_order, parent_suite_id, visibility, status").order("sort_order")),
    q(admin.from("products").select("id, suite_id, name, code, version, license_type, status").order("name")),
    q(admin.from("product_workspaces").select("product_id, workspace_key")),
    q(admin.from("tenant_product_licenses").select("tenant_id, product_id, status, valid_to").eq("status", "active")),
    q(admin.from("tenants").select("id, name, slug").order("name")),
  ]);

  const mapByProduct = new Map<string, string[]>();
  for (const m of mappings) { const a = mapByProduct.get(m.product_id) ?? []; a.push(m.workspace_key); mapByProduct.set(m.product_id, a); }
  const licenseSet = new Set(licenses.map((l: any) => `${l.tenant_id}:${l.product_id}`));
  const licCountByProduct = new Map<string, number>();
  for (const l of licenses) licCountByProduct.set(l.product_id, (licCountByProduct.get(l.product_id) ?? 0) + 1);

  const productsBySuite = new Map<string, any[]>();
  for (const p of products) {
    const enriched = { ...p, workspaces: mapByProduct.get(p.id) ?? [], licensedTenants: licCountByProduct.get(p.id) ?? 0 };
    const a = productsBySuite.get(p.suite_id) ?? []; a.push(enriched); productsBySuite.set(p.suite_id, a);
  }
  const suitesByPortfolio = new Map<string, any[]>();
  for (const s of suites) { const a = suitesByPortfolio.get(s.portfolio_id) ?? []; a.push({ ...s, products: productsBySuite.get(s.id) ?? [] }); suitesByPortfolio.set(s.portfolio_id, a); }

  const tree = portfolios.map((pf: any) => ({ ...pf, suites: suitesByPortfolio.get(pf.id) ?? [] }));
  const unsuitedProducts = products.filter((p: any) => !p.suite_id).map((p: any) => ({ ...p, workspaces: mapByProduct.get(p.id) ?? [], licensedTenants: licCountByProduct.get(p.id) ?? 0 }));

  // Impact / dependency stats.
  const mappedProducts = products.filter((p: any) => (mapByProduct.get(p.id)?.length ?? 0) > 0).length;
  const stats = {
    portfolios: portfolios.length, suites: suites.length, products: products.length,
    mappedProducts, orphanProducts: products.length - mappedProducts,
    tenants: tenants.length, activeLicenses: licenses.length,
    gatedWorkspaces: new Set(mappings.map((m: any) => m.workspace_key)).size,
  };

  // The workspace-registry keys available for mapping (exclude 'personal' — never gated).
  const workspaceKeys = WORKSPACE_REGISTRY.filter(w => w.key !== "personal").map(w => ({ key: w.key, label: w.label, kind: w.kind }));

  return { tree, unsuitedProducts, products, tenants, licenseSet: [...licenseSet], stats, workspaceKeys, provisioned: portfolios.length + suites.length + products.length > 0 };
}
