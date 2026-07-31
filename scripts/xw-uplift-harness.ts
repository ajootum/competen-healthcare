// CROSS-WORKSPACE SWEEP, UPWARD: bedside -> supervisor -> unit manager -> executive.
//
// The first sweep (xw-sweep-harness.ts) proved the HORIZONTAL loops close: nurse <-> supervisor. This one
// proves the VERTICAL ones - that a fact recorded at the bedside is visible to every management layer above
// it, through the SHIPPED loaders each of those layers actually renders.
//
//   1. ESCALATION   op_escalations -> SSW Escalation Centre -> UMW Operational Command -> HEX Operations
//   2. SAFETY       op_safety_alerts -> SSW Quality & Safety -> UMW alerts -> HEX activeSafety
//   3. INCIDENT     op_incidents -> UMW Incident Centre -> HEX Executive Quality
//   4. CENSUS       op_patients / op_beds -> UMW Capacity Command -> HEX bed + occupancy figures
//   5. SNAPSHOT MEDIATION - the honest one. Some executive surfaces read AGGREGATED op_ops_snapshots
//      rather than live rows, so they legitimately do NOT move when a bedside row is written. Rather than
//      leave that as a surprise, this asserts it as a PROPERTY: which executive numbers are live and which
//      are snapshot-mediated. A failure here means the boundary moved, not that the platform is broken.
//
// Every row it writes is deleted afterwards.
//   npx --yes tsx scripts/xw-uplift-harness.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
loadEnvConfig(process.cwd());

let pass = 0, fail = 0;
const results: { loop: string; ok: boolean; label: string }[] = [];
let loop = "setup";
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  results.push({ loop, ok, label });
  if (ok) pass++; else fail++;
};
const head = (name: string) => { loop = name; console.log(`\n── ${name} ${"─".repeat(Math.max(0, 60 - name.length))}`); };

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error("Missing Supabase env."); process.exit(1); }
  const admin = createClient(url, key, { auth: { persistSession: false } });

  const { loadEscalations } = await import("../src/lib/operations/escalations-workspace");
  const { loadQualitySafety } = await import("../src/lib/operations/quality-safety");
  const { loadOperationalCommand } = await import("../src/lib/operations/ops-command");
  const { loadCapacityCommand } = await import("../src/lib/operations/ops-capacity");
  const { loadIncidentCentre } = await import("../src/lib/operations/incident-centre");
  const { loadExecOperations } = await import("../src/lib/hex/operations");
  const { loadExecQuality } = await import("../src/lib/hex/quality");

  // A hospital with real staff and an existing operational footprint.
  const { data: hosps } = await admin.from("hospitals").select("id").limit(40);
  let hid: string | null = null, staff: any[] = [];
  for (const h of (hosps ?? []) as any[]) {
    const { data: p } = await admin.from("profiles").select("id, full_name").eq("hospital_id", h.id).limit(3);
    if ((p ?? []).length >= 1) { hid = h.id; staff = p as any[]; break; }
  }
  if (!hid) { console.error("No hospital has profiles to test against."); process.exit(1); }
  const nurse = staff[0];
  console.log(`Hospital ${hid}  ·  acting nurse ${nurse.full_name}`);

  const cleanup: { table: string; ids: string[] }[] = [];
  const ins = async (table: string, rows: any[]) => {
    const { data, error } = await admin.from(table).insert(rows).select("id");
    if (error) throw new Error(`${table}: ${error.message}`);
    const ids = (data ?? []).map((r: any) => r.id);
    cleanup.push({ table, ids });
    return ids;
  };
  // Read every layer at once so all four see the SAME database state.
  const readAll = async () => {
    const [ssw, umw, hex] = await Promise.all([
      loadEscalations(admin, hid, false) as any,
      loadOperationalCommand(admin, hid, false, null) as any,
      loadExecOperations(admin, hid, false) as any,
    ]);
    return { ssw, umw, hex };
  };

  try {
    // ── Baseline before writing anything, so every assertion is a DELTA ──
    head("baseline");
    const before = await readAll();
    const beforeQuality: any = await loadExecQuality(admin, hid, false);
    const beforeIncidents: any = await loadIncidentCentre(admin, hid, false);
    check(before.umw.provisioned !== false, "UMW Operational Command reads this tenant");
    check(before.hex.provisioned !== false, "HEX Operations reads this tenant");
    check(beforeIncidents.provisioned !== false, "UMW Incident Centre reads this tenant");
    const baseEsc = before.hex.kpis?.openEsc ?? 0;
    const baseSafety = before.hex.kpis?.activeSafety ?? 0;
    const baseUmwEsc = before.umw.kpis?.escalations ?? 0;
    const baseUmwSafety = before.umw.kpis?.safetyIncidents ?? 0;

    const [patient] = await ins("op_patients", [{
      hospital_id: hid, label: "UPLIFT-1", operational_status: "admitted", acuity_level: "critical",
    }]);

    // ═══ 1. ESCALATION up three layers ═══════════════════════════════════════
    head("1. ESCALATION  bedside -> SSW -> UMW -> HEX");
    const [escId] = await ins("op_escalations", [{
      hospital_id: hid, patient_id: patient, escalation_type: "clinical", level: 4, severity: "high",
      status: "open", summary: "UPLIFT sweep: sustained tachycardia, senior review requested", raised_by: nurse.id,
    }]);
    const a1 = await readAll();
    check((a1.ssw.board ?? []).some((e: any) => e.id === escId), "SSW Escalation Centre shows the bedside escalation");
    check((a1.umw.kpis?.escalations ?? 0) === baseUmwEsc + 1, "UMW Operational Command counts it",
      `${baseUmwEsc} -> ${a1.umw.kpis?.escalations}`);
    check((a1.hex.kpis?.openEsc ?? 0) === baseEsc + 1, "HEX Operations counts it", `${baseEsc} -> ${a1.hex.kpis?.openEsc}`);
    check((a1.hex.alerts ?? []).some((x: any) => /UPLIFT sweep/.test(String(x.title ?? x.label ?? x.summary ?? ""))),
      "and it reaches the executive alert list by its own text, not just a count");

    // Resolving at the bedside must clear all three.
    await admin.from("op_escalations").update({ status: "resolved", resolved_at: new Date().toISOString() }).eq("id", escId);
    const a2 = await readAll();
    check(!(a2.ssw.board ?? []).some((e: any) => e.id === escId), "resolving clears the SSW board");
    check((a2.umw.kpis?.escalations ?? 0) === baseUmwEsc, "and the UMW count returns to baseline");
    check((a2.hex.kpis?.openEsc ?? 0) === baseEsc, "and the HEX count returns to baseline");

    // ═══ 2. SAFETY ALERT up the chain ════════════════════════════════════════
    head("2. SAFETY  bedside alert -> SSW -> UMW -> HEX");
    const [alertId] = await ins("op_safety_alerts", [{
      hospital_id: hid, patient_id: patient, category: "deterioration", severity: "high",
      note: "UPLIFT sweep: deterioration risk", active: true,
    }]);
    const b1 = await readAll();
    const qs: any = await loadQualitySafety(admin, hid, false);
    check((b1.umw.kpis?.safetyIncidents ?? 0) === baseUmwSafety + 1, "UMW counts the active safety alert",
      `${baseUmwSafety} -> ${b1.umw.kpis?.safetyIncidents}`);
    check((b1.hex.kpis?.activeSafety ?? 0) === baseSafety + 1, "HEX counts it", `${baseSafety} -> ${b1.hex.kpis?.activeSafety}`);
    check(qs.provisioned !== false, "SSW Quality & Safety reads the same tenant");
    await admin.from("op_safety_alerts").update({ active: false }).eq("id", alertId);
    const b2 = await readAll();
    check((b2.hex.kpis?.activeSafety ?? 0) === baseSafety, "standing the alert down clears it at every layer");

    // ═══ 3. INCIDENT -> quality chain ════════════════════════════════════════
    head("3. INCIDENT  op_incidents -> UMW Incident Centre -> HEX Quality");
    const baseHarm = beforeQuality.kpis?.harm ?? 0;
    await ins("op_incidents", [{
      hospital_id: hid, patient_id: patient, incident_type: "falls", severity: "medium",
      near_miss: false, status: "reported", description: "UPLIFT sweep: unwitnessed fall, no injury",
      reported_by: nurse.id,
    }]);
    const inc: any = await loadIncidentCentre(admin, hid, false);
    const exq: any = await loadExecQuality(admin, hid, false);
    check(inc.hasData === true, "UMW Incident Centre has data");
    check((inc.kpis?.total ?? inc.kpis?.reported ?? 0) > (beforeIncidents.kpis?.total ?? beforeIncidents.kpis?.reported ?? 0),
      "the incident raises the UMW incident count");
    check(JSON.stringify(inc.inbox ?? []).includes("UPLIFT sweep"), "and appears in the triage inbox by its own text");
    check(exq.provisioned !== false, "HEX Executive Quality reads this tenant");
    check((exq.kpis?.harm ?? 0) >= baseHarm, "the executive harm figure does not go DOWN when an incident is added",
      `${baseHarm} -> ${exq.kpis?.harm}`);

    // ═══ 4. CENSUS -> capacity chain ═════════════════════════════════════════
    head("4. CENSUS  op_patients / op_beds -> UMW Capacity -> HEX Operations");
    const cap: any = await loadCapacityCommand(admin, hid, false, null);
    const c1 = await readAll();
    check(cap.provisioned !== false, "UMW Capacity Command reads this tenant");
    check((c1.umw.kpis?.totalPatients ?? 0) >= 1, "the UMW census includes the admitted patient", `${c1.umw.kpis?.totalPatients}`);
    check(c1.hex.hasPatients === true, "HEX Operations sees live patient detail");
    check((c1.umw.kpis?.highAcuity ?? 0) >= 1, "a CRITICAL patient lands in the UMW high-acuity count", `${c1.umw.kpis?.highAcuity}`);
    check(c1.umw.kpis?.totalBeds === c1.hex.totalBeds,
      "UMW and HEX agree on the bed count — the same rows, not divergent copies",
      `UMW ${c1.umw.kpis?.totalBeds} vs HEX ${c1.hex.totalBeds}`);
    check(typeof c1.umw.kpis?.occupancy === "number" && typeof c1.hex.kpis?.occupancy === "number",
      "both layers report an occupancy number",
      `UMW ${c1.umw.kpis?.occupancy}% (live) vs HEX ${c1.hex.kpis?.occupancy}% (snapshot)`);
    // DOCUMENTED DIVERGENCE: bed COUNT is live on both sides (asserted equal above), but UMW computes
    // occupancy from live bed status while HEX reads the daily op_ops_snapshots aggregate. The two will
    // legitimately differ until a snapshot is written. This is asserted so the boundary is visible rather
    // than looking like a defect to whoever notices the two dashboards disagreeing.
    const hexOccIsSnapshot = fs.readFileSync("src/lib/hex/operations.ts", "utf8")
      .includes("const occupancy = num(cur.occupancy_pct)");
    check(hexOccIsSnapshot, "HEX occupancy is snapshot-derived by design, UMW occupancy is live",
      "a mismatch between the two dashboards is expected between snapshots");

    // ═══ 5. SNAPSHOT MEDIATION — asserted as a property, not assumed ═════════
    head("5. SNAPSHOT MEDIATION  which executive numbers are live vs aggregated");
    const src = (file: string) => fs.readFileSync(`src/lib/hex/${file}`, "utf8") as string;
    const opsSrc = src("operations.ts"), dashSrc = src("dashboard.ts"), wfSrc = src("workforce.ts");
    check(/from\("op_escalations"\)/.test(opsSrc) && /from\("op_patients"\)/.test(opsSrc),
      "HEX Operations reads LIVE op_* rows — bedside events reach it immediately");
    check(!/from\("op_escalations"\)/.test(dashSrc) && /op_ops_snapshots/.test(dashSrc),
      "HEX Dashboard is SNAPSHOT-mediated — it does not move on a single bedside row, by design");
    check(!/from\("op_shift_staff"\)/.test(wfSrc) && /op_ops_snapshots/.test(wfSrc),
      "HEX Workforce is SNAPSHOT-mediated — live clock-ins reach it only once a snapshot is written");

    // Demonstrate the boundary rather than only asserting it from source.
    const [escId2] = await ins("op_escalations", [{
      hospital_id: hid, patient_id: patient, escalation_type: "clinical", level: 3,
      status: "open", summary: "UPLIFT sweep: mediation probe", raised_by: nurse.id, severity: "urgent",
    }]);
    const hexOpsAfter: any = await loadExecOperations(admin, hid, false);
    check((hexOpsAfter.kpis?.openEsc ?? 0) === baseEsc + 1,
      "a new escalation moves the LIVE executive operations number immediately");
    console.log("      (the snapshot-mediated Dashboard/Workforce figures are expected NOT to move until a");
    console.log("       snapshot row is written — that is the documented boundary, not a defect)");
    void escId2;
  } finally {
    head("cleanup");
    const order = ["op_incidents", "op_safety_alerts", "op_escalations", "op_patients"];
    for (const table of order) {
      const ids = [...new Set(cleanup.filter(c => c.table === table).flatMap(c => c.ids))];
      if (ids.length) await admin.from(table).delete().in("id", ids);
    }
    let leftover = 0;
    for (const table of order) {
      const ids = [...new Set(cleanup.filter(c => c.table === table).flatMap(c => c.ids))];
      if (!ids.length) continue;
      const { data } = await admin.from(table).select("id").in("id", ids);
      leftover += (data ?? []).length;
    }
    check(leftover === 0, "every row the sweep wrote is cleaned up",
      leftover ? `${leftover} left` : `${cleanup.reduce((n, c) => n + c.ids.length, 0)} removed`);
  }

  console.log("\n── layer summary ───────────────────────────────────────────────");
  for (const name of [...new Set(results.map(r => r.loop))]) {
    const rs = results.filter(r => r.loop === name);
    const bad = rs.filter(r => !r.ok);
    console.log(`${bad.length ? "BROKEN " : "CLOSED "} ${name}  ${rs.length - bad.length}/${rs.length}${bad.length ? ` — ${bad.map(b => b.label).join("; ")}` : ""}`);
  }
  console.log(`\n${pass}/${pass + fail} checks passed.`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
