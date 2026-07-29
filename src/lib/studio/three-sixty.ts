/* eslint-disable @typescript-eslint/no-explicit-any */
// CST-041 360° Assessment Designer — multisource feedback templates (cst_360_assessments +
// cst_360_respondent_groups, migration 133). Each assessment configures a rating scale, confidentiality
// (anonymous + minimum raters) and a set of weighted respondent groups that should sum to 100%. The
// weight balance is validated on read. All real, read on demand.

const NONE = "00000000-0000-0000-0000-000000000000";

export const RATER_GROUPS = [
  { key: "self", label: "Self" }, { key: "peer", label: "Peer" }, { key: "supervisor", label: "Supervisor" },
  { key: "subordinate", label: "Direct Reports" }, { key: "team", label: "Team" }, { key: "patient", label: "Patient" },
  { key: "family", label: "Family" }, { key: "external", label: "External" },
];
export const GROUP_LABEL: Record<string, string> = Object.fromEntries(RATER_GROUPS.map(g => [g.key, g.label]));
export const SCALES = [
  { key: "likert5", label: "5-point Likert" }, { key: "likert3", label: "3-point" }, { key: "bars", label: "BARS" }, { key: "global", label: "Global rating" }, { key: "binary", label: "Binary" },
];
export const SCALE_LABEL: Record<string, string> = Object.fromEntries(SCALES.map(s => [s.key, s.label]));
export const STATUS_TONE_360: Record<string, string> = { draft: "text-gray-500 bg-gray-50 border-gray-200", active: "text-teal-600 bg-teal-50 border-teal-200", archived: "text-gray-400 bg-gray-50 border-gray-200" };

export type RaterGroup = { id: string; group_type: string; weight: number; is_required: boolean };
export type Assessment360 = { id: string; name: string; description: string | null; ratingScale: string; scaleLabel: string; minRaters: number; anonymous: boolean; status: string; createdBy: string | null; groups: RaterGroup[]; weightSum: number; balanced: boolean };

export async function loadThreeSixty(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.or(`hospital_id.eq.${hid ?? NONE},hospital_id.is.null`));
  const res = await scope(admin.from("cst_360_assessments").select("id, name, description, rating_scale, min_raters, anonymous, status, created_by_name, created_at").order("created_at", { ascending: false }).limit(500));
  if (res.error) return { provisioned: false as const };
  const rows = (res.data ?? []) as any[];

  const byAssessment = new Map<string, RaterGroup[]>();
  if (rows.length) {
    const { data: gs } = await admin.from("cst_360_respondent_groups").select("id, assessment_id, group_type, weight, is_required").in("assessment_id", rows.map(r => r.id)).limit(8000);
    for (const g of (gs ?? []) as any[]) { const a = byAssessment.get(g.assessment_id) ?? []; a.push({ id: g.id, group_type: g.group_type, weight: g.weight, is_required: g.is_required }); byAssessment.set(g.assessment_id, a); }
  }

  const assessments: Assessment360[] = rows.map(r => {
    const groups = (byAssessment.get(r.id) ?? []).sort((a, b) => RATER_GROUPS.findIndex(x => x.key === a.group_type) - RATER_GROUPS.findIndex(x => x.key === b.group_type));
    const weightSum = groups.reduce((s, g) => s + (g.weight || 0), 0);
    return {
      id: r.id, name: r.name, description: r.description, ratingScale: r.rating_scale, scaleLabel: SCALE_LABEL[r.rating_scale] ?? r.rating_scale,
      minRaters: r.min_raters, anonymous: r.anonymous, status: r.status, createdBy: r.created_by_name,
      groups, weightSum, balanced: groups.length > 0 && weightSum === 100,
    };
  });

  const count = (s: string) => assessments.filter(a => a.status === s).length;
  return {
    provisioned: true as const,
    empty: assessments.length === 0,
    kpis: { total: assessments.length, active: count("active"), draft: count("draft"), balanced: assessments.filter(a => a.balanced).length },
    assessments,
  };
}
