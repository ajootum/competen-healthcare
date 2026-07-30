// One-off harness for the Medication Coordination engine (migration 154).
// Exercises the SHIPPED lib (@/lib/hww/medications):
//   1. validateScheduleEntry + effectiveStatus windows + computeTimeliness (pure)
//   2. Post-migration lifecycle on a real patient: schedule -> double-check
//      witness enforcement -> administer -> delayed (with auto op_escalation on
//      a high-risk breach) -> omitted closes as cancelled. Cleanup removes
//      harness rows INCLUDING the escalation it raised.
//   npx --yes tsx scripts/hww-medications-harness.ts
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
  const { validateScheduleEntry, effectiveStatus, computeTimeliness, recordAdministration } = await import("../src/lib/hww/medications");

  // ── 1. Pure engine ──
  console.log("── validateScheduleEntry ──");
  check(validateScheduleEntry({}).length === 4, "empty body → 4 errors");
  check(validateScheduleEntry({ patient_id: "x", drug_name: "Amoxicillin", route: "oral", scheduled_at: new Date().toISOString() }).length === 0, "valid entry → clean");
  check(validateScheduleEntry({ patient_id: "x", drug_name: "A", route: "warp", scheduled_at: new Date().toISOString() }).length === 1, "invented route rejected");
  check(validateScheduleEntry({ patient_id: "x", drug_name: "A", route: "iv", scheduled_at: "not-a-time" }).length === 1, "bad time rejected");

  console.log("\n── effectiveStatus windows ──");
  const now = Date.now();
  const at = (minFromNow: number) => new Date(now + minFromNow * 60e3).toISOString();
  check(effectiveStatus({ status: "scheduled", scheduled_at: at(120) }, now) === "scheduled", "2h ahead → scheduled");
  check(effectiveStatus({ status: "scheduled", scheduled_at: at(30) }, now) === "due", "30 min ahead → due (60-min window)");
  check(effectiveStatus({ status: "scheduled", scheduled_at: at(-10) }, now) === "due", "10 min past → still due (30-min grace)");
  check(effectiveStatus({ status: "scheduled", scheduled_at: at(-45) }, now) === "overdue", "45 min past → overdue");
  check(effectiveStatus({ status: "administered", scheduled_at: at(-300) }, now) === "administered", "terminal status never re-derived");
  check(effectiveStatus({ status: "delayed", scheduled_at: at(-300) }, now) === "delayed", "delayed sticks until acted on");

  console.log("\n── computeTimeliness ──");
  const t = computeTimeliness([
    { outcome: "administered", delay_minutes: 5 }, { outcome: "administered", delay_minutes: 10 },
    { outcome: "administered", delay_minutes: 40 }, { outcome: "delayed", delay_minutes: 70 }, { outcome: "omitted", delay_minutes: 0 },
  ]);
  check(t.administered === 3 && t.delayed === 1 && t.omitted === 1, "outcome counts");
  check(t.onTimePct === 67, "on-time % (2/3 within 15 min → 67)", `${t.onTimePct}`);
  check(t.medianDelay === 10, "median delay 10", `${t.medianDelay}`);

  // ── 2. Store-backed lifecycle ──
  const probe = await admin.from("op_med_schedule").select("id").limit(1);
  if (probe.error) {
    console.log("\n── Pre-migration (154 not applied): engines verified; lifecycle deferred ──");
    console.log("(Apply migration 154, then re-run for the full lifecycle pass.)");
  } else {
    console.log("\n── Post-migration: lifecycle on a real patient ──");
    const { data: asg } = await admin.from("op_patient_assignments")
      .select("staff_id, op_patients!patient_id(id, label, hospital_id)").eq("status", "active").limit(1).maybeSingle();
    const patient = (asg as any)?.op_patients;
    const nurseId = (asg as any)?.staff_id;
    const { data: other } = await admin.from("profiles").select("id, full_name").neq("id", nurseId ?? "").limit(1).maybeSingle();
    if (!patient || !other) { console.log("No assignment/second profile — cannot exercise lifecycle."); process.exit(fail ? 1 : 0); }

    const mkSched = async (extra: any = {}) => {
      const { data, error } = await admin.from("op_med_schedule").insert({
        hospital_id: patient.hospital_id, patient_id: patient.id,
        drug_name: "Harness Test Med (safe to delete)", dose_display: "1 unit", route: "oral",
        scheduled_at: new Date(now - 90 * 60e3).toISOString(), status: "scheduled", source: "manual", ...extra,
      }).select().single();
      if (error) throw new Error(error.message);
      return data;
    };

    // a) Double-check enforcement.
    const s1 = await mkSched({ requires_double_check: true });
    let r = await recordAdministration(admin, { scheduleId: s1.id, outcome: "administered", actorId: nurseId, actorName: "harness" }, now);
    check(!r.ok && r.status === 400, "administer without witness rejected (double-check configured)");
    r = await recordAdministration(admin, { scheduleId: s1.id, outcome: "administered", witnessId: nurseId, actorId: nurseId, actorName: "harness" }, now);
    check(!r.ok && r.status === 400, "self-witness rejected");
    r = await recordAdministration(admin, { scheduleId: s1.id, outcome: "administered", witnessId: other.id, actorId: nurseId, actorName: "harness", safetyChecks: { right_patient: true } }, now);
    check(r.ok === true, "administer with second-clinician witness accepted");
    if (r.ok) {
      check(r.schedule.status === "administered", "schedule → administered");
      check(r.delayMinutes === 90, "delay minutes computed vs scheduled time", `${r.delayMinutes}`);
      check(r.event.witness_name === (other.full_name ?? null), "witness name captured");
    }
    const dup = await recordAdministration(admin, { scheduleId: s1.id, outcome: "administered", actorId: nurseId }, now);
    check(!dup.ok && dup.status === 400, "terminal dose cannot be re-recorded");

    // b) Delayed WITHOUT reason rejected; high-risk delay > 60 min auto-escalates.
    const s2 = await mkSched({ high_risk: true });
    r = await recordAdministration(admin, { scheduleId: s2.id, outcome: "delayed", actorId: nurseId }, now);
    check(!r.ok && r.status === 400, "delayed without reason rejected");
    r = await recordAdministration(admin, { scheduleId: s2.id, outcome: "delayed", reason: "patient off ward (harness)", actorId: nurseId, actorName: "harness" }, now);
    check(r.ok === true && r.escalated === true && !!r.escalationId, "high-risk 90-min delay auto-escalated");
    let escId: string | null = null;
    if (r.ok) {
      escId = r.escalationId;
      check(r.schedule.status === "escalated", "schedule → escalated");
      const { data: esc } = await admin.from("op_escalations").select("escalation_type, level, hospital_id").eq("id", r.escalationId!).maybeSingle();
      check(esc?.escalation_type === "medication_delay" && esc?.level === 3, "real op_escalation raised (type medication_delay, L3)");
      check(esc?.hospital_id === patient.hospital_id, "escalation tenant = patient's hospital");
    }

    // c) Short delay on a normal med does NOT escalate; omission closes as cancelled.
    const s3 = await mkSched({ scheduled_at: new Date(now - 30 * 60e3).toISOString() });
    r = await recordAdministration(admin, { scheduleId: s3.id, outcome: "delayed", reason: "awaiting review (harness)", actorId: nurseId }, now);
    check(r.ok === true && r.escalated === false, "30-min normal delay does not escalate");
    if (r.ok) check(r.schedule.status === "delayed", "schedule → delayed (still open)");
    r = await recordAdministration(admin, { scheduleId: s3.id, outcome: "omitted", reason: "order stopped (harness)", actorId: nurseId }, now);
    check(r.ok === true, "delayed dose can still be closed by omission");
    if (r.ok) check(r.schedule.status === "cancelled", "omission closes schedule as cancelled");

    // Cleanup: events cascade with schedules; the escalation is separate.
    await admin.from("op_med_schedule").delete().in("id", [s1.id, s2.id, s3.id]);
    if (escId) await admin.from("op_escalations").delete().eq("id", escId);
    console.log("(harness schedules, events and escalation deleted)");
  }

  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} pass / ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
