// One-off harness for the Competency Evidence Generator (HWW-TSK-001 bridge).
// Exercises the SHIPPED lib (@/lib/hww/evidence) against real rows: a completed
// procedural op_task and an administered op_med event must each produce exactly
// ONE pending skill_log_entries row for the performing nurse (idempotent on
// re-run), and non-procedural work must NOT bridge. Cleanup removes everything.
//   npx --yes tsx scripts/hww-evidence-harness.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
loadEnvConfig(process.cwd());

let pass = 0, fail = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (ok) pass++; else fail++;
};

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error("Missing Supabase env."); process.exit(1); }
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { evidenceFromTask, evidenceFromMedication } = await import("../src/lib/hww/evidence");

  const { data: asg } = await admin.from("op_patient_assignments")
    .select("staff_id, op_patients!patient_id(id, label, hospital_id, unit_id)").eq("status", "active").limit(1).maybeSingle();
  const patient = (asg as any)?.op_patients;
  const nurseId = (asg as any)?.staff_id;
  if (!patient || !nurseId) { console.log("No active assignment — cannot exercise the bridge."); process.exit(0); }
  const { data: witness } = await admin.from("profiles").select("id, full_name").neq("id", nurseId).limit(1).maybeSingle();

  const cleanupIds: { entries: string[]; tasks: string[]; scheds: string[] } = { entries: [], tasks: [], scheds: [] };

  // ── 1. Guards ──
  console.log("── Guards ──");
  let r = await evidenceFromTask(admin, { id: "00000000-0000-0000-0000-000000000001", assigned_to: nurseId, patient_id: patient.id, task_type: "routine", description: "Restock supplies" });
  check(r.created === false && /not a procedural/.test(r.reason ?? ""), "non-procedural task type does not bridge", r.reason);
  r = await evidenceFromTask(admin, { id: "00000000-0000-0000-0000-000000000002", assigned_to: nurseId, patient_id: null, task_type: "procedure", description: "x" });
  check(r.created === false, "patient-less task does not bridge", r.reason);
  r = await evidenceFromMedication(admin, { id: "00000000-0000-0000-0000-000000000003", outcome: "delayed", administered_by: nurseId }, { drug_name: "X", route: "oral" });
  check(r.created === false, "delayed medication does not bridge", r.reason);

  // ── 2. Task bridge (real rows) ──
  console.log("\n── Task bridge ──");
  const { data: task, error: te } = await admin.from("op_tasks").insert({
    hospital_id: patient.hospital_id, patient_id: patient.id, unit_id: patient.unit_id ?? null,
    task_type: "procedure", description: "Urinary catheter care (harness test — safe to delete)",
    assigned_to: nurseId, priority: "normal", status: "completed",
    completed_at: new Date().toISOString(), completed_by: nurseId,
  }).select().single();
  if (te) { console.error("Task seed failed:", te.message); process.exit(1); }
  cleanupIds.tasks.push(task.id);

  r = await evidenceFromTask(admin, task);
  check(r.created === true, "completed procedural task bridges", r.reason);
  if (r.id) cleanupIds.entries.push(r.id);
  if (r.created && r.id) {
    const { data: entry } = await admin.from("skill_log_entries").select("*").eq("id", r.id).single();
    check(entry?.nurse_id === nurseId, "entry belongs to the performing nurse");
    check(entry?.status === "pending", "entry is PENDING (never self-verified)");
    check(entry?.supervision_level === "independent", "task evidence records independent practice");
    check((entry?.notes ?? "").includes(`[auto:op_task:${task.id}]`), "source marker present");
  }
  const r2 = await evidenceFromTask(admin, task);
  check(r2.created === false && /already bridged/.test(r2.reason ?? ""), "re-completion is idempotent (no duplicate)");

  // ── 3. Medication bridge (real rows) ──
  console.log("\n── Medication bridge ──");
  const { data: sched, error: se } = await admin.from("op_med_schedule").insert({
    hospital_id: patient.hospital_id, patient_id: patient.id, unit_id: patient.unit_id ?? null,
    drug_name: "Harness Test Med (safe to delete)", route: "iv", scheduled_at: new Date().toISOString(),
    high_risk: true, requires_double_check: true, status: "administered", source: "manual",
  }).select().single();
  if (se) { console.error("Schedule seed failed:", se.message); process.exit(1); }
  cleanupIds.scheds.push(sched.id);
  const { data: event, error: ee } = await admin.from("op_med_administrations").insert({
    hospital_id: patient.hospital_id, schedule_id: sched.id, patient_id: patient.id,
    outcome: "administered", administered_by: nurseId, administered_by_name: "harness",
    delay_minutes: 0, witness_id: witness?.id ?? null, witness_name: witness?.full_name ?? null, safety_checks: { right_patient: true },
  }).select().single();
  if (ee) { console.error("Event seed failed:", ee.message); process.exit(1); }

  r = await evidenceFromMedication(admin, event, sched);
  check(r.created === true, "administered medication bridges", r.reason);
  if (r.id) cleanupIds.entries.push(r.id);
  if (r.created && r.id) {
    const { data: entry } = await admin.from("skill_log_entries").select("*").eq("id", r.id).single();
    check(entry?.supervision_level === (witness ? "supervised" : "independent"), "witnessed double-check records as supervised", entry?.supervision_level);
    check((entry?.skill_name ?? "").includes("Harness Test Med"), "skill name carries the drug + route", entry?.skill_name);
    check((entry?.notes ?? "").includes("HIGH-RISK"), "high-risk flag carried into evidence notes");
  }
  const r3 = await evidenceFromMedication(admin, event, sched);
  check(r3.created === false && /already bridged/.test(r3.reason ?? ""), "re-record is idempotent");

  // ── Cleanup ──
  if (cleanupIds.entries.length) await admin.from("skill_log_entries").delete().in("id", cleanupIds.entries);
  if (cleanupIds.tasks.length) await admin.from("op_tasks").delete().in("id", cleanupIds.tasks);
  if (cleanupIds.scheds.length) await admin.from("op_med_schedule").delete().in("id", cleanupIds.scheds);
  console.log("\n(harness tasks, schedules, events and evidence entries deleted)");

  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} pass / ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
