/* eslint-disable @typescript-eslint/no-explicit-any */
// CST-042 Portfolio Assessment Designer — portfolio templates with required-evidence sections
// (cst_portfolio_templates + cst_portfolio_sections, migration 135). Each section requires a number of
// evidence artefacts of a type at a weight; weights should sum to 100%. Read on demand.

const NONE = "00000000-0000-0000-0000-000000000000";

export const PORTFOLIO_TYPES = [
  { key: "learning", label: "Learning" }, { key: "competency", label: "Competency" }, { key: "epa", label: "EPA" },
  { key: "clinical", label: "Clinical" }, { key: "leadership", label: "Leadership" }, { key: "research", label: "Research" }, { key: "custom", label: "Custom" },
];
export const PF_TYPE_LABEL: Record<string, string> = Object.fromEntries(PORTFOLIO_TYPES.map(t => [t.key, t.label]));
export const EVIDENCE_TYPES = [
  { key: "case_log", label: "Case log" }, { key: "procedure_log", label: "Procedure log" }, { key: "reflection", label: "Reflection" },
  { key: "certificate", label: "Certificate" }, { key: "assessment", label: "Assessment" }, { key: "project", label: "Project" },
  { key: "document", label: "Document" }, { key: "feedback", label: "Feedback" }, { key: "osce", label: "OSCE" }, { key: "other", label: "Other" },
];
export const EV_LABEL: Record<string, string> = Object.fromEntries(EVIDENCE_TYPES.map(e => [e.key, e.label]));
export const PF_STATUS_TONE: Record<string, string> = { draft: "text-gray-500 bg-gray-50 border-gray-200", active: "text-teal-600 bg-teal-50 border-teal-200", archived: "text-gray-400 bg-gray-50 border-gray-200" };

export type PortfolioSection = { id: string; name: string; evidenceType: string; evLabel: string; requiredCount: number; weight: number; required: boolean };
export type PortfolioTemplate = { id: string; name: string; description: string | null; portfolioType: string; typeLabel: string; status: string; createdBy: string | null; sections: PortfolioSection[]; weightSum: number; balanced: boolean; requiredArtefacts: number };

export async function loadPortfolios(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.or(`hospital_id.eq.${hid ?? NONE},hospital_id.is.null`));
  const res = await scope(admin.from("cst_portfolio_templates").select("id, name, description, portfolio_type, status, created_by_name, created_at").order("created_at", { ascending: false }).limit(500));
  if (res.error) return { provisioned: false as const };
  const rows = (res.data ?? []) as any[];

  const byTemplate = new Map<string, PortfolioSection[]>();
  if (rows.length) {
    const { data: secs } = await admin.from("cst_portfolio_sections").select("id, template_id, name, evidence_type, required_count, weight, is_required, sort_order").in("template_id", rows.map(r => r.id)).order("sort_order").limit(10000);
    for (const s of (secs ?? []) as any[]) { const a = byTemplate.get(s.template_id) ?? []; a.push({ id: s.id, name: s.name, evidenceType: s.evidence_type, evLabel: EV_LABEL[s.evidence_type] ?? s.evidence_type, requiredCount: s.required_count, weight: s.weight, required: s.is_required }); byTemplate.set(s.template_id, a); }
  }

  const templates: PortfolioTemplate[] = rows.map(r => {
    const sections = byTemplate.get(r.id) ?? [];
    const weightSum = sections.reduce((s, x) => s + (x.weight || 0), 0);
    return {
      id: r.id, name: r.name, description: r.description, portfolioType: r.portfolio_type, typeLabel: PF_TYPE_LABEL[r.portfolio_type] ?? r.portfolio_type,
      status: r.status, createdBy: r.created_by_name, sections,
      weightSum, balanced: sections.length > 0 && weightSum === 100,
      requiredArtefacts: sections.reduce((s, x) => s + (x.required ? x.requiredCount : 0), 0),
    };
  });

  const count = (s: string) => templates.filter(t => t.status === s).length;
  return {
    provisioned: true as const,
    empty: templates.length === 0,
    kpis: { total: templates.length, active: count("active"), draft: count("draft"), sections: [...byTemplate.values()].reduce((s, a) => s + a.length, 0) },
    templates,
  };
}
