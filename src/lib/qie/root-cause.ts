/* eslint-disable @typescript-eslint/no-explicit-any */
// QIE-005 — Root Cause & Causal Intelligence.
//
// The engine the QIE-000 inventory found genuinely missing: incidents are recorded, closed, and never
// analysed, because until migration 180 there was nowhere to put an analysis.
//
// THE NUMBER THIS MODULE EXISTS TO MOVE is the analysis rate -- what share of incidents worth
// investigating actually were. It is computed from real rows on both sides and will read 0% until someone
// opens the first investigation, which is the honest starting position and better than an empty page that
// implies the capability is unused rather than new.

export const RCA_CATEGORIES = ["people", "process", "equipment", "environment", "measurement", "materials", "communication", "management"] as const;
export type RcaCategory = typeof RCA_CATEGORIES[number];

export const CATEGORY_LABEL: Record<RcaCategory, string> = {
  people: "People", process: "Process", equipment: "Equipment", environment: "Environment",
  measurement: "Measurement", materials: "Materials", communication: "Communication", management: "Management",
};

export type RcaFactor = {
  id: string; investigation_id: string; category: RcaCategory; description: string;
  is_root_cause: boolean; impact_rank: number | null; evidence_note: string | null;
};

export type RcaInvestigation = {
  id: string; hospital_id: string | null; incident_id: string | null; capa_action_id: string | null;
  title: string; status: string; method: string; whys: string[];
  root_cause_summary: string | null; confidence: string | null;
  opened_by_name: string | null; opened_at: string; completed_at: string | null;
  factors: RcaFactor[];
  incident?: { incident_type: string | null; severity: string | null; description: string | null } | null;
};

export type RootCauseView = {
  ready: boolean;
  reason?: string;
  investigations: RcaInvestigation[];
  /** incidents with no investigation — the backlog this engine exists to clear */
  unanalysed: { id: string; incident_type: string | null; severity: string | null; description: string | null; created_at: string }[];
  stats: {
    incidents: number; investigated: number; open: number; completed: number;
    analysisRate: number | null;          // null when there are no incidents at all, never a fake 0
    factorsByCategory: { category: RcaCategory; label: string; total: number; root: number }[];
    linkedToCapa: number;
  };
};

const NONE = "00000000-0000-0000-0000-000000000000";

export async function loadRootCause(admin: any, hospitalId: string | null, isSuper: boolean): Promise<RootCauseView> {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hospitalId ?? NONE));

  // Existence is probed with a plain select, never head+count: PostgREST answers head on a MISSING table
  // with 204/no-error/null, so a head-based check cannot tell "not migrated yet" from "no rows". That
  // exact confusion produced a wrong QIE-000 catalogue entry before the harness caught it.
  const probe = await admin.from("rca_investigations").select("id").limit(1);
  if (probe.error) {
    return {
      ready: false, reason: "rca_investigations is not deployed — apply migration 180.",
      investigations: [], unanalysed: [],
      stats: { incidents: 0, investigated: 0, open: 0, completed: 0, analysisRate: null, factorsByCategory: [], linkedToCapa: 0 },
    };
  }

  const [invRes, incRes] = await Promise.all([
    scope(admin.from("rca_investigations")
      .select("*, op_incidents!incident_id(incident_type, severity, description)")
      .order("opened_at", { ascending: false }).limit(200)),
    scope(admin.from("op_incidents").select("id, incident_type, severity, description, created_at")
      .order("created_at", { ascending: false }).limit(500)),
  ]);

  const invRows = ((invRes as any).data ?? []) as any[];
  const incidents = ((incRes as any).data ?? []) as any[];

  const factorRes = invRows.length
    ? await admin.from("rca_factors").select("*").in("investigation_id", invRows.map(i => i.id)).order("impact_rank", { nullsFirst: false })
    : { data: [] as any[] };
  const byInv = new Map<string, RcaFactor[]>();
  for (const f of ((factorRes as any).data ?? []) as RcaFactor[]) {
    if (!byInv.has(f.investigation_id)) byInv.set(f.investigation_id, []);
    byInv.get(f.investigation_id)!.push(f);
  }

  const investigations: RcaInvestigation[] = invRows.map(r => ({
    ...r,
    whys: Array.isArray(r.whys) ? r.whys : [],
    factors: byInv.get(r.id) ?? [],
    incident: r.op_incidents ?? null,
  }));

  const investigatedIds = new Set(invRows.map(r => r.incident_id).filter(Boolean));
  const unanalysed = incidents.filter(i => !investigatedIds.has(i.id));

  const counts = new Map<RcaCategory, { total: number; root: number }>();
  for (const c of RCA_CATEGORIES) counts.set(c, { total: 0, root: 0 });
  for (const fs of byInv.values()) for (const f of fs) {
    const c = counts.get(f.category as RcaCategory);
    if (!c) continue;                                  // a category the DB allows and this build does not
    c.total++; if (f.is_root_cause) c.root++;
  }

  return {
    ready: true,
    investigations,
    unanalysed,
    stats: {
      incidents: incidents.length,
      investigated: investigatedIds.size,
      open: invRows.filter(r => ["open", "in_progress"].includes(r.status)).length,
      completed: invRows.filter(r => ["completed", "closed"].includes(r.status)).length,
      // Null, not 0, when there is nothing to divide by -- "no incidents" and "none analysed" are
      // different facts and a 0% on an empty denominator is the confident zero this codebase keeps finding.
      analysisRate: incidents.length ? Math.round((investigatedIds.size / incidents.length) * 100) : null,
      factorsByCategory: RCA_CATEGORIES.map(c => ({ category: c, label: CATEGORY_LABEL[c], ...counts.get(c)! })),
      linkedToCapa: invRows.filter(r => r.capa_action_id).length,
    },
  };
}
