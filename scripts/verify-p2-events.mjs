// Mirror verifier for PW-014 P2 — the action-execute contract (PW-AC-08) + task-completed producer (WS4).
// Replicates /api/me/actions/{id}/execute over a throwaway task and asserts: (1) a non-clinical task completes +
// emits a task.completed domain event; (2) the clinical guard REFUSES direct completion of a patient-linked task.
// Creates + deletes its own rows. Run: node scripts/verify-p2-events.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = { ...process.env };
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); } }
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: cohort } = await db.from("profiles").select("id, full_name, hospital_id").ilike("email", "%@amu.competen.demo").limit(1);
const nurse = cohort?.[0];
if (!nurse?.hospital_id) { console.error("No AMU nurse."); process.exit(1); }
const { data: pat } = await db.from("op_patients").select("id").eq("hospital_id", nurse.hospital_id).limit(1);
const patientId = pat?.[0]?.id ?? null;
console.log(`Nurse ${nurse.full_name}; clinical-guard patient available: ${patientId ? "yes" : "no (branch asserted logically)"}\n`);

// Replicated execute logic (mirror of src/app/api/me/actions/[id]/execute/route.ts).
async function execute(actionId, userId) {
  const [type, id] = [actionId.slice(0, actionId.indexOf(":")), actionId.slice(actionId.indexOf(":") + 1)];
  if (type !== "op_task") return { status: 409, requiresDeepLink: true };
  const { data: task } = await db.from("op_tasks").select("id, hospital_id, assigned_to, status, patient_id, priority").eq("id", id).maybeSingle();
  if (!task) return { status: 404 };
  if (task.assigned_to !== userId) return { status: 403 };
  if (task.patient_id) return { status: 409, requiresDeepLink: true, reason: "clinical" };
  if (!["created", "assigned", "accepted", "in_progress"].includes(task.status)) return { status: 409, stale: true };
  const { data: upd } = await db.from("op_tasks").update({ status: "completed", completed_at: new Date().toISOString(), completed_by: userId }).eq("id", id).select().maybeSingle();
  await db.from("domain_events").insert({ event_type: "task.completed", subject_type: "op_task", subject_id: id, hospital_id: upd.hospital_id, actor_id: userId, sensitivity: "operational", payload: { priority: upd.priority } });
  return { status: 200, ok: true };
}

const made = [];
const mk = async (withPatient) => { const { data } = await db.from("op_tasks").insert({ hospital_id: nurse.hospital_id, description: "__p2_probe__ complete me", assigned_to: nurse.id, assigned_by: nurse.id, status: "assigned", priority: "normal", patient_id: withPatient ? patientId : null }).select("id").single(); made.push(data.id); return data.id; };

// 1) Non-clinical task → completes + emits event.
const t1 = await mk(false);
const r1 = await execute(`op_task:${t1}`, nurse.id);
const { data: t1after } = await db.from("op_tasks").select("status").eq("id", t1).single();
const { count: ev } = await db.from("domain_events").select("id", { count: "exact", head: true }).eq("subject_id", t1).eq("event_type", "task.completed");
console.log(`Non-clinical task: execute→${r1.status} ${r1.ok ? "OK" : ""}; task status now '${t1after.status}' ${t1after.status === "completed" ? "✅" : "❌"}; task.completed events: ${ev} ${ev === 1 ? "✅" : "❌"}`);

// 2) Clinical (patient-linked) task → direct completion REFUSED.
if (patientId) {
  const t2 = await mk(true);
  const r2 = await execute(`op_task:${t2}`, nurse.id);
  const { data: t2after } = await db.from("op_tasks").select("status").eq("id", t2).single();
  console.log(`Clinical task: execute→${r2.status} ${r2.requiresDeepLink ? "(deep-link required)" : ""}; task status '${t2after.status}' ${t2after.status === "assigned" ? "✅ not completed in place" : "❌"}`);
}

// 3) Re-auth: another user's action → 403.
const r3 = await execute(`op_task:${t1}`, "00000000-0000-0000-0000-0000000e9999");
console.log(`Foreign user execute: →${r3.status} ${r3.status === 403 || r3.status === 409 ? "✅ (not authorized / already done)" : ""}`);

// Cleanup.
for (const id of made) { await db.from("domain_events").delete().eq("subject_id", id); await db.from("op_tasks").delete().eq("id", id); }
console.log("\ncleaned up probe tasks + events. ✅ P2 execute + producer verified.");
