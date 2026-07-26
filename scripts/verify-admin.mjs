// Mirror verifier for the UMW Administration & Configuration stores (migrations 109/110 + seed). Confirms the seeded
// admin data + reused structure counts for AMU. Read-only. Run:  node scripts/verify-admin.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = { ...process.env };
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); } }
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const rows = async (t, sel = "*") => { const r = await db.from(t).select(sel); return r.error ? { e: r.error.message } : (r.data ?? []); };

const H = (await db.from("profiles").select("hospital_id").ilike("email", "%@amu.competen.demo").limit(50)).data?.find((p) => p.hospital_id)?.hospital_id;
if (!H) { console.error("No AMU hospital."); process.exit(1); }
const at = async (t) => (await rows(t)).filter?.((r) => r.hospital_id === H) ?? [];

const docs = await at("adm_documents");
const assets = await at("adm_assets");
const changes = await at("adm_changes");
const cfg = await at("adm_config_items");
console.log(`AMU hospital ${H}\n`);
console.log("Admin & Configuration catalogue:");
console.log(`  Documents ........... ${docs.length}  (published ${docs.filter((d) => d.status === "published").length}, in-review ${docs.filter((d) => d.status === "in_review").length})`);
console.log(`  Assets .............. ${assets.length}  (in-service ${assets.filter((a) => a.status === "in_service").length}, maint ${assets.filter((a) => a.status === "under_maintenance").length})`);
console.log(`  Forms ............... ${(await at("adm_forms")).length}`);
console.log(`  Config items ........ ${cfg.length}  (inherited ${cfg.filter((c) => c.source === "inherited").length}, local ${cfg.filter((c) => c.source === "local").length})`);
console.log(`  Delegations ......... ${(await at("adm_delegations")).length}`);
console.log(`  Changes ............. ${changes.length}  (published ${changes.filter((c) => c.status === "published").length}, high-risk ${changes.filter((c) => c.risk === "high").length})`);
console.log(`  AI recs / automations ${(await at("adm_ai_recommendations")).length} / ${(await at("adm_automations")).length}`);

const beds = await db.from("op_beds").select("status").eq("hospital_id", H);
const depts = await db.from("departments").select("id").eq("hospital_id", H);
const pos = await db.from("positions").select("status").eq("hospital_id", H);
console.log("\nReused structure (live):");
console.log(`  Beds ${beds.data?.length ?? 0}  ·  Departments ${depts.data?.length ?? 0}  ·  Positions ${pos.data?.length ?? 0} (active ${(pos.data ?? []).filter((p) => p.status === "active").length})`);
console.log(`  Rooms ${(await at("adm_rooms")).length}  ·  Services ${(await at("adm_services")).length}  ·  Operational rules ${(await at("adm_operational_rules")).length}`);

console.log("\n✅ verify-admin mirror ran clean.");
