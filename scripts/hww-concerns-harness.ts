// One-off harness for the Nurse Concerns engine (HWW-ADD-001, migration 152).
// Exercises the SHIPPED lib (@/lib/hww/concerns) — the same code the route and
// both workspace pages run:
//   1. validateConcern negative tests (pure, always run)
//   2. isOverdue window logic (pure, always run)
//   3. Pre-migration: loaders must report migrationMissing (graceful degrade)
//      Post-migration: full lifecycle — seed a labelled test concern on a real
//      patient, prove both lenses see it with correct KPIs, then clean up.
//   npx --yes tsx scripts/hww-concerns-harness.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
loadEnvConfig(process.cwd());

const HARNESS_TAG = "[harness test concern — safe to delete]";
let pass = 0, fail = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error("Missing Supabase env."); process.exit(1); }
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { validateConcern, isOverdue, loadMyConcerns, loadConcernQueue } = await import("../src/lib/hww/concerns");

  // ── 1. Creation-guard negative tests (pure) ──
  console.log("── validateConcern guard ──");
  check(validateConcern({}).length === 4, "empty body → 4 errors", validateConcern({}).join("; "));
  check(validateConcern({ patient_id: "x", category: "pain", priority: "urgent", description: "d" }).length === 0, "valid body → clean");
  check(validateConcern({ patient_id: "x", category: "gossip", priority: "urgent", description: "d" }).length === 1, "invented category rejected");
  check(validateConcern({ patient_id: "x", category: "pain", priority: "asap", description: "d" }).length === 1, "invented priority rejected");
  check(validateConcern({ patient_id: "x", category: "pain", priority: "routine", description: "   " }).length === 1, "blank description rejected");

  // ── 2. Overdue windows (pure) ──
  console.log("\n── isOverdue windows ──");
  const now = Date.now();
  const ago = (h: number) => new Date(now - h * 3.6e6).toISOString();
  check(isOverdue({ priority: "immediate", raised_at: ago(2), status: "open" }, now) === true, "immediate @2h → overdue");
  check(isOverdue({ priority: "urgent", raised_at: ago(2), status: "open" }, now) === false, "urgent @2h → not yet (4h window)");
  check(isOverdue({ priority: "routine", raised_at: ago(30), status: "open" }, now) === true, "routine @30h → overdue");
  check(isOverdue({ priority: "immediate", raised_at: ago(9), status: "resolved" }, now) === false, "resolved never overdue");
  check(isOverdue({ priority: "today", raised_at: ago(9), status: "carried_forward" }, now) === true, "carried_forward stays active for overdue");

  // ── 3. Store-backed phase ──
  // (A head:true count probe does NOT error on a missing table in this client —
  // a real select does, so probe with one.)
  const probe = await admin.from("op_concerns").select("id").limit(1);
  const migrated = !probe.error;

  if (!migrated) {
    console.log("\n── Pre-migration (152 not applied): graceful-degrade contract ──");
    const my = await loadMyConcerns(admin, "00000000-0000-0000-0000-000000000001");
    check(my.migrationMissing === true, "loadMyConcerns reports migrationMissing");
    check(Array.isArray(my.raised) && my.raised.length === 0, "loadMyConcerns returns empty lists, not throws");
    const q = await loadConcernQueue(admin, null, true);
    check(q.migrationMissing === true, "loadConcernQueue reports migrationMissing");
    check(q.kpis.active === 0, "queue KPIs zeroed");
    console.log("\n(Apply migration 152, then re-run for the full lifecycle pass.)");
  } else {
    console.log("\n── Post-migration: full lifecycle on real rows ──");
    // Idempotent re-run: remove prior harness rows first.
    await admin.from("op_concerns").delete().ilike("description", `%${HARNESS_TAG}%`);

    const { data: patient } = await admin.from("op_patients").select("id, label, hospital_id").limit(1).maybeSingle();
    const { data: someone } = await admin.from("profiles").select("id, full_name").limit(1).maybeSingle();
    if (!patient || !someone) { console.log("No op_patients/profiles rows — cannot exercise lifecycle."); process.exit(fail ? 1 : 0); }

    // Seed: one urgent ward-round concern raised by `someone` on a real patient.
    const { data: seeded, error: se } = await admin.from("op_concerns").insert({
      hospital_id: patient.hospital_id, patient_id: patient.id,
      category: "clinical_deterioration", priority: "urgent",
      description: `Rising oxygen requirement overnight ${HARNESS_TAG}`,
      raised_by: someone.id, raised_by_name: someone.full_name,
      ward_round: true, ss_review: true, status: "open",
    }).select("id").single();
    if (se) { console.error("Seed failed:", se.message); process.exit(1); }

    // Nurse lens: the raiser sees it.
    const my = await loadMyConcerns(admin, someone.id);
    const mine = my.raised.find((c: any) => c.id === seeded.id);
    check(!!mine, "raiser's lens contains the seeded concern");
    check(mine?.op_patients?.label === patient.label, "patient label joined", `${mine?.op_patients?.label}`);

    // Supervisor lens: queue holds it with correct KPI flags.
    const q = await loadConcernQueue(admin, patient.hospital_id, patient.hospital_id == null);
    const inQueue = q.concerns.find((c: any) => c.id === seeded.id);
    check(!!inQueue, "supervisor queue contains it");
    check(q.kpis.wardRound >= 1 && q.kpis.ssReview >= 1, "ward-round + SS-review KPIs count it", `wardRound=${q.kpis.wardRound} ssReview=${q.kpis.ssReview}`);
    check(q.perPatient.some((p: any) => p.patient_id === patient.id && p.count >= 1), "per-patient count includes it");

    // Action + resolution lifecycle straight on the rows.
    const { data: act } = await admin.from("op_concern_actions").insert({
      hospital_id: patient.hospital_id, concern_id: seeded.id,
      action: `Review oxygen titration plan ${HARNESS_TAG}`, owner_id: someone.id, owner_name: someone.full_name, status: "open", created_by: someone.id,
    }).select("id").single();
    const my2 = await loadMyConcerns(admin, someone.id);
    check(my2.actionsForMe.some((a: any) => a.id === act?.id), "ward-round action appears in owner's lens");

    await admin.from("op_concerns").update({ status: "resolved", resolution_notes: "test closure", resolved_by: someone.id, resolved_at: new Date().toISOString() }).eq("id", seeded.id);
    const q2 = await loadConcernQueue(admin, patient.hospital_id, patient.hospital_id == null);
    check(!q2.concerns.some((c: any) => c.id === seeded.id), "resolved concern leaves the active queue");
    const my3 = await loadMyConcerns(admin, someone.id);
    check(my3.raised.some((c: any) => c.id === seeded.id && c.status === "resolved"), "…but stays auditable in the raiser's history");

    // Cleanup (cascade removes the action).
    await admin.from("op_concerns").delete().eq("id", seeded.id);
    console.log("(harness rows deleted)");
  }

  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} pass / ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
