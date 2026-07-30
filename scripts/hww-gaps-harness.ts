// One-off harness for the migration-158 gap batch + AE-001 S7 auto-rebalance
// (which only became testable once 155 landed). Exercises the SHIPPED libs on
// REAL rows, cleaning up everything it creates:
//   1. Devices: line-days computation, dwell-review flags (7d central line /
//      3d peripheral IV), active-vs-removed split, timeline entries
//   2. Concern routing history: a routing row is retained per decision, and
//      re-routing appends rather than overwrites
//   3. Post-event observation types accepted by the store
//   4. maybeAutoRebalance: fires once, then THROTTLES within the window
//   npx --yes tsx scripts/hww-gaps-harness.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
loadEnvConfig(process.cwd());

let pass = 0, fail = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (ok) pass++; else fail++;
};
const daysAgo = (n: number) => new Date(Date.now() - n * 86400e3).toISOString();

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error("Missing Supabase env."); process.exit(1); }
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { loadPatientOne } = await import("../src/lib/hww/patients");
  const { maybeAutoRebalance, REBALANCE_THROTTLE_MIN } = await import("../src/lib/hww/assignment-engine");

  // A real assigned patient so loadPatientOne's access path is exercised.
  const { data: asg } = await admin.from("op_patient_assignments")
    .select("staff_id, op_patients!patient_id(id, label, hospital_id)")
    .eq("status", "active").limit(1).maybeSingle();
  const patient = (asg as any)?.op_patients;
  const nurseId = (asg as any)?.staff_id;
  if (!patient) { console.log("No active assignment — cannot exercise the gap batch."); process.exit(0); }

  const madeDevices: string[] = [];
  const madeConcerns: string[] = [];
  const madeObs: string[] = [];
  const madeRuns: string[] = [];

  try {
    // ── 1. Devices ──
    console.log("── Devices & lines ──");
    const mk = async (type: string, insertedAt: string, removedAt: string | null = null) => {
      const { data, error } = await admin.from("op_patient_devices").insert({
        hospital_id: patient.hospital_id, patient_id: patient.id, device_type: type,
        site: "harness test", inserted_at: insertedAt, removed_at: removedAt,
        inserted_by: nurseId, inserted_by_name: "harness (test run)", notes: "harness test - safe to delete",
      }).select("id").single();
      if (error) throw new Error(`${type}: ${error.message}`);
      madeDevices.push(data.id);
      return data.id;
    };
    const cvcId = await mk("central_line", daysAgo(9));           // 9d -> review due (7d)
    await mk("peripheral_iv", daysAgo(1));                        // 1d -> no review (3d)
    await mk("urinary_catheter", daysAgo(10), daysAgo(2));        // removed after 8d

    const one = await loadPatientOne(admin, nurseId, patient.id);
    if (!one.found) throw new Error("patient not found by loader");
    const active = one.devices.active;
    const removed = one.devices.removed;
    check(active.length === 2 && removed.length === 1, "active vs removed split", `${active.length} active / ${removed.length} removed`);
    const cvc = active.find((d: any) => d.id === cvcId);
    check(cvc?.lineDays === 9, "line-days computed from insertion", `${cvc?.lineDays}d`);
    check(cvc?.reviewDue === true, "central line at 9d flags dwell review (7d threshold)");
    check(active.find((d: any) => d.device_type === "peripheral_iv")?.reviewDue === false, "peripheral IV at 1d does not flag (3d threshold)");
    check(removed[0]?.lineDays === 8, "removed device keeps its dwell duration", `${removed[0]?.lineDays}d`);
    check(one.timeline.some((t: any) => /Device recorded/.test(t.text)) && one.timeline.some((t: any) => /Device removed/.test(t.text)), "device events appear on the operational timeline");

    // ── 2. Concern routing history ──
    console.log("\n── Concern routing history ──");
    const { data: concern, error: ce } = await admin.from("op_concerns").insert({
      hospital_id: patient.hospital_id, patient_id: patient.id, category: "doctor_review", priority: "today",
      description: "harness test concern - safe to delete", raised_by: nurseId, raised_by_name: "harness (test run)", status: "open",
    }).select("id").single();
    if (ce) throw new Error(ce.message);
    madeConcerns.push(concern.id);

    for (const dest of ["medical_team", "specialty"]) {
      const { error } = await admin.from("op_concern_routings").insert({
        hospital_id: patient.hospital_id, concern_id: concern.id, routed_to: dest,
        routed_by: nurseId, routed_by_name: "harness (test run)",
      });
      if (error) throw new Error(error.message);
    }
    const { data: hist } = await admin.from("op_concern_routings").select("routed_to, routed_at").eq("concern_id", concern.id).order("routed_at", { ascending: true });
    check((hist ?? []).length === 2, "each routing decision is retained (history appends)", `${(hist ?? []).length} rows`);
    check((hist ?? [])[0]?.routed_to === "medical_team" && (hist ?? [])[1]?.routed_to === "specialty", "re-route appends rather than overwriting");
    const { error: badDest } = await admin.from("op_concern_routings").insert({ hospital_id: patient.hospital_id, concern_id: concern.id, routed_to: "the_moon" });
    check(!!badDest, "invented routing destination rejected by the constraint");

    // ── 3. Post-event observation types ──
    console.log("\n── Post-event observation types ──");
    for (const t of ["post_procedure", "post_medication"]) {
      const { data, error } = await admin.from("op_observations").insert({
        hospital_id: patient.hospital_id, patient_id: patient.id, observation_type: t,
        status: "recorded", recorded_at: new Date().toISOString(), observer_id: nurseId, findings: { note: "harness test" },
      }).select("id").single();
      check(!error, `${t} accepted by the store`, error?.message);
      if (data) madeObs.push(data.id);
    }
    const { error: badType } = await admin.from("op_observations").insert({
      hospital_id: patient.hospital_id, patient_id: patient.id, observation_type: "vibes", status: "recorded",
    });
    check(!!badType, "invented observation type still rejected");

    // ── 4. Auto-rebalance throttle ──
    console.log("\n── AE-001 S7 auto-rebalance ──");
    const before = await admin.from("op_assignment_recommendations").select("id");
    const beforeIds = new Set(((before.data ?? []) as any[]).map(r => r.id));
    const first = await maybeAutoRebalance(admin, patient.hospital_id, "harness trigger");
    const after = await admin.from("op_assignment_recommendations").select("id, created_at");
    const fresh = ((after.data ?? []) as any[]).filter(r => !beforeIds.has(r.id));
    fresh.forEach(r => madeRuns.push(r.id));
    if (first.triggered) {
      check(fresh.length === 1, "trigger generates exactly one run", `${fresh.length}`);
      const second = await maybeAutoRebalance(admin, patient.hospital_id, "harness trigger 2");
      check(second.triggered === false && /throttled/.test(second.reason), `second trigger within ${REBALANCE_THROTTLE_MIN} min is throttled`, second.reason);
      const after2 = await admin.from("op_assignment_recommendations").select("id");
      check(((after2.data ?? []) as any[]).filter(r => !beforeIds.has(r.id)).length === 1, "throttled trigger creates no extra run");
    } else {
      check(fresh.length === 0, "no run created when the trigger cannot fire", first.reason);
      console.log(`  (not triggered: ${first.reason} — expected when no active staffed shift with patients exists)`);
    }
  } finally {
    if (madeRuns.length) await admin.from("op_assignment_recommendations").delete().in("id", madeRuns);
    if (madeObs.length) await admin.from("op_observations").delete().in("id", madeObs);
    if (madeConcerns.length) await admin.from("op_concerns").delete().in("id", madeConcerns);
    if (madeDevices.length) await admin.from("op_patient_devices").delete().in("id", madeDevices);
    console.log("\n(harness devices, concern + routings, observations and runs deleted)");
  }

  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} pass / ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
