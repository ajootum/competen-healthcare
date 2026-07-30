// Competency Management (UMG-CM) — the Unit Manager's command lens over the unit's competency posture.
// It COMPOSES the real competency system rather than duplicating the Competency Office's org-wide governance:
// loadWorkforceReadiness (role coverage / credential expiries / risk panel over competency_decisions) +
// loadCompetencyValidations (the pending educator-validation queue) + cmo_assignments (the competency
// DELIVERIES the CDP orchestrator/campaigns landed on this unit — closing the author→govern→deliver→consume
// loop at unit level). Everything is real and fail-soft; nothing is fabricated. No migration.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { loadWorkforceReadiness } from "@/lib/operations/workforce-readiness";
import { loadCompetencyValidations } from "@/lib/operations/competency-validations";

const NONE = "00000000-0000-0000-0000-000000000000";
const DONE = ["completed", "exempt"];

export async function loadCompetencyCentre(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const today = new Date().toISOString().slice(0, 10);

  const [wr, val, asgRes] = await Promise.all([
    loadWorkforceReadiness(admin, hid, isSuper).catch(() => ({ ready: false as const })),
    loadCompetencyValidations(admin, hid, isSuper).catch(() => ({ provisioned: false as const })),
    scope(admin.from("cmo_assignments").select("competency, target_label, method, due_date, status, created_at").order("created_at", { ascending: false }).limit(20000)).then((r: any) => r).catch(() => ({ data: [], error: { message: "x" } })),
  ]);

  const readiness: any = wr;
  const validation: any = val;

  // Delivered competency assignments (the CDP output at this unit).
  const asg = (asgRes?.data ?? []) as any[];
  const asgProvisioned = !asgRes?.error;
  const statusCount: Record<string, number> = {};
  for (const a of asg) statusCount[a.status ?? "assigned"] = (statusCount[a.status ?? "assigned"] ?? 0) + 1;
  const deliveredOverdue = asg.filter(a => a.due_date && a.due_date < today && !DONE.includes(a.status)).length;
  const deliveredCompleted = asg.filter(a => DONE.includes(a.status)).length;
  const delivered = {
    total: asg.length,
    completed: deliveredCompleted,
    overdue: deliveredOverdue,
    open: asg.length - deliveredCompleted,
    completionPct: asg.length ? Math.round((deliveredCompleted / asg.length) * 100) : null,
    byStatus: Object.entries(statusCount).map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n),
    recent: asg.slice(0, 8).map(a => ({ competency: a.competency ?? "Competency", target: a.target_label ?? "All staff", method: a.method ?? "rule", due: a.due_date ?? null, status: a.status ?? "assigned", overdue: !!(a.due_date && a.due_date < today && !DONE.includes(a.status)) })),
  };

  const provisioned = readiness.ready === true || validation.provisioned === true || asgProvisioned;

  // KPI ribbon — the six numbers a manager scans first.
  const kpis = {
    coverage: readiness.ready ? (readiness.kpis?.matchScore ?? readiness.score ?? null) : null,
    fullyDeployable: readiness.ready ? (readiness.kpis?.fullyDeployable ?? 0) : 0,
    total: readiness.ready ? (readiness.kpis?.total ?? 0) : 0,
    credentialsExpiring: readiness.ready ? (readiness.kpis?.credentialsExpiring ?? 0) : 0,
    credentialsExpired: readiness.ready ? (readiness.kpis?.credentialsExpired ?? 0) : 0,
    pendingValidations: validation.provisioned ? (validation.kpis?.pending ?? 0) : 0,
    validationsOverdue: validation.provisioned ? (validation.kpis?.overdue ?? 0) : 0,
    deliveredOverdue,
  };

  // Rule-based command insight — safety-prioritised, derived from the real risk panel + KPIs.
  const ai: { tone: string; title: string; detail: string }[] = [];
  const critical = (readiness.risks ?? []).filter((r: any) => r.severity === "critical");
  if (critical.length) ai.push({ tone: "red", title: `${critical.length} competency coverage gap${critical.length === 1 ? "" : "s"} at critical level`, detail: critical[0].detail });
  if (kpis.credentialsExpired) ai.push({ tone: "red", title: `${kpis.credentialsExpired} expired credential${kpis.credentialsExpired === 1 ? "" : "s"} on the unit`, detail: "Expired legally-required credentials block independent deployment — renew before rostering." });
  if (kpis.deliveredOverdue) ai.push({ tone: "amber", title: `${kpis.deliveredOverdue} delivered competency assignment${kpis.deliveredOverdue === 1 ? "" : "s"} overdue`, detail: "Learners have passed their due date on assignments the delivery engine scheduled — follow up or reassign." });
  if (kpis.validationsOverdue) ai.push({ tone: "amber", title: `${kpis.validationsOverdue} validation${kpis.validationsOverdue === 1 ? "" : "s"} overdue`, detail: "Passing evidence is waiting on educator sign-off past the cycle end date." });
  if (kpis.credentialsExpiring) ai.push({ tone: "gray", title: `${kpis.credentialsExpiring} credential${kpis.credentialsExpiring === 1 ? "" : "s"} expiring within 30 days`, detail: "Schedule renewals now to keep the roster fully deployable." });
  if (!ai.length && provisioned) ai.push({ tone: "green", title: "Unit competency posture is stable", detail: "No critical coverage gaps, expired credentials or overdue deliveries right now." });

  return {
    provisioned,
    kpis,
    readiness,           // score/band/roleCoverage/risks/register/expiringStaff/expiredStaff
    validation,          // kpis/queue (pending validation summary)
    delivered,           // cmo_assignments summary (CDP output)
    deliveredProvisioned: asgProvisioned,
    ai,
  };
}

// ── Expiries & Recertification pipeline ──────────────────────────────────────
// A dated recert pipeline over the two real expiry sources: professional_credentials (has hospital_id) and
// competency_decisions (no hospital_id → scoped via the unit's nurse profiles). Buckets by timeframe so the
// manager can see what lapses when. Read-only; renewals happen through the credentialing / assessment surfaces.
const BUCKET = (days: number) => (days < 0 ? "Expired" : days <= 30 ? "≤ 30 days" : days <= 60 ? "≤ 60 days" : "≤ 90 days");
const BUCKET_ORDER = ["Expired", "≤ 30 days", "≤ 60 days", "≤ 90 days"];

export async function loadRecertPipeline(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const today = new Date(); const todayStr = today.toISOString().slice(0, 10);
  const h90 = new Date(today.getTime() + 90 * 864e5).toISOString().slice(0, 10);
  const daysOut = (d: string) => Math.round((new Date(d + "T00:00:00").getTime() - new Date(todayStr + "T00:00:00").getTime()) / 864e5);

  // Unit nurse set — used to scope the un-scopable competency_decisions.
  let nurseIds: string[] | null = null;
  const nurseName = new Map<string, { name: string; role: string | null }>();
  if (!isSuper) {
    const { data: profs } = await admin.from("profiles").select("id, full_name, role").eq("hospital_id", hid ?? NONE).limit(20000);
    nurseIds = (profs ?? []).map((p: any) => { nurseName.set(p.id, { name: p.full_name ?? "—", role: p.role ?? null }); return p.id; });
  }

  const credProbe = await scope(admin.from("professional_credentials").select("id, nurse_id, title, credential_type, expiry_date, status").not("expiry_date", "is", null).neq("status", "revoked").lte("expiry_date", h90).order("expiry_date").limit(8000));
  if (credProbe.error) return { provisioned: false as const };
  const creds = (credProbe.data ?? []) as any[];

  let decQ = admin.from("competency_decisions").select("nurse_id, competency_id, outcome, expiry_date").not("expiry_date", "is", null).lte("expiry_date", h90).order("expiry_date").limit(20000);
  if (nurseIds) decQ = decQ.in("nurse_id", nurseIds.length ? nurseIds.slice(0, 3000) : [NONE]);
  const { data: decs } = await decQ;
  const decisions = (decs ?? []) as any[];

  // Resolve names not already known (super scope, or credential nurses).
  const needNurse = [...new Set([...creds, ...decisions].map(x => x.nurse_id).filter((id: string) => id && !nurseName.has(id)))] as string[];
  if (needNurse.length) { const { data } = await admin.from("profiles").select("id, full_name, role").in("id", needNurse.slice(0, 3000)); (data ?? []).forEach((p: any) => nurseName.set(p.id, { name: p.full_name ?? "—", role: p.role ?? null })); }
  const compIds = [...new Set(decisions.map(d => d.competency_id).filter(Boolean))] as string[];
  const compName = new Map<string, string>();
  if (compIds.length) { const { data } = await admin.from("framework_competencies").select("id, name").in("id", compIds.slice(0, 3000)); (data ?? []).forEach((c: any) => compName.set(c.id, c.name)); }

  type Item = { kind: string; person: string; role: string | null; label: string; expiry: string; days: number; bucket: string };
  const items: Item[] = [];
  for (const c of creds) { const d = daysOut(c.expiry_date); items.push({ kind: "Credential", person: nurseName.get(c.nurse_id)?.name ?? "—", role: nurseName.get(c.nurse_id)?.role ?? null, label: c.title || c.credential_type?.replace(/_/g, " ") || "Credential", expiry: c.expiry_date, days: d, bucket: BUCKET(d) }); }
  for (const d of decisions) { const dd = daysOut(d.expiry_date); items.push({ kind: "Competency", person: nurseName.get(d.nurse_id)?.name ?? "—", role: nurseName.get(d.nurse_id)?.role ?? null, label: compName.get(d.competency_id) ?? "Competency", expiry: d.expiry_date, days: dd, bucket: BUCKET(dd) }); }
  items.sort((a, b) => a.days - b.days);

  const bucketCount = (b: string) => items.filter(i => i.bucket === b).length;
  return {
    provisioned: true as const,
    kpis: { total: items.length, expired: bucketCount("Expired"), in30: bucketCount("≤ 30 days"), credentials: creds.length, competencies: decisions.length },
    buckets: BUCKET_ORDER.map(label => ({ label, items: items.filter(i => i.bucket === label) })).filter(b => b.items.length),
    items: items.slice(0, 200),
  };
}

// ── Delivered competency assignments (CDP output at the unit) ─────────────────
export async function loadDeliveredAssignments(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const res = await scope(admin.from("cmo_assignments").select("id, competency, target_type, target_label, method, campaign, due_date, status, created_at").order("created_at", { ascending: false }).limit(20000));
  if (res.error) return { provisioned: false as const };
  const today = new Date().toISOString().slice(0, 10);
  const rows = (res.data ?? []).map((a: any) => ({ ...a, isOverdue: !!(a.due_date && a.due_date < today && !DONE.includes(a.status)) }));

  const grp = (key: string, src: any[] = rows) => { const m: Record<string, number> = {}; for (const r of src) { const k = r[key] ?? "—"; m[k] = (m[k] ?? 0) + 1; } return Object.entries(m).map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n); };
  const completed = rows.filter((r: any) => DONE.includes(r.status)).length;
  const topComp = grp("competency").slice(0, 8);
  return {
    provisioned: true as const,
    kpis: { total: rows.length, completed, overdue: rows.filter((r: any) => r.isOverdue).length, open: rows.length - completed, completionPct: rows.length ? Math.round((completed / rows.length) * 100) : null },
    byMethod: grp("method"), byStatus: grp("status"), topCompetencies: topComp,
    rows: rows.slice(0, 300),
  };
}
