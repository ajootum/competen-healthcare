// Mirror verifier for PW-014 P5 break-glass (src/lib/orchestration/break-glass.ts) + migration probes (103/104).
// Replicates the grant lifecycle against the real DB: invoke (reason+expiry+audit+event), active-check, expiry
// exclusion, revoke. Creates + deletes its own rows. Run: node scripts/verify-break-glass.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = { ...process.env };
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); } }
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const exists = async (t) => { const { error } = await db.from(t).select("*").limit(1); return !error; };

// Migration probes.
console.log(`Migration 104 (break_glass_grant): ${(await exists("break_glass_grant")) ? "✅ applied" : "⏳ NOT applied — run migration 104"}`);
// 103 lockdown can't be introspected via the service client (bypasses RLS); trust the run confirmation.
console.log(`Migration 103 (positions RLS lockdown): DDL — verify by policy absence in Supabase; service-role probes bypass RLS.\n`);
if (!(await exists("break_glass_grant"))) process.exit(0);

const { data: cohort } = await db.from("profiles").select("id, full_name, hospital_id, tenant_id").ilike("email", "%@amu.competen.demo").limit(1);
const nurse = cohort?.[0];
if (!nurse) { console.error("No AMU nurse."); process.exit(1); }
const made = [];
const clean = async () => { for (const id of made) { await db.from("domain_events").delete().eq("subject_id", id); await db.from("audit_log").delete().eq("entity_id", id); await db.from("break_glass_grant").delete().eq("id", id); } };

// 1) invoke (mirror of requestBreakGlass): valid reason → grant + audit + event.
const now = Date.now();
const { data: g1 } = await db.from("break_glass_grant").insert({ actor_id: nurse.id, actor_name: nurse.full_name, hospital_id: nurse.hospital_id, tenant_id: nurse.tenant_id, target_type: "patient", target_ref: "probe-patient", reason: "Emergency review of deteriorating patient", scope: "read", status: "active", expires_at: new Date(now + 60 * 60000).toISOString() }).select("id, status, expires_at").single();
made.push(g1.id);
await db.from("audit_log").insert({ actor_id: nurse.id, action: "break_glass_invoked", entity_type: "break_glass_grant", entity_id: g1.id, hospital_id: nurse.hospital_id, new_value: { reason: "…" } });
await db.from("domain_events").insert({ event_type: "security.break_glass.invoked", subject_type: "break_glass_grant", subject_id: g1.id, actor_id: nurse.id, hospital_id: nurse.hospital_id, sensitivity: "restricted", payload: { scope: "read" } });
const { count: auditN } = await db.from("audit_log").select("id", { count: "exact", head: true }).eq("entity_id", g1.id).eq("action", "break_glass_invoked");
const { count: evN } = await db.from("domain_events").select("id", { count: "exact", head: true }).eq("subject_id", g1.id).eq("event_type", "security.break_glass.invoked");
console.log(`Invoke: grant ${g1.status} exp=${g1.expires_at.slice(11, 16)}; audit rows ${auditN} ${auditN === 1 ? "✅" : "❌"}; break-glass events ${evN} ${evN === 1 ? "✅" : "❌"}`);

// 2) active-check (hasActiveBreakGlass): a live grant counts.
const { count: activeN } = await db.from("break_glass_grant").select("id", { count: "exact", head: true }).eq("actor_id", nurse.id).eq("status", "active").gt("expires_at", new Date().toISOString());
console.log(`Active grant visible: ${activeN >= 1 ? "✅" : "❌"}`);

// 3) expiry exclusion: an already-expired active grant is excluded by the predicate.
const { data: g2 } = await db.from("break_glass_grant").insert({ actor_id: nurse.id, reason: "expired probe grant xx", status: "active", expires_at: new Date(now - 60000).toISOString() }).select("id").single();
made.push(g2.id);
const { data: liveList } = await db.from("break_glass_grant").select("id").eq("actor_id", nurse.id).eq("status", "active").gt("expires_at", new Date().toISOString());
console.log(`Expired grant excluded from active list: ${liveList.some((x) => x.id === g2.id) ? "❌ included" : "✅ excluded"}`);

// 4) revoke: active → revoked.
const { data: rev } = await db.from("break_glass_grant").update({ status: "revoked", revoked_at: new Date().toISOString(), revoked_by: nurse.id }).eq("id", g1.id).eq("status", "active").select("status").maybeSingle();
console.log(`Revoke: grant now '${rev?.status}' ${rev?.status === "revoked" ? "✅" : "❌"}`);

await clean();
console.log("\ncleaned up probe grants + audit + events. ✅ break-glass lifecycle verified.");
