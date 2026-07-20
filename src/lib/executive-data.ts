// Hospital Executive Workspace data (HEX-001) — an enterprise executive scorecard
// composed from the live workforce, competency, learning and quality data that
// already powers the HR and Quality & Accreditation workspaces. No financial
// tables exist in Competen, so Financial Intelligence stays a connect-when-ready
// surface rather than fabricated numbers. Tenant-scoped by hospital_id.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadHrDashboard } from "./hr-data";
import { loadQualityDashboard } from "./quality-accreditation-data";

const NONE = "00000000-0000-0000-0000-000000000000";

export type ScoreRow = { name: string; score: number | null; detail: string; href: string };
export type RiskRow = { label: string; count: number; severity: "high" | "medium" | "low"; href: string };
export type Initiative = { code: string | null; title: string; status: string; target_date: string | null };

export async function loadExecutiveDashboard(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));

  // Reuse the already-tenant-scoped HR and Quality loaders so the executive
  // numbers reconcile exactly with those workspaces.
  const [hr, quality] = await Promise.all([
    loadHrDashboard(admin, hid, isSuper),
    loadQualityDashboard(admin, hid, isSuper),
  ]);

  const fillRate = hr.positions.establishment ? Math.round((hr.positions.filled / hr.positions.establishment) * 100) : 0;

  // ── Hospital performance scorecard — each row is a live percentage with a
  // drill-through into the workspace that owns it. score=null → no data yet
  // (so it is shown as "—", never counted as 0%).
  const scorecard: ScoreRow[] = [
    { name: "Competency currency", score: hr.competency.total ? hr.competency.coverage : null, detail: `${hr.competency.current}/${hr.competency.total} assessed decisions current`, href: "/competency-office" },
    { name: "Learning compliance", score: hr.learning.total ? hr.learning.compliance : null, detail: `${hr.learning.completed}/${hr.learning.total} mandatory items complete`, href: "/human-resources/learning" },
    { name: "Establishment fill", score: hr.positions.establishment ? fillRate : null, detail: `${hr.positions.filled}/${hr.positions.establishment} positions filled`, href: "/human-resources/planning" },
    { name: "Quality & accreditation", score: quality.accreditationReadiness, detail: quality.accreditationReadiness != null ? `avg audit compliance · ${quality.audits.completed} completed` : "No completed audits yet", href: "/quality-accreditation" },
  ];
  const scored = scorecard.filter((s): s is ScoreRow & { score: number } => s.score != null);
  const readinessIndex = scored.length ? Math.round(scored.reduce((s, x) => s + x.score, 0) / scored.length) : null;

  // ── Risk heat map — open, actionable enterprise risks, each with a severity.
  const compGaps = Math.max(0, hr.competency.total - hr.competency.current);
  // capa.highOrOverdue is the DEDUPLICATED union of critical-priority and overdue
  // open actions — one row, so an action that is both is not counted twice in the
  // riskHigh / riskTotal aggregates below.
  const risk: RiskRow[] = [
    { label: "Critical or overdue corrective actions", count: quality.capa.highOrOverdue, severity: "high", href: "/quality-accreditation" },
    { label: "Open audit findings", count: quality.findings.open, severity: "medium", href: "/quality-accreditation" },
    { label: "Competency decisions lapsed / at risk", count: compGaps, severity: compGaps ? "medium" : "low", href: "/competency-office" },
    { label: "Vacant established positions", count: hr.positions.vacant, severity: hr.positions.vacant ? "medium" : "low", href: "/human-resources/planning" },
  ];
  const riskTotal = risk.reduce((s, r) => s + r.count, 0);
  const riskHigh = risk.filter(r => r.severity === "high").reduce((s, r) => s + r.count, 0);

  // ── Strategic initiative tracker — quality improvement objectives double as
  // the organisation's tracked strategic initiatives.
  const initiatives: Initiative[] = [];
  const initiativeStats = { total: quality.improvements.total, active: quality.improvements.active, completed: quality.improvements.completed };
  try {
    const { data } = await scope(admin.from("improvement_objects").select("code, title, status, target_date").order("created_at", { ascending: false }).limit(50));
    for (const i of data ?? []) initiatives.push({ code: i.code ?? null, title: i.title ?? "Untitled initiative", status: i.status ?? "unknown", target_date: i.target_date ?? null });
  } catch { /* pre-migration */ }

  return { hr, quality, fillRate, scorecard, readinessIndex, risk, riskTotal, riskHigh, initiatives, initiativeStats };
}
