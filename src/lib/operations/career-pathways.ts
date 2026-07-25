// Career Pathways & Progression (LDS-004) — the Unit Manager's talent & succession / progression-
// readiness oversight. Its real core is progression READINESS composed from the competency system
// (loadWorkforceReadiness → per-staff currency, credential expiry, dependency risks) against the
// shared career LADDER (engines/career.ts). Real: unit readiness, progression-ready staff, competency
// & credential gaps, readiness distribution, priority career gaps and the staff readiness register.
// Honest next-phase: individual target-role selection, progression plans, applications, qualification
// registry and mentorship assignments — none has a store. Each learner's own career growth is separate.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadWorkforceReadiness, bandOf } from "@/lib/operations/workforce-readiness";
import { LADDER } from "@/lib/engines/career";

const gapType = (title: string) => (/credential/i.test(title) ? "Credential" : /coverage|dependency|competen/i.test(title) ? "Competency" : "Requirement");
const sev = (s: string) => (s === "critical" ? "High" : s === "high" ? "High" : s === "moderate" ? "Medium" : "Low");

export async function loadCareerPathways(admin: any, hid: string | null, isSuper: boolean) {
  const r = await loadWorkforceReadiness(admin, hid, isSuper) as any;
  if (!r.ready) return { ready: false as const };

  const reg: any[] = r.register ?? [];
  const k = r.kpis ?? {};
  const bands = {
    fullyDeployable: reg.filter(s => s.status === "Current").length,
    renewalDue: reg.filter(s => s.status === "Expiring").length,
    awaitingRenewal: reg.filter(s => s.status === "Expired").length,
    awaitingValidation: reg.filter(s => s.status === "None").length,
  };

  const kpis = {
    readiness: r.score ?? 0,
    band: r.score != null ? bandOf(r.score) : "—",
    progressionReady: k.fullyDeployable ?? bands.fullyDeployable,
    requiringDev: k.requiringSupervision ?? (bands.awaitingRenewal + bands.awaitingValidation),
    competencyGaps: (k.noRecord ?? 0) + (k.criticalGaps ?? 0),
    credentialGaps: (k.credentialsExpired ?? 0) + (k.credentialsExpiring ?? 0),
    total: k.total ?? reg.length,
  };

  // Priority career gaps (from the readiness risk panel).
  const gaps = (r.risks ?? []).slice(0, 6).map((x: any) => ({ gap: x.title, type: gapType(x.title), severity: sev(x.severity), detail: x.detail, action: x.action }));

  // Staff readiness register (progression candidates ranked deployable-first).
  const rank: Record<string, number> = { Current: 0, Expiring: 1, Expired: 2, None: 3 };
  const register = [...reg].sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9)).slice(0, 12)
    .map(s => ({ name: s.name, status: s.status, label: s.readiness?.label ?? "—", deployable: !!s.readiness?.deployable }));

  return {
    ready: true as const, provisioned: r.provisioned !== false,
    kpis, bands, gaps, register, ladder: LADDER,
    roleCoverage: r.roleCoverage ?? [],
  };
}
