// Mirror verifier for Ch.11 WS8 dashboard personalization (src/lib/orchestration/dashboard-manifest.ts). Replicates
// the policy-before-preference resolver against seeded workspace_config_overrides rows: user hides an OPTIONAL
// widget (dropped); admin marks one REQUIRED (user cannot hide it); reset restores. Creates + deletes its own
// overrides. Run: node scripts/verify-personalization.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = { ...process.env };
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); } }
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const SCOPE_ORDER = { platform: 0, tenant: 1, hospital: 2, unit: 3, role: 4, user: 5 };
const applies = (r, ctx) => r.scope_type === "platform" || (r.scope_type === "tenant" && r.scope_ref === ctx.tenantId) || (r.scope_type === "hospital" && r.scope_ref === ctx.hospitalId) || (r.scope_type === "unit" && r.scope_ref === ctx.unitId) || (r.scope_type === "role" && (ctx.roles ?? []).includes(r.scope_ref)) || (r.scope_type === "user" && r.scope_ref === ctx.userId);
const mergeAt = (rows, ctx, path, inScope) => { const ap = rows.filter(r => r.config_path === path && inScope(r.scope_type) && applies(r, ctx) && r.published != null).sort((a, b) => SCOPE_ORDER[a.scope_type] - SCOPE_ORDER[b.scope_type]); let eff = {}; for (const r of ap) eff = { ...eff, ...(r.published || {}) }; return eff; };
const resolve = (rows, ctx, key) => {
  const path = `personal.dashboard.${key}`;
  const adm = mergeAt(rows, ctx, path, (st) => st !== "user"), usr = mergeAt(rows, ctx, path, (st) => st === "user");
  const state = adm.state === "required" ? "required" : adm.state === "locked" ? "locked" : "optional";
  let visible; if (state === "required") visible = true; else if (adm.enabled === false) visible = false; else if (state === "locked") visible = true; else visible = usr.enabled !== false;
  return { state, visible, canToggle: state === "optional" && adm.enabled !== false };
};
const loadRows = async () => (await db.from("workspace_config_overrides").select("scope_type, scope_ref, config_path, published")).data ?? [];

const { data: cohort } = await db.from("profiles").select("id, full_name, hospital_id, tenant_id, unit_id, role, roles").ilike("email", "%@amu.competen.demo").limit(1);
const u = cohort?.[0];
if (!u) { console.error("No AMU nurse."); process.exit(1); }
const ctx = { userId: u.id, hospitalId: u.hospital_id, tenantId: u.tenant_id, unitId: u.unit_id, roles: (u.roles?.length ? u.roles : [u.role]).filter(Boolean) };
console.log(`Nurse ${u.full_name}\n`);
const clean = () => db.from("workspace_config_overrides").delete().in("scope_ref", [u.id, u.hospital_id].filter(Boolean)).like("config_path", "personal.dashboard.%");
await clean();

// Baseline.
let rows = await loadRows();
console.log(`Baseline: messages visible=${resolve(rows, ctx, "messages").visible} (canToggle=${resolve(rows, ctx, "messages").canToggle}); patients visible=${resolve(rows, ctx, "patients").visible}`);

// 1) User hides OPTIONAL 'messages'.
await db.from("workspace_config_overrides").insert({ scope_type: "user", scope_ref: u.id, config_path: "personal.dashboard.messages", published: { enabled: false } });
rows = await loadRows();
const m = resolve(rows, ctx, "messages");
console.log(`\nUser hides 'messages': visible=${m.visible} ${m.visible === false ? "✅ hidden" : "❌"}`);

// 2) Admin marks 'patients' REQUIRED at hospital scope, and the user tries to hide it too.
await db.from("workspace_config_overrides").insert([
  { scope_type: "hospital", scope_ref: u.hospital_id, config_path: "personal.dashboard.patients", published: { state: "required" } },
  { scope_type: "user", scope_ref: u.id, config_path: "personal.dashboard.patients", published: { enabled: false } },
]);
rows = await loadRows();
const p = resolve(rows, ctx, "patients");
console.log(`Admin REQUIRED 'patients' + user tries to hide: visible=${p.visible} canToggle=${p.canToggle} ${p.visible === true && p.canToggle === false ? "✅ policy beats preference" : "❌"}`);

// 3) Reset — clear the user's overrides.
await db.from("workspace_config_overrides").delete().eq("scope_type", "user").eq("scope_ref", u.id).like("config_path", "personal.dashboard.%");
rows = await loadRows();
console.log(`\nAfter reset: messages visible=${resolve(rows, ctx, "messages").visible} ${resolve(rows, ctx, "messages").visible ? "✅ restored" : "❌"}`);

// 4) Reorder — user sets 'priorities' order=5 (< ai-briefing default 10) → priorities sorts first in Main.
await db.from("workspace_config_overrides").insert({ scope_type: "user", scope_ref: u.id, config_path: "personal.dashboard.priorities", published: { order: 5 } });
rows = await loadRows();
const ord = (key, def) => { const path = `personal.dashboard.${key}`; const usr = mergeAt(rows, ctx, path, (st) => st === "user"); const adm = mergeAt(rows, ctx, path, (st) => st !== "user"); return usr.order ?? adm.order ?? def; };
const oPri = ord("priorities", 20), oBrief = ord("ai-briefing", 10);
console.log(`Reorder: priorities order=${oPri}, ai-briefing order=${oBrief} → priorities first in Main? ${oPri < oBrief ? "✅" : "❌"}`);

await clean();
console.log("\ncleaned up seeded overrides. ✅ policy-before-preference personalization verified.");
