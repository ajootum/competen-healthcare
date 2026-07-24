// Patient Operations Platform (POS-001) — Unit Manager lens.
//
// The UMW "Patient Operations" section is the manager-level view of the enterprise
// Patient Operations Platform. Per POS-001 §3.1 the platform is a SINGLE operational
// source of truth: patient/bed/flow/safety state lives once in the op_* tables and is
// already computed by loadPatientOps (used by the Shift Supervisor Workspace). This
// loader composes that shared model and adds the POS-101 command widgets (operational
// pressure score, workload index) + the unit-wide movement timeline (POS-110), so the
// UMW renders the SAME live data as a leadership overview rather than a second store.
//
// The operational registry holds NO PHI (op_patients.label is an operational id, not a
// name; age/diagnosis are operational-lite). Identity/clinical fields come from EMR and
// render as honest "—" states, never fabricated. Forecasting that needs historical rates
// is surfaced as an honest next-phase state, not invented.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadPatientOps } from "@/lib/operations/patient-ops";

const NONE = "00000000-0000-0000-0000-000000000000";
const missing = (e: any) => !!e && /does not exist|schema cache/i.test(e.message ?? "");

// POS-001 §2 platform architecture — the twelve modules and where each lives in the UMW.
// `built:true` = real workspace over live data; `built:false` = honest next-phase.
// `crossLink` = the operational data-entry surface (SSW) a manager is sent to.
export const POS_MODULES: { code: string; name: string; href?: string; built: boolean; note?: string }[] = [
  { code: "POS-101", name: "Operations Dashboard",     href: "/unit-manager/patient-operations",                built: true },
  { code: "POS-102", name: "Patient Census & Registry", href: "/unit-manager/patient-operations/census",         built: true },
  { code: "POS-103", name: "Patient Flow Command",      href: "/unit-manager/patient-operations/flow",           built: true },
  { code: "POS-104", name: "Bed & Capacity",            href: "/unit-manager/patient-operations/beds",           built: true },
  { code: "POS-105", name: "Interactive Ward Map",      href: "/unit-manager/patient-operations/ward-map",       built: true },
  { code: "POS-106", name: "Operations Centre",         href: "/unit-manager/patient-operations/operations-centre", built: true },
  { code: "POS-107", name: "Clinical Safety Centre",    href: "/unit-manager/patient-operations/safety",         built: true },
  { code: "POS-108", name: "Patient Card Workspace",    href: "/unit-manager/patient-operations/patient-card",   built: true },
  { code: "POS-109", name: "Operational Documentation", href: "/unit-manager/patient-operations/documentation",  built: true },
  { code: "POS-110", name: "Patient Timeline Engine",   href: "/unit-manager/patient-operations/timeline",       built: true },
  { code: "POS-111", name: "Operational Analytics",     href: "/unit-manager/patient-operations/analytics",      built: true },
  { code: "POS-112", name: "Configuration & Rules",     href: "/unit-manager/patient-operations/configuration",  built: true },
  // NOTE: all twelve POS modules are now real workspaces (POS-106/109/112 deepened onto stores).
];

// POS-001 §5 downstream consumers of the operational dataset.
export const POS_CONSUMERS = [
  "Shift Supervisor Workspace", "Unit Manager Workspace", "Workforce Scheduling Engine",
  "Team Assignment Governance", "Quality & Safety", "AI Operational Copilot", "Executive Dashboards",
];

// Rule-based Operational Pressure Score (POS-101 widget). NOT a trained model — a
// transparent 0-100 composite of live pressure drivers, each capped so no single
// driver dominates. Bands: <34 Normal, <67 Elevated, else High.
function pressureScore(po: any) {
  const s = po.summary, cap = po.capacity;
  const drivers: { label: string; pts: number }[] = [];
  const occ = cap.occPct ?? 0;
  drivers.push({ label: `Occupancy ${occ}%`, pts: Math.min(30, Math.round((occ / 100) * 30)) });
  drivers.push({ label: `${s.highRisk} high-acuity`, pts: Math.min(25, s.highRisk * 6) });
  drivers.push({ label: `${po.deteriorating.length} deteriorating`, pts: Math.min(15, po.deteriorating.length * 5) });
  drivers.push({ label: `${po.openEsc.length} open escalation(s)`, pts: Math.min(15, po.openEsc.length * 5) });
  drivers.push({ label: `${s.unassigned} unassigned`, pts: Math.min(10, s.unassigned * 4) });
  drivers.push({ label: `${po.flow.awaitingBed.length} awaiting bed`, pts: Math.min(5, po.flow.awaitingBed.length * 2) });
  const score = Math.min(100, drivers.reduce((n, d) => n + d.pts, 0));
  const band = score >= 67 ? "High" : score >= 34 ? "Elevated" : "Normal";
  return { score, band, drivers: drivers.filter(d => d.pts > 0).sort((a, b) => b.pts - a.pts) };
}

export async function loadPatientOperations(admin: any, hid: string | null, isSuper: boolean) {
  const po = await loadPatientOps(admin, hid, isSuper);
  if (!po.ready) return { ready: false as const };

  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));

  // Workload index — patients per active nurse, acuity-weighted (POS-101 / POS-111).
  const nurseCount = po.nurses.length;
  const acuityLoad = po.active.reduce((n: number, p: any) =>
    n + (p.state === "Critical" ? 2 : p.state === "High Risk" ? 1.5 : 1), 0);
  const workload = {
    ratio: nurseCount ? +(po.active.length / nurseCount).toFixed(1) : null,
    weighted: nurseCount ? +(acuityLoad / nurseCount).toFixed(1) : null,
    nurses: nurseCount,
    patients: po.active.length,
  };

  const pressure = pressureScore(po);

  // Unit-wide movement timeline (POS-110) — real chronological operational record.
  // Fail-soft pre-migration-050.
  let timeline: any[] = [];
  let timelineReady = true;
  const tl = await scope(admin.from("op_movement_events")
    .select("id, event_type, detail, created_at, patient_id, op_patients!patient_id(label)")
    .order("created_at", { ascending: false }).limit(120));
  if ((tl as any).error) { timelineReady = !missing((tl as any).error); timeline = []; }
  else timeline = (tl.data ?? []) as any[];

  // Today's flow (POS-101 Admissions/Discharges/Transfers Today) — derived from the
  // movement log. Honest only where the log is provisioned; else null → "—".
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const since = dayStart.getTime();
  const todayOf = (t: string) => timeline.filter(e => e.event_type === t && new Date(e.created_at).getTime() >= since).length;
  const today = timelineReady
    ? { admissions: todayOf("admission"), discharges: todayOf("discharge"), transfers: todayOf("transfer") }
    : { admissions: null, discharges: null, transfers: null };

  return {
    ready: true as const,
    po,                       // full shared model (census/flow/beds/zones/safety/copilot)
    pressure, workload, timeline, timelineReady, today,
    modules: POS_MODULES, consumers: POS_CONSUMERS,
  };
}
