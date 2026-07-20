// Shared data model for the Patient Operations section (SSW-005 / Patient
// Operations Section) — Patient List, Patient Flow, Clinical Safety, Bed
// Management and Ward Map. Per the spec these five modules MUST share one
// patient/bed/staffing/acuity/alert/assignment model, so everything is computed
// once here from live op_* data and sliced per module. Fields the operational
// schema does not hold (patient age/diagnosis — EMR; flow blockers, bed
// turnaround events, capacity forecasting, floor-plan coordinates) are NOT
// invented; the module pages surface honest callouts for them.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadOpsConsoleData } from "@/lib/operations/ops-console-data";

export const fmtTime = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : "--:--";
export const titleCase = (s: string) => (s ?? "").replace(/_/g, " ").split(" ").filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
export const ewsColor = (n: number | null) => n == null ? "text-gray-400" : n >= 7 ? "text-red-600" : n >= 5 ? "text-orange-600" : n >= 3 ? "text-yellow-600" : "text-green-600";

// Shared operational clinical-state model (spec: "Common patient status model").
export const STATE_TONE: Record<string, string> = {
  "Critical": "bg-red-100 text-red-700", "High Risk": "bg-orange-100 text-orange-700", "Review Required": "bg-amber-100 text-amber-700",
  "Observation": "bg-yellow-100 text-yellow-700", "Stable": "bg-green-100 text-green-700", "Theatre": "bg-indigo-100 text-indigo-700",
  "Transfer Pending": "bg-sky-100 text-sky-700", "Discharge Ready": "bg-teal-100 text-teal-700", "Expected": "bg-gray-100 text-gray-600", "Discharged": "bg-gray-100 text-gray-400",
};
export const BED_TONE: Record<string, string> = {
  occupied: "border-gray-200", available: "border-blue-300 bg-blue-50/40", reserved: "border-violet-300 bg-violet-50/40",
  cleaning: "border-orange-300 bg-orange-50/40", out_of_service: "border-gray-300 bg-gray-100",
};

export async function loadPatientOps(admin: any, hid: string | null, isSuper: boolean) {
  const { ready, data } = await loadOpsConsoleData(admin, hid, isSuper);
  if (!ready) return { ready: false as const };
  const { beds, patients, assignments, escalations, alerts, observations } = data;

  // ── Per-patient enrichment ───────────────────────────────────────────────
  const obsByPatient = new Map<string, any[]>();
  observations.forEach((o: any) => { if (!obsByPatient.has(o.patient_id)) obsByPatient.set(o.patient_id, []); obsByPatient.get(o.patient_id)!.push(o); });
  const latestEws = (pid: string) => {
    const list = (obsByPatient.get(pid) ?? []).filter(o => o.ews_score != null).sort((a, b) => new Date(b.recorded_at ?? b.created_at ?? 0).getTime() - new Date(a.recorded_at ?? a.created_at ?? 0).getTime());
    return list[0]?.ews_score ?? null;
  };
  const pewsTrend = (pid: string) => (obsByPatient.get(pid) ?? []).filter(o => o.ews_score != null)
    .sort((a, b) => new Date(a.recorded_at ?? a.created_at ?? 0).getTime() - new Date(b.recorded_at ?? b.created_at ?? 0).getTime())
    .slice(-6).map(o => ({ v: o.ews_score as number, at: o.recorded_at ?? o.created_at }));
  const lastObs = (pid: string) => (obsByPatient.get(pid) ?? []).filter(o => o.recorded_at).sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime())[0]?.recorded_at ?? null;
  const nextReview = (pid: string) => (obsByPatient.get(pid) ?? []).filter(o => o.status === "due" && o.due_at).sort((a, b) => a.due_at.localeCompare(b.due_at))[0]?.due_at ?? null;
  const overdueObs = (pid: string) => (obsByPatient.get(pid) ?? []).some(o => o.status === "overdue");

  const nurseByPatient = new Map<string, { id: string; name: string }>();
  assignments.forEach((a: any) => { if (a.patient_id && !nurseByPatient.has(a.patient_id)) nurseByPatient.set(a.patient_id, { id: a.staff_id, name: a.profiles?.full_name ?? "" }); });
  const bedType = new Map<string, string>(beds.map((b: any) => [b.id, b.bed_type]));
  const alertsByPatient = new Map<string, any[]>();
  alerts.forEach((a: any) => { if (!a.patient_id) return; if (!alertsByPatient.has(a.patient_id)) alertsByPatient.set(a.patient_id, []); alertsByPatient.get(a.patient_id)!.push(a); });
  const escByPatient = new Map<string, any[]>();
  escalations.forEach((e: any) => { if (!e.patient_id) return; if (!escByPatient.has(e.patient_id)) escByPatient.set(e.patient_id, []); escByPatient.get(e.patient_id)!.push(e); });

  const clinicalState = (p: any, ews: number | null): string => {
    if (p.operational_status === "discharged") return "Discharged";
    if (p.operational_status === "discharge_pending") return "Discharge Ready";
    if (p.operational_status === "transfer_pending") return "Transfer Pending";
    if (p.bed_id && bedType.get(p.bed_id) === "theatre") return "Theatre";
    if (p.operational_status === "expected") return "Expected";
    if (p.acuity_level === "critical" || (ews != null && ews >= 7)) return "Critical";
    if (p.acuity_level === "high" || p.risk_level === "high" || (ews != null && ews >= 5)) return "High Risk";
    if (p.acuity_level === "moderate") return "Review Required";
    if (overdueObs(p.id) || nextReview(p.id)) return "Observation";
    return "Stable";
  };

  const enriched = patients.map((p: any) => {
    const ews = latestEws(p.id);
    const flags: string[] = [];
    (alertsByPatient.get(p.id) ?? []).forEach(a => flags.push(titleCase(a.category)));
    if (p.isolation_status && p.isolation_status !== "none") flags.push(`${titleCase(p.isolation_status)} isolation`);
    return {
      id: p.id, bed: p.op_beds?.label ?? null, bedId: p.bed_id ?? null, label: p.label,
      acuity: p.acuity_level, risk: p.risk_level, isolation: p.isolation_status, opStatus: p.operational_status,
      department: p.departments?.name ?? null, age: p.age_years ?? null, diagnosis: p.diagnosis ?? null, consultant: p.consultant ?? null, stage: p.current_stage ?? null,
      pews: ews, pewsTrend: pewsTrend(p.id), lastObs: lastObs(p.id), nextReview: nextReview(p.id), overdueObs: overdueObs(p.id),
      nurse: nurseByPatient.get(p.id)?.name ?? null, nurseId: nurseByPatient.get(p.id)?.id ?? null,
      alerts: alertsByPatient.get(p.id) ?? [], escalations: escByPatient.get(p.id) ?? [], flags,
      state: clinicalState(p, ews),
    };
  });
  const active = enriched.filter(p => p.state !== "Discharged");

  // ── Summary (Patient List banner) ────────────────────────────────────────
  const inState = (s: string) => active.filter(p => p.state === s).length;
  const summary = {
    total: active.length,
    occupied: beds.filter((b: any) => b.status === "occupied").length,
    critical: active.filter(p => p.state === "Critical").length,
    review: active.filter(p => p.state === "Review Required" || p.state === "Observation").length,
    admissionsExpected: inState("Expected"),
    transfersPending: inState("Transfer Pending"),
    dischargesExpected: inState("Discharge Ready"),
    isolation: active.filter(p => p.isolation && p.isolation !== "none").length,
    theatre: inState("Theatre"),
    unassigned: active.filter(p => !p.nurseId).length,
    highRisk: active.filter(p => p.state === "High Risk" || p.state === "Critical").length,
  };

  // ── Flow pipeline (Patient Flow) ─────────────────────────────────────────
  // Mutually-exclusive kanban stages (a patient appears in exactly one column):
  // Expected = incoming with a reserved bed; Awaiting Bed = incoming without one;
  // In Care excludes theatre/transfer (those live in Transfer / Theatre).
  const flow = {
    expected: enriched.filter(p => p.opStatus === "expected" && p.bedId),
    awaitingBed: enriched.filter(p => p.opStatus === "expected" && !p.bedId),
    admitted: enriched.filter(p => p.opStatus === "admitted" && p.state === "Stable"),
    inCare: enriched.filter(p => p.opStatus === "admitted" && p.state !== "Theatre" && p.state !== "Transfer Pending"),
    transferTheatre: enriched.filter(p => p.state === "Transfer Pending" || p.state === "Theatre"),
    dischargeReady: enriched.filter(p => p.state === "Discharge Ready"),
    discharged: enriched.filter(p => p.opStatus === "discharged"),
  };
  // Blockers we can actually detect from live data (bed cleaning, no free bed, unbedded expected).
  const cleaningBeds = beds.filter((b: any) => b.status === "cleaning");
  const freeBeds = beds.filter((b: any) => b.status === "available").length;
  const blockers: { label: string; detail: string }[] = [];
  if (freeBeds === 0 && flow.awaitingBed.length) blockers.push({ label: "No bed available", detail: `${flow.awaitingBed.length} awaiting, 0 free beds` });
  cleaningBeds.forEach((b: any) => blockers.push({ label: "Bed awaiting cleaning", detail: b.label }));
  flow.awaitingBed.forEach(p => blockers.push({ label: "Awaiting bed allocation", detail: p.label }));

  // Logged flow blockers (migration 048) — real + resolvable. Fail-soft pre-migration.
  const fbScope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? "00000000-0000-0000-0000-000000000000"));
  const fbRes = await fbScope(admin.from("op_flow_blockers").select("id, category, detail, patient_id, op_patients!patient_id(label)")).eq("status", "open").order("created_at", { ascending: false }).limit(100);
  const flowBlockers = (fbRes as any).error ? [] : ((fbRes.data ?? []) as any[]);
  const flowBlockersReady = !(fbRes as any).error;
  // Active bed turnarounds (migration 049). Fail-soft pre-migration.
  const btRes = await fbScope(admin.from("op_bed_turnaround").select("id, bed_id, patient_label, stage, op_beds!bed_id(label)")).neq("stage", "ready").order("created_at", { ascending: true }).limit(100);
  const turnaround = (btRes as any).error ? [] : ((btRes.data ?? []) as any[]);
  const turnaroundReady = !(btRes as any).error;

  // ── Safety (Clinical Safety) ─────────────────────────────────────────────
  const openEsc = escalations.filter((e: any) => ["open", "acknowledged"].includes(e.status));
  const deteriorating = active.filter(p => p.pews != null && p.pews >= 5);
  const alertCat = (c: string) => alerts.filter((a: any) => a.category === c).length;
  const safetyBanner = {
    pewsAlerts: deteriorating.length,
    deteriorating: deteriorating.length,
    overdueObs: observations.filter((o: any) => o.status === "overdue").length,
    medication: alertCat("medication"), falls: alertCat("fall_risk"), pressure: alertCat("pressure_injury"),
    isolation: active.filter(p => p.isolation && p.isolation !== "none").length,
    rapidResponse: escalations.filter((e: any) => e.level >= 4).length,
    incidents: alerts.length,
  };
  // Unified alert queue: safety alerts + open escalations + overdue observations.
  const SEV_RANK: Record<string, number> = { critical: 0, high: 1, moderate: 2, medium: 2, low: 3, informational: 4, routine: 4, urgent: 1, emergency: 0 };
  const alertQueue = [
    ...alerts.map((a: any) => ({ kind: "alert", patient: a.op_patients?.label ?? "patient", patientId: a.patient_id, type: titleCase(a.category), severity: a.severity, at: a.created_at, action: "Review" })),
    ...openEsc.map((e: any) => ({ kind: "escalation", patient: e.op_patients?.label ?? "patient", patientId: e.patient_id, type: `Escalation L${e.level}`, severity: e.severity, at: e.created_at, action: "Acknowledge" })),
    ...observations.filter((o: any) => o.status === "overdue").map((o: any) => ({ kind: "overdue", patient: o.op_patients?.label ?? "patient", patientId: o.patient_id, type: "Observation overdue", severity: "moderate", at: o.due_at, action: "Review" })),
  ].sort((a, b) => (SEV_RANK[a.severity] ?? 5) - (SEV_RANK[b.severity] ?? 5));
  const recordedObs = observations.filter((o: any) => o.status === "recorded").length;
  const dueOrOverdue = observations.filter((o: any) => ["due", "overdue"].includes(o.status)).length;
  const compliance = {
    observation: (recordedObs + dueOrOverdue) ? Math.round((recordedObs / (recordedObs + dueOrOverdue)) * 100) : null,
    validated: assignments.length ? Math.round((assignments.filter((a: any) => a.competency_validated).length / assignments.length) * 100) : null,
    isolationPatients: summary.isolation,
  };

  // ── Bed Management ───────────────────────────────────────────────────────
  const bedBy = (s: string) => beds.filter((b: any) => b.status === s).length;
  const patientByBed = new Map<string, any>();
  enriched.forEach(p => { if (p.bedId) patientByBed.set(p.bedId, p); });
  const bedBoard = beds.map((b: any) => ({ id: b.id, label: b.label, status: b.status, type: b.bed_type, department: b.departments?.name ?? null, patient: patientByBed.get(b.id) ?? null }));
  const capacity = {
    total: beds.length, occupied: bedBy("occupied"), available: bedBy("available"), reserved: bedBy("reserved"),
    cleaning: bedBy("cleaning"), maintenance: bedBy("out_of_service"),
    isolation: enriched.filter(p => p.isolation && p.isolation !== "none" && p.bedId).length,
    occPct: beds.length ? Math.round((bedBy("occupied") / beds.length) * 100) : 0,
    expectedVacancies: summary.dischargesExpected, expectedDemand: summary.admissionsExpected,
  };

  // ── Zones (Ward Map) — grouped by department (no spatial coords in schema) ─
  // Every bed lands in exactly one zone: named departments, plus an "Unassigned"
  // zone for beds with no department (so untagged beds/patients never vanish).
  const namedZones = [...new Set(bedBoard.map(b => b.department).filter(Boolean))] as string[];
  const untaggedKey = namedZones.length ? "Unassigned" : "Ward";
  const hasUntagged = bedBoard.some(b => !b.department);
  const zoneNames = namedZones.length ? (hasUntagged ? [...namedZones, untaggedKey] : namedZones) : ["Ward"];
  const zones = zoneNames.map(z => {
    const zBeds = bedBoard.filter(b => (b.department ?? untaggedKey) === z);
    const zPatients = zBeds.map(b => b.patient).filter(Boolean) as any[];
    const staffIds = new Set(zPatients.map(p => p.nurseId).filter(Boolean));
    return {
      name: z, beds: zBeds, patients: zPatients.length, available: zBeds.filter(b => b.status === "available").length,
      highRisk: zPatients.filter(p => p.state === "High Risk" || p.state === "Critical").length,
      staff: staffIds.size, ratio: staffIds.size ? +(zPatients.length / staffIds.size).toFixed(1) : null,
      alerts: zPatients.reduce((n, p) => n + p.alerts.length, 0),
    };
  });

  // ── Operational Copilot (rule-based, shared) ─────────────────────────────
  const copilot: { text: string; action: string; href: string }[] = [];
  deteriorating.slice(0, 2).forEach(p => copilot.push({ text: `Deterioration — ${p.bed ?? p.label} (PEWS ${p.pews})`, action: "Escalate", href: "/supervisor/clinical-safety" }));
  active.filter(p => !p.nurseId).slice(0, 2).forEach(p => copilot.push({ text: `${p.bed ?? p.label} has no assigned nurse`, action: "Assign", href: "/supervisor/patient-list" }));
  if (capacity.occPct >= 85) copilot.push({ text: `Capacity ${capacity.occPct}% — ${summary.dischargesExpected} discharge(s) could free beds`, action: "Review", href: "/supervisor/bed-management" });
  active.filter(p => p.overdueObs).slice(0, 2).forEach(p => copilot.push({ text: `Observation overdue — ${p.bed ?? p.label}`, action: "Review", href: "/supervisor/clinical-safety" }));
  const zoneHot = zones.filter(z => z.highRisk >= 2).sort((a, b) => b.highRisk - a.highRisk)[0];
  if (zoneHot) copilot.push({ text: `${zoneHot.name} has ${zoneHot.highRisk} high-acuity patients — consider rebalancing`, action: "Rebalance", href: "/supervisor/ward-map" });

  const nurses = [...new Map(assignments.map((a: any) => [a.staff_id, a.profiles?.full_name])).entries()].map(([id, name]) => ({ id, name }));

  return {
    ready: true as const, patients: enriched, active, summary, flow, blockers, flowBlockers, flowBlockersReady, turnaround, turnaroundReady,
    safetyBanner, alertQueue, deteriorating, compliance, openEsc,
    bedBoard, capacity, cleaningBeds, zones, nurses, copilot,
  };
}
