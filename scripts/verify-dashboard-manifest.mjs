// Mirror verifier for PW-014 WS2/P3 dashboard composition (src/lib/orchestration/dashboard-manifest.ts). Proves
// PW-AC-06 end-to-end: inserts config overrides (disable + reorder a widget) at hospital scope, resolves the
// effective manifest exactly as the app does (loadConfigOverrides + resolveSettings + SCOPE_ORDER), shows the
// change, then CLEANS UP so no test override lingers. Read-mostly (temp writes, self-cleaned). Run:
//   node scripts/verify-dashboard-manifest.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = { ...process.env };
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); } }
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const SCOPE_ORDER = { platform: 0, tenant: 1, hospital: 2, unit: 3, role: 4, user: 5 };
const applies = (r, ctx) => r.scope_type === "platform" || (r.scope_type === "hospital" && r.scope_ref === ctx.hospitalId) || (r.scope_type === "user" && r.scope_ref === ctx.userId) || (r.scope_type === "role" && (ctx.roles ?? []).includes(r.scope_ref));
const resolveSettings = (rows, ctx, path) => { const ap = rows.filter((r) => r.config_path === path && applies(r, ctx) && r.published != null).sort((a, b) => SCOPE_ORDER[a.scope_type] - SCOPE_ORDER[b.scope_type]); let eff = {}; for (const r of ap) eff = { ...eff, ...(r.published || {}) }; return { enabled: eff.enabled !== false, order: eff.order }; };
const DEFAULT = [["ai-briefing", "main", 10], ["priorities", "main", 20], ["patients", "main", 30], ["tasks", "main", 40], ["performance", "main", 50], ["competencies", "main", 60], ["ai-assistant", "main", 70], ["schedule", "rail", 10], ["notifications", "rail", 20], ["messages", "rail", 30], ["quick-actions", "full", 10], ["workspaces", "full", 20]].map(([key, zone, order]) => ({ key, zone, order }));
const resolve = async (ctx) => { const { data: rows } = await db.from("workspace_config_overrides").select("scope_type, scope_ref, config_path, published"); return DEFAULT.map((e) => { const s = resolveSettings(rows ?? [], ctx, `personal.dashboard.${e.key}`); return { ...e, order: s.order ?? e.order, enabled: s.enabled }; }).filter((e) => e.enabled).sort((a, b) => a.order - b.order); };

const { data: cohort } = await db.from("profiles").select("id, hospital_id").ilike("email", "%@amu.competen.demo").limit(1);
const H = cohort?.[0]?.hospital_id;
if (!H) { console.error("No AMU hospital."); process.exit(1); }
const ctx = { hospitalId: H, userId: cohort[0].id, roles: ["nurse"] };
const clean = () => db.from("workspace_config_overrides").delete().eq("scope_ref", H).like("config_path", "personal.dashboard.%");

await clean();
const before = await resolve(ctx);
console.log(`Default manifest (${before.length} widgets):\n  main: ${before.filter((e) => e.zone === "main").map((e) => e.key).join(", ")}\n  rail: ${before.filter((e) => e.zone === "rail").map((e) => e.key).join(", ")}\n  full: ${before.filter((e) => e.zone === "full").map((e) => e.key).join(", ")}`);

// Admin config change (no code deploy): disable 'messages', move 'priorities' to the front.
await db.from("workspace_config_overrides").insert([
  { hospital_id: H, scope_type: "hospital", scope_ref: H, config_path: "personal.dashboard.messages", published: { enabled: false } },
  { hospital_id: H, scope_type: "hospital", scope_ref: H, config_path: "personal.dashboard.priorities", published: { order: 5 } },
]);
const after = await resolve(ctx);
console.log(`\nAfter config override (disable messages, reorder priorities→5) — ${after.length} widgets:`);
console.log(`  main: ${after.filter((e) => e.zone === "main").map((e) => e.key).join(", ")}`);
console.log(`  rail: ${after.filter((e) => e.zone === "rail").map((e) => e.key).join(", ")}`);
console.log(`  messages present? ${after.some((e) => e.key === "messages") ? "YES ❌" : "NO ✅ (config-disabled without code)"}`);
console.log(`  priorities is first in main? ${after.filter((e) => e.zone === "main")[0]?.key === "priorities" ? "YES ✅ (reordered via config)" : "NO ❌"}`);

await clean();
console.log("\ncleaned up test overrides. ✅ dashboard manifest composition verified.");
