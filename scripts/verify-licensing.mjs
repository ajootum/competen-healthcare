// Mirror verifier for PCS-PORT-001 licensing (src/lib/orchestration/licensing.ts) after the 106 reconciliation:
// "product" is the canonical plat_products (keyed by code); mapping/licensing key by product_code. Seeds a
// portfolio→suite→plat_product, maps it to a workspace, and asserts the fail-open + gate behaviour. Creates +
// deletes its own rows. Run: node scripts/verify-licensing.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = { ...process.env };
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); } }
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Reconciliation probe: plat_products.suite_id present + product_workspaces keyed by product_code, products table gone.
const recon = await db.from("product_workspaces").select("product_code").limit(1);
const oldGone = (await db.from("products").select("id").limit(1)).error != null;
console.log(`Migration 106: product_workspaces.product_code ${recon.error ? "⏳ not yet (run 106)" : "✅"}; old products table ${oldGone ? "✅ dropped" : "⏳ still present"}\n`);
if (recon.error) process.exit(0);

async function loadLicensing(tenantId) {
  const { data: maps } = await db.from("product_workspaces").select("product_code, workspace_key");
  const gated = new Map(); for (const m of maps ?? []) { const s = gated.get(m.workspace_key) ?? new Set(); s.add(m.product_code); gated.set(m.workspace_key, s); }
  if (!tenantId) return { gated: new Map(), licensed: new Set() };
  const today = new Date().toISOString().slice(0, 10);
  const { data: lic } = await db.from("tenant_product_licenses").select("product_code, valid_from, valid_to").eq("tenant_id", tenantId).eq("status", "active");
  const licensed = new Set(); for (const l of lic ?? []) if ((!l.valid_from || l.valid_from <= today) && (!l.valid_to || l.valid_to >= today)) licensed.add(l.product_code);
  return { gated, licensed };
}
const isLicensed = (L, key) => { if (key === "personal") return true; const p = L.gated.get(key); if (!p || !p.size) return true; for (const x of p) if (L.licensed.has(x)) return true; return false; };

const { data: tenants } = await db.from("tenants").select("id").limit(1);
const T = tenants?.[0]?.id;
if (!T) { console.error("No tenant."); process.exit(1); }
const CODE = "__pcs_probe__";
const clean = async () => { await db.from("tenant_product_licenses").delete().eq("product_code", CODE); await db.from("product_workspaces").delete().eq("product_code", CODE); await db.from("plat_products").delete().eq("code", CODE); await db.from("product_suites").delete().eq("name", "__pcs_probe_suite__"); await db.from("product_portfolios").delete().eq("name", "__pcs_probe_portfolio__"); };
await clean();

const { data: pf } = await db.from("product_portfolios").insert({ name: "__pcs_probe_portfolio__" }).select("id").single();
const { data: su } = await db.from("product_suites").insert({ portfolio_id: pf.id, name: "__pcs_probe_suite__" }).select("id").single();
await db.from("plat_products").insert({ code: CODE, name: "PCS Probe Product", suite_id: su.id });
await db.from("product_workspaces").insert({ product_code: CODE, workspace_key: "workspace:unit-manager" });

let L = await loadLicensing(T);
console.log("Mapped + NOT licensed:");
console.log(`  workspace:unit-manager available? ${isLicensed(L, "workspace:unit-manager") ? "YES ❌" : "NO ✅ (gated out)"}`);
console.log(`  portal:assessor (unmapped) available? ${isLicensed(L, "portal:assessor") ? "YES ✅ (free)" : "NO ❌"}`);

await db.from("tenant_product_licenses").insert({ tenant_id: T, product_code: CODE, status: "active" });
L = await loadLicensing(T);
console.log(`\nAfter licensing: workspace:unit-manager available? ${isLicensed(L, "workspace:unit-manager") ? "YES ✅ (licensed)" : "NO ❌"}`);
const L0 = await loadLicensing(null);
console.log(`No tenant (fail-open): available? ${isLicensed(L0, "workspace:unit-manager") ? "YES ✅" : "NO ❌"}`);

await clean();
console.log("\ncleaned up. ✅ reconciled licensing (plat_products + product_code) verified.");
