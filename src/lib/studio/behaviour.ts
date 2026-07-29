/* eslint-disable @typescript-eslint/no-explicit-any */
// CST-040 Professional Behaviour Assessment — behaviour-indicator designer (cst_behaviour_assessments +
// cst_behaviour_indicators, migration 134). Indicators are observable behaviour statements across the
// professional domains, with positive/negative anchors and a critical flag. Read on demand.

const NONE = "00000000-0000-0000-0000-000000000000";

export const BEHAVIOUR_DOMAINS = [
  { key: "professionalism", label: "Professionalism" }, { key: "communication", label: "Communication" }, { key: "teamwork", label: "Teamwork" },
  { key: "leadership", label: "Leadership" }, { key: "ethics", label: "Ethics" }, { key: "patient_centred", label: "Patient-Centred Care" },
  { key: "cultural", label: "Cultural Competence" }, { key: "accountability", label: "Accountability" },
];
export const DOMAIN_LABEL: Record<string, string> = Object.fromEntries(BEHAVIOUR_DOMAINS.map(d => [d.key, d.label]));
export const BEH_SCALES = [
  { key: "bars", label: "BARS" }, { key: "likert5", label: "5-point Likert" }, { key: "likert3", label: "3-point" }, { key: "binary", label: "Binary" }, { key: "global", label: "Global rating" },
];
export const BEH_SCALE_LABEL: Record<string, string> = Object.fromEntries(BEH_SCALES.map(s => [s.key, s.label]));
export const BEH_STATUS_TONE: Record<string, string> = { draft: "text-gray-500 bg-gray-50 border-gray-200", active: "text-teal-600 bg-teal-50 border-teal-200", archived: "text-gray-400 bg-gray-50 border-gray-200" };

export type Indicator = { id: string; domain: string; domainLabel: string; statement: string; positive: string | null; negative: string | null; critical: boolean };
export type BehaviourAssessment = { id: string; name: string; description: string | null; ratingScale: string; scaleLabel: string; status: string; createdBy: string | null; indicators: Indicator[]; domains: number; critical: number };

export async function loadBehaviour(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.or(`hospital_id.eq.${hid ?? NONE},hospital_id.is.null`));
  const res = await scope(admin.from("cst_behaviour_assessments").select("id, name, description, rating_scale, status, created_by_name, created_at").order("created_at", { ascending: false }).limit(500));
  if (res.error) return { provisioned: false as const };
  const rows = (res.data ?? []) as any[];

  const byAssessment = new Map<string, Indicator[]>();
  if (rows.length) {
    const { data: inds } = await admin.from("cst_behaviour_indicators").select("id, assessment_id, domain, statement, positive_anchor, negative_anchor, is_critical, sort_order").in("assessment_id", rows.map(r => r.id)).order("sort_order").limit(20000);
    for (const i of (inds ?? []) as any[]) { const a = byAssessment.get(i.assessment_id) ?? []; a.push({ id: i.id, domain: i.domain, domainLabel: DOMAIN_LABEL[i.domain] ?? i.domain, statement: i.statement, positive: i.positive_anchor, negative: i.negative_anchor, critical: i.is_critical }); byAssessment.set(i.assessment_id, a); }
  }

  const assessments: BehaviourAssessment[] = rows.map(r => {
    const indicators = byAssessment.get(r.id) ?? [];
    return {
      id: r.id, name: r.name, description: r.description, ratingScale: r.rating_scale, scaleLabel: BEH_SCALE_LABEL[r.rating_scale] ?? r.rating_scale,
      status: r.status, createdBy: r.created_by_name, indicators,
      domains: new Set(indicators.map(i => i.domain)).size, critical: indicators.filter(i => i.critical).length,
    };
  });

  const count = (s: string) => assessments.filter(a => a.status === s).length;
  return {
    provisioned: true as const,
    empty: assessments.length === 0,
    kpis: { total: assessments.length, active: count("active"), draft: count("draft"), indicators: [...byAssessment.values()].reduce((s, a) => s + a.length, 0) },
    assessments,
  };
}
