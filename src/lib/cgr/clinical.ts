/* eslint-disable @typescript-eslint/no-explicit-any */
// CGR-026 — Clinical Practice Intelligence & Outcome Correlation.
//
// "Are our competency systems improving clinical practice and patient outcomes?" Two DIFFERENT lenses answer
// that, and this page holds both without conflating them:
//
//   • STATISTICAL lens (§5.1) — the ecological competency↔outcome correlation. OWNED by CAPM-005
//     (loadOutcomeCorrelation); its headline is embedded here with credit, never rebuilt. Directional, not causal.
//   • CASE lens (§5.2, the genuinely-new part) — which competencies are implicated by REAL safety events,
//     through the governance-confirmed competency_learning_links (migration 150 — literally the "Competency
//     Outcome Link" object §11 of this spec names, built three commits ago). Joined to incident severity and to
//     the CGR-001 registry record, so "implicated by events AND weakly governed" surfaces as practice risk.
//     Per §4.4 (improvement, not blame) aggregation is by COMPETENCY and unit — never by person.
//
// Plus §5.3 practice variation (incident burden per department via incident→patient→department, merged with the
// CGR-024 team twin state) and a §5.4 M&M learning card (mm_cases lifecycle). Proposed links are candidates;
// only confirmed/implemented links are treated as evidence. No migration.

import { loadGovernanceRegistry } from "@/lib/cgr/registry";
import { loadCompetencyTwin } from "@/lib/cgr/twin";
import { loadOutcomeCorrelation } from "@/lib/performance/outcome-correlation";

type Admin = any;

export async function loadClinicalIntelligence(admin: Admin, hospitalId: string | null, isSuper: boolean) {
  const [reg, twin, corr, linkRes, incRes, patRes, deptRes, mmRes] = await Promise.all([
    loadGovernanceRegistry(admin).catch(() => ({ provisioned: false } as any)),
    loadCompetencyTwin(admin).catch(() => ({ provisioned: false } as any)),
    loadOutcomeCorrelation(admin, hospitalId, isSuper).catch(() => ({ provisioned: false } as any)),
    admin.from("competency_learning_links").select("source_id, target_id, target_name, link_type, status, proposed_by_ai").eq("source_type", "incident").eq("target_type", "competency").limit(2000),
    admin.from("op_incidents").select("id, incident_type, severity, near_miss, patient_id").limit(5000),
    admin.from("op_patients").select("id, department_id").limit(5000),
    admin.from("departments").select("id, name").limit(500),
    admin.from("mm_cases").select("status, case_type").limit(2000),
  ]);

  const links = (linkRes.error ? [] : linkRes.data ?? []) as any[];
  const incidents = (incRes.error ? [] : incRes.data ?? []) as any[];
  const incById = new Map<string, any>(incidents.map((i) => [i.id as string, i]));
  const patDept = new Map<string, string | null>(((patRes.error ? [] : patRes.data ?? []) as any[]).map((p) => [p.id as string, (p.department_id as string | null) ?? null]));
  const deptName = new Map<string, string>(((deptRes.error ? [] : deptRes.data ?? []) as any[]).map((d) => [d.id as string, d.name as string]));
  const regRecs = new Map<string, any>(((reg?.provisioned ? reg.records : []) as any[]).map((r) => [r.id as string, r]));

  // ── Case lens: competencies implicated by real safety events ──
  type Impl = { id: string; name: string; events: Set<string>; highCritical: number; nearMiss: number; confirmed: number; proposed: number; implemented: number; byAi: number };
  const implMap = new Map<string, Impl>();
  for (const l of links) {
    if (l.status === "rejected" || !l.target_id) continue;
    const e = implMap.get(l.target_id) ?? { id: l.target_id, name: l.target_name ?? "—", events: new Set<string>(), highCritical: 0, nearMiss: 0, confirmed: 0, proposed: 0, implemented: 0, byAi: 0 };
    const inc = l.source_id ? incById.get(l.source_id) : null;
    if (l.source_id) e.events.add(l.source_id);
    if (inc && ["high", "critical"].includes(inc.severity)) e.highCritical++;
    if (inc?.near_miss) e.nearMiss++;
    if (l.status === "implemented") e.implemented++;
    else if (l.status === "confirmed") e.confirmed++;
    else e.proposed++;
    if (l.proposed_by_ai) e.byAi++;
    implMap.set(l.target_id, e);
  }
  const implicated = [...implMap.values()]
    .map((e) => {
      const r = regRecs.get(e.id);
      const weakGov = r ? r.score < 60 || r.state === "at_risk" || r.state === "ungoverned" : false;
      const evidenced = e.confirmed + e.implemented;
      return {
        id: e.id, name: r?.name ?? e.name, events: e.events.size,
        highCritical: e.highCritical, nearMiss: e.nearMiss,
        confirmed: e.confirmed, implemented: e.implemented, proposed: e.proposed, byAi: e.byAi,
        risk: r?.risk ?? null, govScore: r?.score ?? null, govState: r?.state ?? null,
        practiceRisk: (evidenced > 0 || e.events.size >= 2) && weakGov,
      };
    })
    .sort((a, b) => (b.confirmed + b.implemented) - (a.confirmed + a.implemented) || b.highCritical - a.highCritical || b.events - a.events);

  const evidencedLinks = links.filter((l) => l.status === "confirmed" || l.status === "implemented").length;
  const proposedLinks = links.filter((l) => l.status === "proposed").length;

  // ── §5.3 practice variation: incident burden per department (via patient) vs the team twin state ──
  const burden = new Map<string, { events: number; highCritical: number; nearMiss: number }>();
  let unattributed = 0;
  for (const i of incidents) {
    const deptId = i.patient_id ? patDept.get(i.patient_id) ?? null : null;
    const name = deptId ? deptName.get(deptId) ?? null : null;
    if (!name) { unattributed++; continue; }
    const e = burden.get(name) ?? { events: 0, highCritical: 0, nearMiss: 0 };
    e.events++;
    if (["high", "critical"].includes(i.severity)) e.highCritical++;
    if (i.near_miss) e.nearMiss++;
    burden.set(name, e);
  }
  const teamState = new Map<string, number>(((twin?.provisioned ? twin.teams : []) as any[]).map((t) => [t.name as string, t.state as number]));
  const variation = [...new Set([...burden.keys(), ...teamState.keys()])]
    .filter((n) => n !== "Unassigned")
    .map((name) => ({ name, ...(burden.get(name) ?? { events: 0, highCritical: 0, nearMiss: 0 }), twinState: teamState.get(name) ?? null }))
    .sort((a, b) => b.highCritical - a.highCritical || b.events - a.events);
  const burdens = variation.filter((v) => v.events > 0).map((v) => v.events);
  const variationSpread = burdens.length >= 2 ? Math.max(...burdens) - Math.min(...burdens) : null;

  // ── §5.4 M&M learning ──
  const mm = (mmRes.error ? [] : mmRes.data ?? []) as any[];
  const mmClosed = mm.filter((c) => c.status === "closed").length;

  // ── §5.1 statistical lens headline (CAPM-005, embedded with credit) ──
  const hasCorr = corr?.provisioned && !corr?.empty && !corr?.insufficient;

  return {
    provisioned: links.length > 0 || incidents.length > 0 || (reg?.provisioned ?? false),
    kpis: {
      linkedEvents: new Set(links.filter((l) => l.source_id && l.status !== "rejected").map((l) => l.source_id)).size,
      totalIncidents: incidents.length,
      evidencedLinks, proposedLinks,
      implicated: implicated.length,
      practiceRisk: implicated.filter((x) => x.practiceRisk).length,
      variationDepts: variation.filter((v) => v.events > 0).length,
      unattributed,
    },
    implicated: implicated.slice(0, 12),
    variation: variation.slice(0, 12),
    variationSpread,
    mm: { ready: !mmRes.error, total: mm.length, closed: mmClosed, mortality: mm.filter((c) => c.case_type === "mortality").length, morbidity: mm.filter((c) => c.case_type === "morbidity").length },
    corr: hasCorr
      ? { compliance: corr.complianceCorr, escalation: corr.escalationCorr, departments: corr.kpis.departments }
      : null,
    // §8 loop with live counts — gap → risk → event → learning → improvement.
    loop: [
      { step: "Competency gap", n: reg?.provisioned ? reg.states.at_risk + reg.states.ungoverned : 0, note: "at-risk / ungoverned (registry)" },
      { step: "Practice risk", n: implicated.filter((x) => x.practiceRisk).length, note: "implicated + weakly governed" },
      { step: "Quality event", n: incidents.length, note: "safety events captured" },
      { step: "Learning response", n: links.filter((l) => l.status !== "rejected").length, note: "event→competency links" },
      { step: "Competency improvement", n: links.filter((l) => l.status === "implemented").length, note: "links implemented" },
    ],
  };
}
