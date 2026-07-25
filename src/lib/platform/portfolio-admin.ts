// PCS-PORT-001 admin loader — the full product-portfolio tree (Portfolio → Suite → Product) with each product's
// workspace mappings + per-tenant licence status, plus the tenant list and dependency/impact stats. Backs the
// no-code admin console. RECONCILED (migration 106): products ARE the canonical POP-001 `plat_products` catalogue
// (keyed by `code`), organized into PCS suites via plat_products.suite_id; PCS adds only the packaging + gating
// dimensions (portfolios/suites, product_workspaces, tenant_product_licenses keyed by product_code). Fail-soft.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { WORKSPACE_REGISTRY } from "@/lib/orchestration/registry";
const q = async (p: Promise<any>) => { try { const r = await p; return r?.error ? [] : (r?.data ?? []); } catch { return []; } };

export async function loadPortfolioAdmin(admin: any) {
  const [portfolios, suites, products, mappings, licenses, tenants] = await Promise.all([
    q(admin.from("product_portfolios").select("id, name, description, status").order("created_at")),
    q(admin.from("product_suites").select("id, portfolio_id, name, code, icon, color, sort_order, parent_suite_id, visibility, status").order("sort_order")),
    q(admin.from("plat_products").select("code, name, description, is_core, sort, suite_id").order("sort")),
    q(admin.from("product_workspaces").select("product_code, workspace_key")),
    q(admin.from("tenant_product_licenses").select("tenant_id, product_code, status").eq("status", "active")),
    q(admin.from("tenants").select("id, name, slug").order("name")),
  ]);

  const mapByProduct = new Map<string, string[]>();
  for (const m of mappings) { const a = mapByProduct.get(m.product_code) ?? []; a.push(m.workspace_key); mapByProduct.set(m.product_code, a); }
  const licenseSet = new Set(licenses.map((l: any) => `${l.tenant_id}:${l.product_code}`));
  const licCountByProduct = new Map<string, number>();
  for (const l of licenses) licCountByProduct.set(l.product_code, (licCountByProduct.get(l.product_code) ?? 0) + 1);

  const enrich = (p: any) => ({ ...p, workspaces: mapByProduct.get(p.code) ?? [], licensedTenants: licCountByProduct.get(p.code) ?? 0 });
  const productsBySuite = new Map<string, any[]>();
  for (const p of products) { if (!p.suite_id) continue; const a = productsBySuite.get(p.suite_id) ?? []; a.push(enrich(p)); productsBySuite.set(p.suite_id, a); }
  const suitesByPortfolio = new Map<string, any[]>();
  for (const s of suites) { const a = suitesByPortfolio.get(s.portfolio_id) ?? []; a.push({ ...s, products: productsBySuite.get(s.id) ?? [] }); suitesByPortfolio.set(s.portfolio_id, a); }

  const tree = portfolios.map((pf: any) => ({ ...pf, suites: suitesByPortfolio.get(pf.id) ?? [] }));
  const unsuitedProducts = products.filter((p: any) => !p.suite_id).map(enrich);

  const mappedProducts = products.filter((p: any) => (mapByProduct.get(p.code)?.length ?? 0) > 0).length;
  const stats = {
    portfolios: portfolios.length, suites: suites.length, products: products.length,
    mappedProducts, orphanProducts: products.length - mappedProducts,
    tenants: tenants.length, activeLicenses: licenses.length,
    gatedWorkspaces: new Set(mappings.map((m: any) => m.workspace_key)).size,
  };
  const workspaceKeys = WORKSPACE_REGISTRY.filter(w => w.key !== "personal").map(w => ({ key: w.key, label: w.label, kind: w.kind }));

  return { tree, unsuitedProducts, products: products.map(enrich), tenants, licenseSet: [...licenseSet], stats, workspaceKeys, provisioned: portfolios.length + suites.length + products.length > 0 };
}
