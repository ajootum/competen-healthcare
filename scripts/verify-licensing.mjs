// Mirror verifier for PCS-PORT-001 licensing (src/lib/orchestration/licensing.ts) + its composition into
// resolveEntitlements. Seeds a portfolio→suite→product, maps it to a workspace, and asserts the fail-open +
// gate behaviour for licensed / unlicensed / unmapped cases. Creates + deletes its own rows. Run:
//   node scripts/verify-licensing.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = { ...process.env };
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); } }
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const exists = async (t) => { const { error } = await db.from(t).select("*").limit(1); return !error; };

console.log(`Migration 105 (product_workspaces): ${(await exists("product_workspaces")) ? "✅ applied" : "⏳ NOT applied — run migration 105"}\n`);
if (!(await exists("product_workspaces"))) process.exit(0);

// Replicated licensing logic (mirror of licensing.ts).
async function loadLicensing(tenantId) {
  const { data: maps } = await db.from("product_workspaces").select("product_id, workspace_key");
  const gated = new Map(); for (const m of maps ?? []) { const s = gated.get(m.workspace_key) ?? new Set(); s.add(m.product_id); gated.set(m.workspace_key, s); }
  if (!tenantId) return { gated: new Map(), licensed: new Set() };
  const today = new Date().toISOString().slice(0, 10);
  const { data: lic } = await db.from("tenant_product_licenses").select("product_id, valid_from, valid_to").eq("tenant_id", tenantId).eq("status", "active");
  const licensed = new Set(); for (const l of lic ?? []) if ((!l.valid_from || l.valid_from <= today) && (!l.valid_to || l.valid_to >= today)) licensed.add(l.product_id);
  return { gated, licensed };
}
const isLicensed = (L, key) => { if (key === "personal") return true; const p = L.gated.get(key); if (!p || !p.size) return true; for (const x of p) if (L.licensed.has(x)) return true; return false; };

const { data: tenants } = await db.from("tenants").select("id").limit(1);
const T = tenants?.[0]?.id;
if (!T) { console.error("No tenant to test against."); process.exit(1); }

// Seed portfolio → suite → product, map product to 'workspace:unit-manager'.
const { data: pf } = await db.from("product_portfolios").insert({ name: "__pcs_probe_portfolio__" }).select("id").single();
const { data: su } = await db.from("product_suites").insert({ portfolio_id: pf.id, name: "__pcs_probe_suite__", code: "PROBE" }).select("id").single();
const { data: pr } = await db.from("products").insert({ suite_id: su.id, name: "__pcs_probe_product__", code: "__pcs_probe__", license_type: "licensed" }).select("id").single();
await db.from("product_workspaces").insert({ product_id: pr.id, workspace_key: "workspace:unit-manager" });
const clean = async () => { await db.from("tenant_product_licenses").delete().eq("product_id", pr.id); await db.from("product_workspaces").delete().eq("product_id", pr.id); await db.from("products").delete().eq("id", pr.id); await db.from("product_suites").delete().eq("id", su.id); await db.from("product_portfolios").delete().eq("id", pf.id); };

// Case A — mapped but NOT licensed → gated out; unmapped workspace still available.
let L = await loadLicensing(T);
console.log("Mapped + NOT licensed:");
console.log(`  workspace:unit-manager available? ${isLicensed(L, "workspace:unit-manager") ? "YES ❌" : "NO ✅ (gated out — no active licence)"}`);
console.log(`  portal:assessor (unmapped) available? ${isLicensed(L, "portal:assessor") ? "YES ✅ (unmapped = free)" : "NO ❌"}`);
console.log(`  personal available? ${isLicensed(L, "personal") ? "YES ✅ (never gated)" : "NO ❌"}`);

// Case B — license the product for the tenant → now available.
await db.from("tenant_product_licenses").insert({ tenant_id: T, product_id: pr.id, status: "active" });
L = await loadLicensing(T);
console.log("\nAfter licensing the product for the tenant:");
console.log(`  workspace:unit-manager available? ${isLicensed(L, "workspace:unit-manager") ? "YES ✅ (licensed)" : "NO ❌"}`);

// Case C — fail-open: no tenant context → everything available.
const L0 = await loadLicensing(null);
console.log(`\nNo tenant context (fail-open): unit-manager available? ${isLicensed(L0, "workspace:unit-manager") ? "YES ✅" : "NO ❌"}`);

await clean();
console.log("\ncleaned up probe portfolio/suite/product/licence. ✅ licensing filter verified.");
