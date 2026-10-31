/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadClinicalReviews, type ClinicalReview } from "./clinical-review";
import { asLayout, byRowOrder, type LayoutV1 } from "./layout-order";

// What the CFCA authoring page shows (migration 465): the SHARED layered frameworks (hospital_id null, a CFCA layer or
// code), their domains and competencies with the content the 395 hash covers, each competency's clinical state in
// words, and the option lists. Read only. null = could not be read (the page says so rather than show a partial list).

export type AuthoringCompetency = {
  id: string; code: string | null; name: string; description: string | null; learningOutcomes: string[];
  expectedLevelId: string | null; riskCategory: string; sortOrder: number; cpuId: string | null; clinical: ClinicalReview | null;
  /** CFCA-STUDIO-P1 (670): its skills / assessment criteria, in order, each with its component (null = not classified). */
  criteria: AuthoringCriterion[];
};
/** id: the competency_skills row (FRAMEWORK-DESIGN-STUDIO-01, for reordering). active false: retired (FRAMEWORK-DESIGN-STUDIO-02 S1), kept for history. */
export type AuthoringCriterion = { id?: string; component: string | null; text: string; sourceRef: string | null; active?: boolean };
export type AuthoringPractice = { id: string; code: string | null; name: string; cpus: { id: string; code: string | null; name: string; riskCategory: string; complexity: number }[] };
export type AuthoringFramework = {
  id: string; code: string | null; name: string; description: string | null; layer: string | null; pubStatus: string; versionNum: number;
  professionTermId: string | null; specialtyTermId: string | null; parentFrameworkId: string | null;
  /** FRAMEWORK-DESIGN-STUDIO-01 (750). The live order is what domains/competencies/criteria are in. The pending layout
   *  draft of a published framework (null: none) renders through layout-order.ts applyLayout. componentOrder null = the
   *  registry order. All null before 750. */
  layoutDraft?: LayoutV1 | null; layoutDraftBy?: string | null; layoutDraftAt?: string | null; componentOrder?: string[] | null;
  domains: { id: string; code: string | null; name: string; sortOrder: number; practices: AuthoringPractice[]; competencies: AuthoringCompetency[] }[];
};
export type AuthoringView = {
  frameworks: AuthoringFramework[];
  levels: { id: string; score: number; label: string }[];
  professions: { id: string; value: string }[];
  specialties: { id: string; value: string }[];
  clinicalReadable: boolean;
  /** FRAMEWORK-DESIGN-STUDIO-01: 750 and 751 are on this environment, so reordering is offered. */
  layoutReady?: boolean;
  /** The assessment component names (660), by code. */
  components: Record<string, string>;
};

async function terms(admin: any, kind: string): Promise<{ id: string; value: string }[]> {
  const { data: tax } = await admin.from("taxonomies").select("id").eq("kind", kind).maybeSingle();
  if (!tax) return [];
  const { data } = await admin.from("taxonomy_terms").select("id, value").eq("taxonomy_id", tax.id).order("value").limit(500);
  return (data ?? []).map((t: any) => ({ id: t.id, value: t.value }));
}

export async function loadAuthoringView(admin: any): Promise<AuthoringView | null> {
  try {
    const { data: fws, error } = await admin.from("frameworks")
      .select("id, code, name, description, competency_layer, pub_status, version_num, profession_term_id, specialty_term_id, parent_framework_id, framework_domains(id, code, name, sort_order, practices(id, code, name, clinical_practice_units(id, code, name, risk_category, complexity)), framework_competencies(id, code, name, description, learning_outcomes, expected_level_id, risk_category, sort_order, cpu_id))")
      .is("hospital_id", null).or("competency_layer.not.is.null,code.not.is.null").order("name").limit(200);
    if (error) return null;
    const ids = (fws ?? []).flatMap((f: any) => (f.framework_domains ?? []).flatMap((d: any) => (d.framework_competencies ?? []).map((c: any) => c.id)));
    const fwIds = (fws ?? []).map((f: any) => f.id);
    const [reviews, lv, professions, specialties, skills, comps, layouts, outcomeIds] = await Promise.all([
      ids.length ? loadClinicalReviews(admin, ids) : Promise.resolve(new Map<string, ClinicalReview>()),
      admin.from("scoring_levels").select("id, score, label, scoring_scales!inner(is_default)").eq("scoring_scales.is_default", true).order("score"),
      terms(admin, "profession"), terms(admin, "specialty"), loadCriteria(admin, ids),
      admin.from("competency_assessment_component").select("code, label").order("sort_order"),
      // 750: absent columns read as "reordering not set up", never as a failure of the page.
      fwIds.length ? admin.from("frameworks").select("id, layout_draft, layout_draft_by, layout_draft_at, component_order").in("id", fwIds) : Promise.resolve({ data: [], error: null }),
      admin.from("framework_competencies").select("id, learning_outcome_ids").limit(0),
    ]);
    const lay = new Map<string, any>(layouts.error ? [] : (layouts.data ?? []).map((r: any) => [r.id, r]));
    const frameworks: AuthoringFramework[] = (fws ?? []).map((f: any) => ({
      id: f.id, code: f.code ?? null, name: f.name, description: f.description ?? null, layer: f.competency_layer ?? null, pubStatus: f.pub_status ?? "draft", versionNum: f.version_num ?? 0,
      professionTermId: f.profession_term_id ?? null, specialtyTermId: f.specialty_term_id ?? null, parentFrameworkId: f.parent_framework_id ?? null,
      layoutDraft: asLayout(lay.get(f.id)?.layout_draft), layoutDraftBy: lay.get(f.id)?.layout_draft_by ?? null, layoutDraftAt: lay.get(f.id)?.layout_draft_at ?? null,
      componentOrder: Array.isArray(lay.get(f.id)?.component_order) ? lay.get(f.id).component_order : null,
      domains: [...(f.framework_domains ?? [])].sort(byRowOrder).map((d: any) => ({
        id: d.id, code: d.code ?? null, name: d.name, sortOrder: d.sort_order,
        practices: (d.practices ?? []).map((p: any) => ({ id: p.id, code: p.code ?? null, name: p.name,
          cpus: (p.clinical_practice_units ?? []).map((u: any) => ({ id: u.id, code: u.code ?? null, name: u.name, riskCategory: u.risk_category ?? "standard", complexity: u.complexity ?? 2 })) })),
        competencies: [...(d.framework_competencies ?? [])].sort(byRowOrder).map((c: any) => ({
          id: c.id, code: c.code ?? null, name: c.name, description: c.description ?? null,
          learningOutcomes: Array.isArray(c.learning_outcomes) ? c.learning_outcomes.map(String) : [],
          expectedLevelId: c.expected_level_id ?? null, riskCategory: c.risk_category ?? "standard", sortOrder: c.sort_order, cpuId: c.cpu_id ?? null,
          clinical: reviews ? reviews.get(c.id) ?? null : null,
          criteria: skills.get(c.id) ?? [],
        })),
      })),
    }));
    return {
      frameworks, clinicalReadable: reviews !== null, layoutReady: !layouts.error && !outcomeIds?.error,
      levels: (lv.data ?? []).map((l: any) => ({ id: l.id, score: l.score, label: l.label })),
      professions, specialties,
      components: Object.fromEntries(((comps?.data ?? []) as any[]).map(c => [c.code, c.label])),
    };
  } catch { return null; }
}

/** Skills and criteria of the shown competencies, with their component (670). Before 670 they are read without it. */
async function loadCriteria(admin: any, ids: string[]): Promise<Map<string, AuthoringCriterion[]>> {
  const out = new Map<string, AuthoringCriterion[]>();
  if (!ids.length) return out;
  const read = (cols: string) => admin.from("competency_skills").select(cols).in("competency_id", ids).order("sort_order").limit(20000);
  let r = await read("id, competency_id, name, sort_order, is_active, component_code, source_ref");
  if (r.error) r = await read("id, competency_id, name, sort_order, is_active");
  for (const k of ([...(r.data ?? [])] as any[]).sort(byRowOrder)) out.set(k.competency_id, [...(out.get(k.competency_id) ?? []), { id: k.id, component: k.component_code ?? null, text: k.name, sourceRef: k.source_ref ?? null, active: k.is_active !== false }]);
  return out;
}
