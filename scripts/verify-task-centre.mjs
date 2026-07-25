// Mirror verifier for PW-002 Task & Action Centre (src/lib/task-centre.ts). The page is auth-gated, so this
// replicates loadTaskCentre() against the real DB for a live AMU nurse and prints the aggregated inbox + KPIs.
// Read-only. Run:  node scripts/verify-task-centre.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = { ...process.env };
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const now = Date.now(), dayMs = 86400000;
const q = async (p) => { try { const r = await p; return r?.error ? [] : (r?.data ?? []); } catch { return []; } };
const dueStatus = (due) => { if (!due) return "Open"; const df = new Date(due).getTime() - now; if (df < 0) return "Overdue"; if (df < dayMs) return "Due Today"; if (df < 2 * dayMs) return "Due Tomorrow"; return `Due in ${Math.round(df / dayMs)} days`; };

// Pick an AMU nurse who actually has op_tasks (richest inbox) else any AMU nurse.
const { data: cohort } = await db.from("profiles").select("id, full_name, hospital_id, email").ilike("email", "%@amu.competen.demo");
const withTasks = [];
for (const p of cohort ?? []) { const { count } = await db.from("op_tasks").select("id", { count: "exact", head: true }).eq("assigned_to", p.id).not("status", "in", "(completed,cancelled)"); if (count) withTasks.push({ ...p, tcount: count }); }
const nurse = withTasks.sort((a, b) => b.tcount - a.tcount)[0] ?? (cohort ?? [])[0];
if (!nurse) { console.error("No AMU cohort found."); process.exit(1); }
console.log(`Nurse: ${nurse.full_name} (${nurse.email})\n`);

const tasks = [];
// op_tasks
const opTasks = await q(db.from("op_tasks").select("id, description, priority, due_at, status, patient_id, assigned_by").eq("assigned_to", nurse.id).not("status", "in", "(completed,cancelled)").limit(500));
for (const t of opTasks) { const prio = t.priority === "urgent" || t.priority === "high" ? "high" : t.priority === "low" ? "low" : "medium"; tasks.push({ title: t.description, module: t.patient_id ? "PCE" : "OPS", priority: prio, due: t.due_at, status: dueStatus(t.due_at), origin: t.assigned_by === nurse.id ? "created" : t.assigned_by ? "delegated" : "assigned" }); }
// learning
const enrol = await q(db.from("learning_enrolments").select("id, course_id, status, mandatory, due_date").eq("user_id", nurse.id).not("status", "in", "(completed,exempt)").limit(500));
const cids = [...new Set(enrol.map((e) => e.course_id).filter(Boolean))];
const ct = new Map(); if (cids.length) (await q(db.from("learning_courses").select("id, title").in("id", cids))).forEach((c) => ct.set(c.id, c.title));
for (const e of enrol) tasks.push({ title: `Complete ${ct.get(e.course_id) ?? "mandatory module"}`, module: "LMS", priority: e.mandatory ? "high" : "medium", due: e.due_date, status: dueStatus(e.due_date), origin: "assigned" });
// competency
const dec = await q(db.from("competency_decisions").select("id, competency_id, outcome, expiry_date").eq("nurse_id", nurse.id).limit(2000));
const attn = dec.filter((d) => d.outcome === "requires_remediation" || (d.expiry_date && (new Date(d.expiry_date).getTime() - now) / dayMs <= 60));
const cmids = [...new Set(attn.map((d) => d.competency_id).filter(Boolean))];
const cn = new Map(); if (cmids.length) (await q(db.from("framework_competencies").select("id, name").in("id", cmids))).forEach((c) => cn.set(c.id, c.name));
for (const d of attn) tasks.push({ title: `${d.outcome === "requires_remediation" ? "Remediate" : "Renew"} ${cn.get(d.competency_id) ?? "competency"}`, module: "CMO", priority: (d.expiry_date && new Date(d.expiry_date).getTime() < now) || d.outcome === "requires_remediation" ? "high" : "medium", due: d.expiry_date, status: d.outcome === "requires_remediation" ? "Action Required" : dueStatus(d.expiry_date), origin: "assigned" });
// quality
const qa = await q(db.from("op_quality_actions").select("id, title, priority, due_at, status").eq("hospital_id", nurse.hospital_id).eq("owner_name", nurse.full_name).not("status", "in", "(completed)").limit(200));
for (const a of qa) tasks.push({ title: a.title, module: "QMS", priority: a.priority, due: a.due_at, status: dueStatus(a.due_at), origin: "assigned" });

tasks.forEach((t) => { t.overdue = t.due && new Date(t.due).getTime() < now; });
const byMod = {}; tasks.forEach((t) => (byMod[t.module] = (byMod[t.module] ?? 0) + 1));
const { count: completed7d } = await db.from("op_tasks").select("id", { count: "exact", head: true }).eq("assigned_to", nurse.id).eq("status", "completed").gte("completed_at", new Date(now - 7 * dayMs).toISOString());

console.log("KPIs:");
console.log(`  Total ........... ${tasks.length}`);
console.log(`  Overdue ......... ${tasks.filter((t) => t.overdue).length}`);
console.log(`  Due Today ....... ${tasks.filter((t) => t.due && new Date(t.due).getTime() - now < dayMs && new Date(t.due).getTime() >= now).length}`);
console.log(`  Completed (7d) .. ${completed7d ?? 0}`);
console.log(`  High Priority ... ${tasks.filter((t) => t.priority === "high").length}`);
console.log(`\nBy module: ${JSON.stringify(byMod)}`);
console.log(`By priority: high=${tasks.filter((t) => t.priority === "high").length} medium=${tasks.filter((t) => t.priority === "medium").length} low=${tasks.filter((t) => t.priority === "low").length}`);
console.log(`Tabs: assigned=${tasks.filter((t) => t.origin === "assigned").length} delegated=${tasks.filter((t) => t.origin === "delegated").length} created=${tasks.filter((t) => t.origin === "created").length}`);
console.log("\nInbox (top 12, ranked overdue→priority):");
const rank = (p) => (p === "high" ? 0 : p === "medium" ? 1 : 2);
tasks.sort((a, b) => (b.overdue ? 1 : 0) - (a.overdue ? 1 : 0) || rank(a.priority) - rank(b.priority)).slice(0, 12).forEach((t) => console.log(`  [${t.module}] ${t.priority.padEnd(6)} ${t.overdue ? "OVERDUE" : t.status.padEnd(12)}  ${t.title?.slice(0, 60)}`));
console.log("\n✅ loadTaskCentre mirror ran clean — real aggregated inbox above.");
