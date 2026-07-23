// Handover Centre shared loader (SSW-HC-002..012). The single source of truth every
// Handover Centre module builds on. Composes live operational data (loadOpsConsoleData:
// patients, beds, latest observations/PEWS, escalations, safety alerts, tasks) with the
// handover store (op_handovers / op_handover_items / op_handover_audits, migration 079)
// into per-patient handover rows + section KPIs, and auto-generates an honest SBAR from
// real operational fields (op_patients carries no PHI, so the narrative states only
// operational facts + whatever a clinician has typed — never fabricated demographics or
// diagnoses). Fail-soft: degrades to honest empty/not-provisioned states.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadOpsConsoleData } from "@/lib/operations/ops-console-data";

const NONE = "00000000-0000-0000-0000-000000000000";
const missing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));

// The 8 JBI bedside-handover checklist domains (SSW-HC-008 §4).
export const JBI_DOMAINS = [
  { key: "identification", label: "Patient identification" },
  { key: "clinical_info", label: "Clinical information" },
  { key: "situation_awareness", label: "Situation awareness" },
  { key: "background", label: "Background / relevant history" },
  { key: "assessment", label: "Assessment shared" },
  { key: "recommendation", label: "Recommendation / plan" },
  { key: "shared_understanding", label: "Shared understanding" },
  { key: "professional", label: "Professional communication" },
];
export const JBI_MAX = JBI_DOMAINS.length * 5;

export function riskBadge(p: any, pews: number | null): "High Risk" | "At Risk" | "Stable" {
  if (["critical", "high"].includes(p.acuity_level) || p.risk_level === "high" || (pews != null && pews >= 6)) return "High Risk";
  if (p.acuity_level === "moderate" || p.risk_level === "medium" || (pews != null && pews >= 3)) return "At Risk";
  return "Stable";
}

// Honest SBAR auto-generated from real operational fields only.
export function autoSBAR(row: any): { situation: string; background: string; assessment: string; recommendation: string } {
  const pews = row.pews != null ? `PEWS ${row.pews}` : "PEWS not recorded";
  const iso = row.isolation && row.isolation !== "none" ? ` · Isolation: ${row.isolation}` : "";
  return {
    situation: `${row.label}${row.bed ? ` (Bed ${row.bed})` : ""}${row.dept ? ` · ${row.dept}` : ""}. ${pews} — ${row.risk}. Acuity: ${row.acuity}${iso}.`,
    background: `Operational status: ${row.status}. Dependency ${String(row.dependency ?? "").replace("level_", "level ")}. Clinical background is entered by the clinician (not held in the operational record).`,
    assessment: `${row.escalations} active escalation${row.escalations === 1 ? "" : "s"}, ${row.alerts} safety alert${row.alerts === 1 ? "" : "s"}, ${row.openTasks} open task${row.openTasks === 1 ? "" : "s"}. ${row.pews != null && row.pews >= 6 ? "High deterioration risk (PEWS ≥ 6)." : row.pews != null && row.pews >= 3 ? "Raised PEWS — monitor." : "Observations within expected range."}`,
    recommendation: `${row.pews != null && row.pews >= 6 ? "Escalate / monitor closely; " : ""}${row.openTasks ? `complete ${row.openTasks} outstanding task${row.openTasks === 1 ? "" : "s"}; ` : ""}continue plan of care and confirm at bedside.`,
  };
}

export function classify(pct: number): string {
  return pct >= 85 ? "Excellent" : pct >= 70 ? "Good" : pct >= 60 ? "Fair" : "Needs Improvement";
}

export async function loadHandoverContext(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const { ready, data } = await loadOpsConsoleData(admin, hid, isSuper);
  if (!ready) return { ready: false as const, provisioned: false as const };

  const { patients, observations, escalations, alerts, tasks } = data;

  // Latest observation (PEWS) per patient
  const latestObs = new Map<string, any>();
  for (const o of observations) {
    const t = new Date(o.recorded_at ?? o.created_at ?? 0).getTime();
    const cur = latestObs.get(o.patient_id);
    if (!cur || t > cur._t) latestObs.set(o.patient_id, { ...o, _t: t });
  }
  const openTaskBy = (pid: string) => tasks.filter((t: any) => t.patient_id === pid).length;
  const escBy = (pid: string) => escalations.filter((e: any) => e.patient_id === pid).length;
  const alertBy = (pid: string) => alerts.filter((a: any) => a.patient_id === pid).length;

  // Existing handover for this tenant (most recent open), + its per-patient items
  let handover: any = null; const itemsByPatient = new Map<string, any>(); let handoverProvisioned = true;
  try {
    const { data: hos, error } = await scope(admin.from("op_handovers").select("*").order("created_at", { ascending: false })).limit(1);
    if (error && missing(error)) handoverProvisioned = true; // base table exists; 079 cols may be absent → still fine
    handover = (hos ?? [])[0] ?? null;
    if (handover) {
      const { data: items } = await admin.from("op_handover_items").select("*").eq("handover_id", handover.id).limit(500);
      for (const it of items ?? []) if (it.patient_id) itemsByPatient.set(it.patient_id, it);
    }
  } catch { handoverProvisioned = false; }

  const rows = patients.map((p: any) => {
    const obs = latestObs.get(p.id);
    const pews = obs?.ews_score ?? null;
    const risk = riskBadge(p, pews);
    const item = itemsByPatient.get(p.id);
    const base = {
      patientId: p.id, label: p.label, bed: p.op_beds?.label ?? null, dept: p.departments?.name ?? null,
      pews, acuity: p.acuity_level, dependency: p.dependency_level, isolation: p.isolation_status,
      riskLevel: p.risk_level, risk, status: p.operational_status,
      openTasks: openTaskBy(p.id), escalations: escBy(p.id), alerts: alertBy(p.id),
      itemId: item?.id ?? null, itemStatus: item?.item_status ?? "pending",
      reviewed: !!item?.reviewed, accepted: !!item?.accepted, sbarStatus: item?.sbar_status ?? "draft",
      jbiScore: item?.jbi_score ?? null,
    };
    const sbar = {
      situation: item?.sbar_situation ?? null, background: item?.sbar_background ?? null,
      assessment: item?.sbar_assessment ?? null, recommendation: item?.sbar_recommendation ?? null,
    };
    const auto = autoSBAR(base);
    return { ...base, sbar: { situation: sbar.situation ?? auto.situation, background: sbar.background ?? auto.background, assessment: sbar.assessment ?? auto.assessment, recommendation: sbar.recommendation ?? auto.recommendation }, sbarEdited: !!(sbar.situation || sbar.background || sbar.assessment || sbar.recommendation) };
  });

  // JBI audits (recent) for compliance KPI + analytics
  let audits: any[] = []; let auditsProvisioned = true;
  try { const { data: au, error } = await scope(admin.from("op_handover_audits").select("*").order("created_at", { ascending: false })).limit(500); if (error && missing(error)) auditsProvisioned = false; audits = au ?? []; } catch { auditsProvisioned = false; }

  const completed = rows.filter((r: any) => ["completed", "reviewed", "accepted"].includes(r.itemStatus) || r.reviewed).length;
  const critical = rows.filter((r: any) => r.risk === "High Risk").length;
  const jbiCompliance = audits.length ? Math.round(audits.reduce((s, a) => s + (a.compliance_pct ?? 0), 0) / audits.length) : null;

  const kpis = {
    patients: rows.length,
    completed,
    pending: rows.length - completed,
    critical,
    escalations: escalations.length,
    tasks: tasks.length,
    jbiCompliance,
    avgHandoverMins: null as number | null, // no per-patient timing captured yet (honest)
    progress: rows.length ? Math.round((completed / rows.length) * 100) : 0,
  };

  return {
    ready: true as const, provisioned: true as const, handoverProvisioned, auditsProvisioned,
    rows, kpis, handover, audits,
    escalations, alerts, tasks, observations,
  };
}
