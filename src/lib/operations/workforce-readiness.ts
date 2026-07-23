// Workforce Development & Readiness (UMW-WFM-007) loader — whether the unit workforce is
// competent, credentialed, current and developmentally supported to deliver services safely.
// Its real core is COMPETENCY READINESS, composed from the Competency system (competency_
// decisions via loadCompetencyMatching): per-staff currency, role coverage and credential expiry.
// The §41 non-integrated implementation. Mandatory learning, orientation, supervision plans,
// development plans and succession need dedicated stores → honest next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadCompetencyMatching } from "@/lib/operations/competency-matching";

// §10.2 readiness statuses derived from competency currency
export const READY_STATUS: Record<string, { label: string; tone: string; deployable: boolean }> = {
  Current: { label: "Fully deployable", tone: "bg-emerald-50 text-emerald-700", deployable: true },
  Expiring: { label: "Deployable · renewal due", tone: "bg-amber-50 text-amber-700", deployable: true },
  Expired: { label: "Awaiting credential renewal", tone: "bg-rose-50 text-rose-700", deployable: false },
  None: { label: "Awaiting competency validation", tone: "bg-gray-100 text-gray-500", deployable: false },
};
// §8.1A readiness bands
export const bandOf = (s: number) => (s >= 90 ? "Ready" : s >= 75 ? "Mostly ready" : s >= 60 ? "At risk" : s >= 40 ? "High risk" : "Critical");

export async function loadWorkforceReadiness(admin: any, hid: string | null, isSuper: boolean) {
  const cm = await loadCompetencyMatching(admin, hid, isSuper) as any;
  if (!cm.ready) return { ready: false as const };
  const staffPool: any[] = cm.staff ?? [];
  const total = staffPool.length;

  const register = staffPool.map(s => ({ ...s, readiness: READY_STATUS[s.status] ?? READY_STATUS.None })).sort((a, b) => a.name.localeCompare(b.name));
  const fullyDeployable = register.filter(s => s.status === "Current").length;
  const renewalDue = register.filter(s => s.status === "Expiring").length;
  const requiringSupervision = register.filter(s => ["Expired", "None"].includes(s.status)).length;
  const score = total ? Math.round((fullyDeployable / total) * 100) : null;

  const roleCoverage = cm.roleCoverage ?? [];
  // Dependency analysis (§12.3) — no coverage / single-person dependency
  const noCoverage = roleCoverage.filter((r: any) => r.current === 0);
  const singleDep = roleCoverage.filter((r: any) => r.current === 1);
  const criticalGaps = noCoverage.length + singleDep.length;

  // Readiness risk panel (§9) — derived, safety-prioritised
  const risks: { title: string; detail: string; severity: string; action: string }[] = [];
  noCoverage.forEach((r: any) => risks.push({ title: `No validated coverage: ${r.label}`, detail: `0 of ${r.total} ${r.label.toLowerCase()} currently competent`, severity: "critical", action: "Assign learning / request assessment" }));
  singleDep.forEach((r: any) => risks.push({ title: `Single-person dependency: ${r.label}`, detail: `Only 1 competent ${r.label.toLowerCase()} — reduce concentration`, severity: "high", action: "Cross-train a second staff member" }));
  if (cm.kpis?.expiredCerts) risks.push({ title: `${cm.kpis.expiredCerts} expired credential(s)`, detail: "Expired legally-required credentials block independent deployment (BR-WDR-004)", severity: "high", action: "Renew credential" });
  if (cm.kpis?.expiringCerts) risks.push({ title: `${cm.kpis.expiringCerts} credential(s) expiring ≤30d`, detail: "Schedule renewal before expiry", severity: "moderate", action: "Renew credential" });
  if (cm.kpis?.noneCount) risks.push({ title: `${cm.kpis.noneCount} staff with no competency record`, detail: "Missing evidence ≠ incompetent (BR-WDR-006) — validate", severity: "moderate", action: "Request assessment" });
  const RANK: Record<string, number> = { critical: 0, high: 1, moderate: 2 };
  risks.sort((a, b) => RANK[a.severity] - RANK[b.severity]);

  return {
    ready: true as const, provisioned: cm.provisioned !== false,
    score, band: score != null ? bandOf(score) : "—",
    kpis: {
      fullyDeployable, renewalDue, requiringSupervision, criticalGaps,
      credentialsExpiring: cm.kpis?.expiringCerts ?? 0, credentialsExpired: cm.kpis?.expiredCerts ?? 0,
      noRecord: cm.kpis?.noneCount ?? 0, total, matchScore: cm.kpis?.currentPct ?? null,
    },
    register, roleCoverage, skillMix: cm.skillMix ?? [], noCoverage, singleDep, risks,
    expiringStaff: cm.expiringStaff ?? [], expiredStaff: cm.expiredStaff ?? [],
  };
}
