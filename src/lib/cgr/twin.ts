/* eslint-disable @typescript-eslint/no-explicit-any */
// CGR-024 — Digital Competency Twin (§6 Competency State Model).
//
// DISTINCT FROM COMP-019 readiness-states, which resolves outcome + expiry into one of seven CATEGORICAL states
// and ignores maturity, validation, evidence and risk. Two workers can both read "Ready" there while one holds a
// validated expert decision on a low-risk competency from last month and the other an unvalidated novice
// decision on a CRITICAL competency from 11 months ago. This models the difference:
//
//   Competency State = Current Capability + Evidence Confidence + Recency + Practice Exposure + Risk Factors
//
// Four of those five are computable from real records and are computed here. PRACTICE EXPOSURE is NOT: nothing
// links a worker's shift/patient activity to a specific competency, so it is reported as unavailable rather
// than proxied by something that would look like evidence and isn't. The confidence score says which dimensions
// it is actually built from.
//
// Levels (§4.2): individual twin → team/department twin → organisational twin. No migration.

type Admin = any;
const DAY = 86400000;

// Benner maturity → capability contribution.
const MATURITY: Record<string, number> = { novice: 1, advanced_beginner: 2, competent: 3, proficient: 4, expert: 5, mentor: 5.5, authority: 6 };
// Outcome → capability ceiling (a decision's headline finding).
const OUTCOME_CAP: Record<string, number> = {
  competent: 100, competent_with_conditions: 75, provisionally_competent: 55,
  requires_remediation: 25, not_yet_competent: 15, suspended: 10, expired: 0,
};
const RISK_WEIGHT: Record<string, number> = { critical: 1.6, high: 1.3, standard: 1, low: 0.85 };

export type TwinFactor = { label: string; value: number | null; note: string };

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export async function loadCompetencyTwin(admin: Admin) {
  const [decRes, compRes, profRes, deptRes] = await Promise.all([
    admin.from("competency_decisions").select("nurse_id, competency_id, outcome, maturity, effective_date, expiry_date, validated_at, validation_outcome, evidence_summary, created_at").order("created_at", { ascending: false }).limit(6000),
    admin.from("framework_competencies").select("id, name, risk_category").limit(3000),
    admin.from("profiles").select("id, full_name, department_id").limit(3000),
    admin.from("departments").select("id, name").limit(500),
  ]);

  const decisions = (decRes.error ? [] : decRes.data ?? []) as any[];
  const comps = new Map<string, any>(((compRes.error ? [] : compRes.data ?? []) as any[]).map((x) => [x.id as string, x]));
  const profs = new Map<string, any>(((profRes.error ? [] : profRes.data ?? []) as any[]).map((p) => [p.id as string, p]));
  const depts = new Map<string, string>(((deptRes.error ? [] : deptRes.data ?? []) as any[]).map((d) => [d.id as string, d.name as string]));
  if (!decisions.length) return { provisioned: false as const };

  const now = Date.now();

  // Latest decision per (nurse, competency) — the twin models CURRENT state, not history.
  const latest = new Map<string, any>();
  for (const d of decisions) {
    if (!d.nurse_id || !d.competency_id) continue;
    const k = `${d.nurse_id}|${d.competency_id}`;
    if (!latest.has(k)) latest.set(k, d);   // already ordered newest-first
  }

  type Cell = { nurse: string; competency: string; risk: string; capability: number; confidence: number; recency: number; state: number; validated: boolean; stale: boolean };
  const cells: Cell[] = [];

  for (const d of latest.values()) {
    const comp: any = comps.get(d.competency_id);
    const risk = comp?.risk_category ?? "standard";

    // 1. Current capability — outcome ceiling tempered by Benner maturity.
    const cap = OUTCOME_CAP[d.outcome] ?? 40;
    const mat = d.maturity ? (MATURITY[d.maturity] ?? 3) / 6 : null;
    const capability = mat == null ? cap : clamp(cap * (0.6 + 0.4 * mat));

    // 2. Evidence confidence — was the decision independently validated, and is there evidence behind it?
    const validated = d.validation_outcome === "validated" || !!d.validated_at;
    const hasEvidence = !!(d.evidence_summary && String(d.evidence_summary).trim());
    const confidence = clamp((validated ? 65 : 25) + (hasEvidence ? 35 : 0));

    // 3. Recency — decays over the certification window; expired reads 0.
    const eff = d.effective_date ? new Date(d.effective_date).getTime() : null;
    const exp = d.expiry_date ? new Date(d.expiry_date).getTime() : null;
    let recency: number;
    if (exp && exp < now) recency = 0;
    else if (exp && eff && exp > eff) recency = clamp(((exp - now) / (exp - eff)) * 100);
    else if (eff) recency = clamp(100 - ((now - eff) / DAY / 365) * 40);   // no expiry: ~40 pts/yr decay
    else recency = 50;
    const stale = recency < 35;

    // Composite state, risk-weighted: the same weakness matters more on a critical competency.
    const raw = capability * 0.45 + confidence * 0.3 + recency * 0.25;
    const rw = RISK_WEIGHT[risk] ?? 1;
    const state = clamp(rw > 1 ? 100 - (100 - raw) * rw : raw);

    cells.push({ nurse: d.nurse_id, competency: d.competency_id, risk, capability, confidence, recency, state, validated, stale });
  }

  // ── Individual twins ──
  const byNurse = new Map<string, Cell[]>();
  for (const c of cells) { const a = byNurse.get(c.nurse) ?? []; a.push(c); byNurse.set(c.nurse, a); }
  const individuals = [...byNurse.entries()].map(([id, cs]) => {
    const avg = Math.round(cs.reduce((s, x) => s + x.state, 0) / cs.length);
    const weakest = cs.reduce((w, x) => (x.state < w.state ? x : w), cs[0]);
    const p: any = profs.get(id);
    return {
      id, name: p?.full_name ?? "—",
      department: p?.department_id ? (depts.get(p.department_id) ?? null) : null,
      competencies: cs.length, state: avg,
      unvalidated: cs.filter((x) => !x.validated).length,
      stale: cs.filter((x) => x.stale).length,
      criticalWeak: cs.filter((x) => (x.risk === "critical" || x.risk === "high") && x.state < 60).length,
      weakest: { competency: (comps.get(weakest.competency) as any)?.name ?? "—", state: weakest.state, risk: weakest.risk },
    };
  }).sort((a, b) => a.state - b.state);

  // ── Team / department twins ──
  const byDept = new Map<string, { states: number[]; people: Set<string>; criticalWeak: number; unvalidated: number }>();
  for (const c of cells) {
    const p: any = profs.get(c.nurse);
    const key = p?.department_id ? (depts.get(p.department_id) ?? "Unassigned") : "Unassigned";
    const e = byDept.get(key) ?? { states: [], people: new Set<string>(), criticalWeak: 0, unvalidated: 0 };
    e.states.push(c.state); e.people.add(c.nurse);
    if ((c.risk === "critical" || c.risk === "high") && c.state < 60) e.criticalWeak++;
    if (!c.validated) e.unvalidated++;
    byDept.set(key, e);
  }
  const teams = [...byDept.entries()].map(([name, e]) => ({
    name, people: e.people.size, records: e.states.length,
    state: Math.round(e.states.reduce((a, b) => a + b, 0) / e.states.length),
    criticalWeak: e.criticalWeak, unvalidated: e.unvalidated,
  })).sort((a, b) => a.state - b.state);

  // ── Organisational twin ──
  const all = cells.map((c) => c.state);
  const orgState = Math.round(all.reduce((a, b) => a + b, 0) / all.length);
  const factors: TwinFactor[] = [
    { label: "Current capability", value: Math.round(cells.reduce((s, c) => s + c.capability, 0) / cells.length), note: "decision outcome × Benner maturity" },
    { label: "Evidence confidence", value: Math.round(cells.reduce((s, c) => s + c.confidence, 0) / cells.length), note: "independent validation + evidence recorded" },
    { label: "Recency", value: Math.round(cells.reduce((s, c) => s + c.recency, 0) / cells.length), note: "position in the certification window" },
    { label: "Risk weighting", value: null, note: "applied — critical/high competencies penalised harder" },
    { label: "Practice exposure", value: null, note: "NOT AVAILABLE — no link from shift/patient activity to a specific competency" },
  ];

  return {
    provisioned: true as const,
    orgState,
    factors,
    totals: {
      people: byNurse.size, records: cells.length,
      unvalidated: cells.filter((c) => !c.validated).length,
      stale: cells.filter((c) => c.stale).length,
      criticalWeak: cells.filter((c) => (c.risk === "critical" || c.risk === "high") && c.state < 60).length,
    },
    individuals: individuals.slice(0, 14),
    individualsTotal: individuals.length,
    teams,
  };
}
