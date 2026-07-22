// Patient Operations Center (SSW-003) loader — the authoritative operational view
// of every patient under the unit's responsibility, assembled from live Clinical
// Operations (op_*) data. Builds per-patient census records (acuity, safety flags,
// observation status, responsible staff, operational status) rich enough to drive
// the census table AND the patient drawer client-side without a round-trip, plus
// the dashboard KPIs, flow, capacity, high-risk and observation-compliance panels.
// The operational registry holds NO PHI (op_patients.label is an operational id,
// not a name) — identity fields (MRN, age, sex, attending team) come from EMR
// integration and render as honest states, never fabricated.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadOpsConsoleData } from "@/lib/operations/ops-console-data";

const tc = (s: string) => (s ?? "").replace(/_/g, " ").split(" ").filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
const FLAG_LABEL: Record<string, string> = { fall_risk: "Fall Risk", deterioration: "Deterioration Risk", pressure_injury: "Pressure Injury", infection: "Infection", medication: "Medication", device: "Device", environmental: "Environmental" };
const sevTone = (s: string) => (s === "high" ? "rose" : s === "medium" ? "amber" : "gray");

export async function loadPatientOpsCenter(admin: any, hid: string | null, isSuper: boolean) {
  const { ready, data } = await loadOpsConsoleData(admin, hid, isSuper);
  if (!ready) return { ready: false as const };
  const { beds, patients, assignments, escalations, alerts, observations } = data;
  const now = Date.now();
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

  // Indexes
  const latestObs = new Map<string, any>();
  observations.forEach((o: any) => {
    const t = new Date(o.recorded_at ?? o.created_at ?? 0).getTime();
    const cur = latestObs.get(o.patient_id);
    if (!cur || t > cur._t) latestObs.set(o.patient_id, { ...o, _t: t });
  });
  const obsByPatient = new Map<string, any[]>();
  observations.forEach((o: any) => { if (!obsByPatient.has(o.patient_id)) obsByPatient.set(o.patient_id, []); obsByPatient.get(o.patient_id)!.push(o); });
  const nurseByPatient = new Map<string, string>();
  assignments.forEach((a: any) => { if (a.patient_id && a.status !== "ended" && !nurseByPatient.has(a.patient_id)) nurseByPatient.set(a.patient_id, a.profiles?.full_name ?? ""); });
  const alertsByPatient = new Map<string, any[]>();
  alerts.forEach((a: any) => { if (!a.patient_id) return; if (!alertsByPatient.has(a.patient_id)) alertsByPatient.set(a.patient_id, []); alertsByPatient.get(a.patient_id)!.push(a); });
  const bedLabel = new Map<string, string>(beds.map((b: any) => [b.id, b.label]));

  const obsStatusFor = (pid: string) => {
    const list = obsByPatient.get(pid) ?? [];
    const overdue = list.filter((o: any) => o.status === "overdue" && o.due_at).sort((a: any, b: any) => a.due_at.localeCompare(b.due_at))[0];
    if (overdue) return { label: "Overdue", tone: "rose", detail: `${Math.max(1, Math.round((now - new Date(overdue.due_at).getTime()) / 60000))} min` };
    const due = list.filter((o: any) => o.status === "due" && o.due_at).sort((a: any, b: any) => a.due_at.localeCompare(b.due_at))[0];
    if (due) return { label: "Due Soon", tone: "amber", detail: `${Math.max(0, Math.round((new Date(due.due_at).getTime() - now) / 60000))} min` };
    return { label: "Up to date", tone: "green", detail: "" };
  };

  // ── Per-patient census records (drive table + drawer) ────────────────────
  const records = patients.map((p: any) => {
    const obs = latestObs.get(p.id);
    const flags: { label: string; tone: string }[] = [];
    (alertsByPatient.get(p.id) ?? []).forEach((a: any) => flags.push({ label: FLAG_LABEL[a.category] ?? tc(a.category), tone: sevTone(a.severity) }));
    if (p.isolation_status && p.isolation_status !== "none") flags.push({ label: `${tc(p.isolation_status)} Isolation`, tone: "purple" });
    const activity = [
      ...(obsByPatient.get(p.id) ?? []).filter((o: any) => o.status === "recorded" && o.recorded_at).map((o: any) => ({ at: o.recorded_at, text: `Observation recorded${o.ews_score != null ? ` · EWS ${o.ews_score}` : ""}`, tone: "gray" })),
      ...(alertsByPatient.get(p.id) ?? []).map((a: any) => ({ at: a.created_at, text: `Safety flag "${FLAG_LABEL[a.category] ?? tc(a.category)}"${a.note ? ` · ${a.note}` : ""}`, tone: sevTone(a.severity) })),
    ].filter(x => x.at).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);
    return {
      id: p.id, label: p.label, ref: p.patient_ref ?? null, bed: bedLabel.get(p.bed_id) ?? null,
      acuity: p.acuity_level, risk: p.risk_level, isolation: p.isolation_status, status: p.operational_status,
      flags, obsStatus: obsStatusFor(p.id), nurse: nurseByPatient.get(p.id) || null,
      ews: obs?.ews_score ?? null, lastObs: obs?.recorded_at ?? null,
      nextReview: (obsByPatient.get(p.id) ?? []).filter((o: any) => o.status === "due" && o.due_at).sort((a: any, b: any) => a.due_at.localeCompare(b.due_at))[0]?.due_at ?? null,
      admittedAt: p.created_at ?? null, activity,
      groups: [
        ...(["high", "critical"].includes(p.acuity_level) ? ["High Acuity"] : []),
        ...(p.acuity_level === "critical" || p.risk_level === "high" ? ["Critical Risk"] : []),
        ...(p.isolation_status && p.isolation_status !== "none" ? ["Isolation"] : []),
        ...(p.operational_status === "discharge_pending" ? ["Discharge Pending"] : []),
      ],
    };
  });
  const active = records.filter((r: any) => r.status !== "discharged");

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const bedBy = (s: string) => beds.filter((b: any) => b.status === s).length;
  const totalBeds = beds.length, occupied = bedBy("occupied");
  const byStatus = (s: string) => patients.filter((p: any) => p.operational_status === s).length;
  const overdueObs = observations.filter((o: any) => o.status === "overdue").length;
  const openEsc = escalations.filter((e: any) => ["open", "acknowledged"].includes(e.status));
  const kpis = {
    total: active.length,
    highAcuity: active.filter((r: any) => ["high", "critical"].includes(r.acuity)).length,
    criticalRisk: active.filter((r: any) => r.acuity === "critical" || r.risk === "high").length,
    occupied, totalBeds, occPct: totalBeds ? Math.round((occupied / totalBeds) * 100) : 0,
    pendingAdmissions: byStatus("expected"), pendingDischarges: byStatus("discharge_pending"),
    overdueObs, escalations: openEsc.length, criticalEsc: escalations.filter((e: any) => e.level >= 4).length,
  };

  // ── Flow ─────────────────────────────────────────────────────────────────
  const admittedToday = patients.filter((p: any) => p.operational_status === "admitted" && p.created_at && new Date(p.created_at) >= todayStart).length;
  const flow = { pendingAdmissions: byStatus("expected"), admittedToday, transfers: byStatus("transfer_pending"), dischargePending: byStatus("discharge_pending") };

  // ── Bed capacity ─────────────────────────────────────────────────────────
  const capacity = { occupied, available: bedBy("available"), reserved: bedBy("reserved"), cleaning: bedBy("cleaning"), blocked: bedBy("out_of_service"), total: totalBeds };

  // ── High-risk list ───────────────────────────────────────────────────────
  const rank: Record<string, number> = { critical: 0, high: 1, moderate: 2, stable: 3 };
  const highRisk = active.filter((r: any) => ["critical", "high"].includes(r.acuity) || r.risk === "high")
    .sort((a: any, b: any) => (rank[a.acuity] ?? 9) - (rank[b.acuity] ?? 9)).slice(0, 6);

  // ── Observation compliance ───────────────────────────────────────────────
  const recorded = observations.filter((o: any) => o.status === "recorded").length;
  const due = observations.filter((o: any) => o.status === "due").length;
  const obsCompliance = {
    completed: recorded, due, overdue: overdueObs,
    pct: (recorded + due + overdueObs) ? Math.round((recorded / (recorded + due + overdueObs)) * 100) : null,
  };

  // Ward map beds (with patient acuity for colour).
  const patientByBed = new Map<string, any>();
  records.forEach((r: any) => { const p = patients.find((x: any) => x.id === r.id); if (p?.bed_id) patientByBed.set(p.bed_id, r); });
  const wardBeds = beds.slice(0, 24).map((b: any) => ({ id: b.id, label: b.label, status: b.status, acuity: patientByBed.get(b.id)?.acuity ?? null }));

  return {
    ready: true as const, records, active, kpis, flow, capacity, highRisk, obsCompliance, wardBeds,
    tabs: [
      { key: "all", label: "All Patients", n: active.length },
      { key: "High Acuity", label: "High Acuity", n: active.filter((r: any) => r.groups.includes("High Acuity")).length },
      { key: "Critical Risk", label: "Critical Risk", n: active.filter((r: any) => r.groups.includes("Critical Risk")).length },
      { key: "Isolation", label: "Isolation", n: active.filter((r: any) => r.groups.includes("Isolation")).length },
      { key: "Discharge Pending", label: "Discharge Pending", n: active.filter((r: any) => r.groups.includes("Discharge Pending")).length },
    ],
    generatedAt: new Date().toISOString(),
  };
}
