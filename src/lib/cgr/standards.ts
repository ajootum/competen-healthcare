/* eslint-disable @typescript-eslint/no-explicit-any */
// CGR-002 — Regulatory Intelligence & Standards Mapping Engine.
// The intelligence/read layer over the competency↔standard mapping store (authoring lives in Studio). It turns
// the raw competency_standard_mappings (mig 129) into the three things the spec asks for — all from real data:
//   • Standards Library (§4.1/§12) — the distinct standard clauses actually in use (body + ref + title), each
//     with how many competencies it covers and the coverage quality.
//   • Compliance Gap Detection (§4.3/§12) — competencies with NO mapping (regulatory gaps) and those mapped only
//     weakly (partial/reference, no 'full'), prioritised by clinical risk, plus coverage-by-clinical-domain.
//   • Coverage KPIs (§13) — % of competencies mapped, full-coverage %, standards/bodies in use, and the
//     accreditation-risk signal (unmapped high/critical-risk competencies).
// Composes the CGR-001 registry (for the competency side: risk, domain, coverage) + one direct mappings query.
// No migration.

import { loadGovernanceRegistry, type GovRecord } from "@/lib/cgr/registry";

type Admin = any;
const RISK_W: Record<string, number> = { critical: 4, high: 3, standard: 2, low: 1 };

export type StdEntry = { body: string; ref: string; title: string | null; competencies: number; mappings: number; full: number; partial: number; reference: number };
export type BodyEntry = { body: string; standards: number; competencies: number };
export type DomainGap = { domain: string; total: number; mapped: number; unmapped: number; pct: number };

export async function loadRegulatoryIntelligence(admin: Admin) {
  const reg = await loadGovernanceRegistry(admin);

  const { data: sm } = await admin
    .from("competency_standard_mappings")
    .select("competency_id, standard_body, standard_ref, standard_title, coverage")
    .limit(8000);

  // Standards Library — one row per distinct standard clause (body + ref).
  const stdMap = new Map<string, { body: string; ref: string; title: string | null; comps: Set<string>; mappings: number; full: number; partial: number; reference: number }>();
  const bodyMap = new Map<string, { standards: Set<string>; comps: Set<string> }>();
  for (const m of sm ?? []) {
    const body = m.standard_body || "other";
    const ref = m.standard_ref || "—";
    const key = `${body}|${ref}`;
    const e = stdMap.get(key) ?? { body, ref, title: m.standard_title ?? null, comps: new Set<string>(), mappings: 0, full: 0, partial: 0, reference: 0 };
    if (!e.title && m.standard_title) e.title = m.standard_title;
    e.comps.add(m.competency_id);
    e.mappings++;
    if (m.coverage === "full") e.full++;
    else if (m.coverage === "partial") e.partial++;
    else e.reference++;
    stdMap.set(key, e);

    const b = bodyMap.get(body) ?? { standards: new Set<string>(), comps: new Set<string>() };
    b.standards.add(ref);
    b.comps.add(m.competency_id);
    bodyMap.set(body, b);
  }
  const standards: StdEntry[] = [...stdMap.values()]
    .map((e) => ({ body: e.body, ref: e.ref, title: e.title, competencies: e.comps.size, mappings: e.mappings, full: e.full, partial: e.partial, reference: e.reference }))
    .sort((a, b) => a.body.localeCompare(b.body) || b.competencies - a.competencies);
  const bodies: BodyEntry[] = [...bodyMap.entries()]
    .map(([body, e]) => ({ body, standards: e.standards.size, competencies: e.comps.size }))
    .sort((a, b) => b.competencies - a.competencies);

  // Compliance gap detection — from the competency side.
  const recs: GovRecord[] = reg.provisioned ? reg.records : [];
  const n = recs.length;
  const byRisk = (a: GovRecord, b: GovRecord) => RISK_W[b.risk] - RISK_W[a.risk] || a.name.localeCompare(b.name);

  const unmappedAll = recs.filter((r) => r.standards === 0).sort(byRisk);
  const weakAll = recs.filter((r) => r.standards > 0 && r.standardsFull === 0).sort(byRisk); // partial/reference only
  const mapped = n - unmappedAll.length;
  const fullCovered = recs.filter((r) => r.standardsFull > 0).length;
  const unmappedHighRisk = unmappedAll.filter((r) => r.risk === "high" || r.risk === "critical").length;

  // Coverage by clinical domain — worst coverage first.
  const domMap = new Map<string, { total: number; mapped: number }>();
  for (const r of recs) {
    const d = r.domain || "Ungrouped";
    const e = domMap.get(d) ?? { total: 0, mapped: 0 };
    e.total++;
    if (r.standards > 0) e.mapped++;
    domMap.set(d, e);
  }
  const domainGaps: DomainGap[] = [...domMap.entries()]
    .map(([domain, e]) => ({ domain, total: e.total, mapped: e.mapped, unmapped: e.total - e.mapped, pct: e.total ? Math.round((e.mapped / e.total) * 100) : 0 }))
    .sort((a, b) => a.pct - b.pct || b.unmapped - a.unmapped);

  return {
    provisioned: reg.provisioned,
    totalComps: reg.total,
    analysed: n,
    capped: reg.capped,
    kpis: {
      mappedPct: n ? Math.round((mapped / n) * 100) : 0,
      fullCoveredPct: n ? Math.round((fullCovered / n) * 100) : 0,
      standards: standards.length,
      bodies: bodies.length,
      mappings: (sm ?? []).length,
      unmapped: unmappedAll.length,
      weak: weakAll.length,
      unmappedHighRisk,
    },
    standards,
    bodies,
    unmapped: unmappedAll.slice(0, 14),
    weak: weakAll.slice(0, 8),
    domainGaps,
  };
}
