// HEX Reports & Board Papers — executive reporting over report_definitions + report_schedules (035),
// plus a live board-pack snapshot composed from the executive scorecard. PDF/PPT export and formal
// board-pack assembly are next-phase; the data those reports would carry is already live here.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadExecutiveDashboard } from "@/lib/executive-data";

const NONE = "00000000-0000-0000-0000-000000000000";

export async function loadExecReports(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));

  let definitions: any[] = [], schedules: any[] = [];
  try { const { data } = await scope(admin.from("report_definitions").select("name, dataset, created_by_name, created_at").order("created_at", { ascending: false }).limit(200)); definitions = (data ?? []) as any[]; } catch { /* optional */ }
  try { const { data } = await scope(admin.from("report_schedules").select("name, dataset, frequency, active, next_run_at, last_run_at, last_status").order("next_run_at").limit(200)); schedules = (data ?? []) as any[]; } catch { /* optional */ }

  const d = await loadExecutiveDashboard(admin, hid, isSuper);
  const datasets = [...new Set([...definitions.map(x => x.dataset), ...schedules.map(x => x.dataset)].filter(Boolean))];

  // Board-pack snapshot — the headline metrics a board pack would carry, live.
  const boardPack = [
    { label: "Organisational readiness", value: d.readinessIndex != null ? `${d.readinessIndex}%` : "—" },
    { label: "Quality compliance", value: d.quality.complianceScore != null ? `${d.quality.complianceScore}%` : "—" },
    { label: "Critical quality findings", value: d.quality.findings.critical },
    { label: "Open corrective actions", value: `${d.quality.capa.open} (${d.quality.capa.overdue} overdue)` },
    { label: "Total workforce", value: d.hr.headcount.total },
    { label: "Establishment fill", value: `${d.fillRate}%` },
    { label: "Vacancies", value: d.hr.positions.vacant },
    { label: "High-severity risk items", value: d.riskHigh },
  ];

  return {
    provisioned: true as const,
    kpis: {
      definitions: definitions.length, scheduled: schedules.filter(s => s.active).length,
      datasets: datasets.length, lastRun: schedules.map(s => s.last_run_at).filter(Boolean).sort().at(-1) ?? null,
    },
    definitions: definitions.slice(0, 8).map(r => ({ name: r.name, dataset: r.dataset, by: r.created_by_name })),
    schedules: schedules.slice(0, 8).map(s => ({ name: s.name, dataset: s.dataset, frequency: s.frequency, active: s.active, next: s.next_run_at, status: s.last_status })),
    boardPack,
    hasReports: definitions.length + schedules.length > 0,
  };
}
