// PCS-PORT-001 (foundation) — the runtime licensing filter. Resolves which workspaces are licensed for a tenant,
// composing with (not replacing) role entitlement: a workspace is available iff LICENSED and ENTITLED. This is the
// "license/feature filter" PW-014 §11.14 resolveExperience reserves. FAIL-OPEN + NON-BREAKING: a workspace is
// licence-gated ONLY if mapped to a product (product_workspaces); unmapped workspaces, an unknown tenant, or an
// unprovisioned store all resolve to "available" — so nothing changes until an admin actually maps + licenses.
/* eslint-disable @typescript-eslint/no-explicit-any */
const q = async (p: Promise<any>) => { try { const r = await p; return r?.error ? { data: [], provisioned: !/does not exist|schema cache/i.test(r.error.message ?? "") } : { data: r?.data ?? [], provisioned: true }; } catch { return { data: [], provisioned: false }; } };

export type TenantLicensing = {
  provisioned: boolean;                     // false = licensing store absent → treat everything as available
  gated: Map<string, Set<string>>;          // workspace_key → product_codes that gate it (mapped = licence-gated)
  licensedProducts: Set<string>;            // product_codes actively licensed for this tenant (valid today)
};

export async function loadTenantLicensing(admin: any, tenantId: string | null): Promise<TenantLicensing> {
  const empty: TenantLicensing = { provisioned: false, gated: new Map(), licensedProducts: new Set() };

  const mapRes = await q(admin.from("product_workspaces").select("product_code, workspace_key"));
  if (!mapRes.provisioned) return empty; // store not provisioned → fail-open
  const gated = new Map<string, Set<string>>();
  for (const m of mapRes.data as any[]) { const s = gated.get(m.workspace_key) ?? new Set<string>(); s.add(m.product_code); gated.set(m.workspace_key, s); }

  // No tenant context → cannot evaluate licences → fail-open (available), never silently deny.
  if (!tenantId) return { provisioned: true, gated: new Map(), licensedProducts: new Set() };

  const today = new Date().toISOString().slice(0, 10);
  const licRes = await q(admin.from("tenant_product_licenses").select("product_code, status, valid_from, valid_to").eq("tenant_id", tenantId).eq("status", "active"));
  const licensedProducts = new Set<string>();
  for (const l of licRes.data as any[]) {
    if ((!l.valid_from || l.valid_from <= today) && (!l.valid_to || l.valid_to >= today)) licensedProducts.add(l.product_code);
  }
  return { provisioned: true, gated, licensedProducts };
}

// A workspace is licensed if it isn't product-gated (unmapped = freely available) OR at least one of its gating
// products is actively licensed for the tenant. 'personal' is never gated. Never denies on missing data.
export function isWorkspaceLicensed(lic: TenantLicensing, workspaceKey: string): boolean {
  if (!lic.provisioned || workspaceKey === "personal") return true;
  const products = lic.gated.get(workspaceKey);
  if (!products || products.size === 0) return true;             // unmapped → free
  for (const p of products) if (lic.licensedProducts.has(p)) return true;
  return false;                                                  // mapped but no active licence → gated out
}
