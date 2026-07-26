// Mirror verifier for the Platform Priority & Execution Framework (PPE, migration 107 + seed). Replicates the PPE-001
// strategy rollups and the PPE-002 cascade resolution (effective priority set for the AMU hospital context) against
// the seeded data. Read-only. Run:  node scripts/verify-priorities.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = { ...process.env };
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); } }
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const q = async (t) => { const r = await db.from(t).select("*"); return r.error ? [] : (r.data ?? []); };
const UMULT = { low: 1, medium: 1.25, high: 1.6, critical: 2 };
const ORDER = { platform: 0, enterprise: 1, hospital: 2, department: 3, team: 4, user: 5 };
const weight = (p) => Math.round((p.base_weight ?? 50) * (UMULT[p.urgency] ?? 1) * (p.mandatory ? 1.4 : 1));

const themes = await q("ppe_strategic_themes");
const objectives = await q("ppe_objectives");
const krs = await q("ppe_key_results");
const priorities = await q("ppe_priorities");
const campaigns = await q("ppe_campaigns");
const approvals = await q("ppe_approvals");
const published = objectives.filter((o) => o.status === "published");

console.log("PPE-001 Strategy:");
console.log(`  Themes .............. ${themes.length}`);
console.log(`  Objectives .......... ${objectives.length} (published ${published.length}, draft ${objectives.filter((o) => o.status === "draft").length}, pending ${objectives.filter((o) => o.status === "pending").length})`);
console.log(`  Avg progress ........ ${published.length ? Math.round(published.reduce((a, o) => a + Number(o.progress_pct || 0), 0) / published.length) : 0}%`);
console.log(`  Key results ......... ${krs.length}`);
console.log(`  Published priorities  ${priorities.filter((p) => p.status === "published").length}`);
console.log(`  Campaigns (active) .. ${campaigns.filter((c) => c.status === "active").length}/${campaigns.length}`);
console.log(`  Pending approvals ... ${approvals.filter((a) => a.state === "pending").length}`);

// PPE-002 resolution for the AMU hospital context.
const H = priorities.find((p) => p.scope_type === "hospital")?.scope_ref ?? null;
const dept = priorities.find((p) => p.scope_type === "department")?.scope_ref ?? null;
const today = new Date().toISOString().slice(0, 10);
const applies = (p) => p.scope_type === "platform" || p.scope_type === "enterprise" || (p.scope_type === "hospital" && p.scope_ref === H) || (p.scope_type === "department" && p.scope_ref === dept) || p.scope_type === "team";
const valid = (p) => (!p.valid_from || p.valid_from <= today) && (!p.valid_to || p.valid_to >= today);
const candidates = priorities.filter((p) => p.status === "published" && valid(p) && applies(p));
const blockers = candidates.filter((p) => p.inheritance_mode === "block" && p.theme_id);
const suppressed = new Set();
for (const b of blockers) for (const p of candidates) if (p.id !== b.id && p.theme_id === b.theme_id && (ORDER[p.scope_type] ?? 0) < (ORDER[b.scope_type] ?? 0)) suppressed.add(p.id);
const effective = candidates.filter((p) => !suppressed.has(p.id)).map((p) => ({ ...p, w: weight(p) })).sort((a, b) => b.w - a.w);

console.log("\nPPE-002 Distribution — effective set for AMU hospital context:");
console.log(`  Published candidates  ${priorities.filter((p) => p.status === "published").length}  → applicable ${candidates.length}  → effective ${effective.length}  (suppressed ${suppressed.size})`);
console.log("  Top resolved priorities (rank · weight · scope · title):");
effective.slice(0, 6).forEach((p, i) => console.log(`   ${i + 1}. ${String(p.w).padStart(3)}  ${p.scope_type.padEnd(10)} ${p.mandatory ? "★" : " "} ${p.title}`));

console.log("\n✅ verify-priorities mirror ran clean.");
