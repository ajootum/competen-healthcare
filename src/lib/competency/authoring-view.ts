/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadClinicalReviews, type ClinicalReview } from "./clinical-review";

// What the CFCA authoring page shows (migration 465): the SHARED layered frameworks (hospital_id null, a CFCA layer or
// code), their domains and competencies with the content the 395 hash covers, each competency's clinical state in
// words, and the option lists. Read only. null = could not be read (the page says so rather than show a partial list).

export type AuthoringCompetency = {
  id: string; code: string | null; name: string; description: string | null; learningOutcomes: string[];
  expectedLevelId: string | null; riskCategory: string; sortOrder: number; cpuId: string | null; clinical: ClinicalReview | null;
};
export type AuthoringPractice = { id: string; code: string | null; name: string; cpus: { id: string; code: string | null; name: string; riskCategory: string; complexity: number }[] };
export type AuthoringFramework = {
  id: string; code: string | null; name: string; description: string | null; layer: string | null; pubStatus: string; versionNum: number;
  professionTermId: string | null; specialtyTermId: string | null; parentFrameworkId: string | null;
  domains: { id: string; code: string | null; name: string; sortOrder: number; practices: AuthoringPractice[]; competencies: AuthoringCompetency[] }[];
};
export type AuthoringView = {
  frameworks: AuthoringFramework[];
  levels: { id: string; score: number; label: string }[];
  professions: { id: string; value: string }[];
  specialties: { id: string; value: string }[];
  clinicalReadable: boolean;
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
    const [reviews, lv, professions, specialties] = await Promise.all([
      ids.length ? loadClinicalReviews(admin, ids) : Promise.resolve(new Map<string, ClinicalReview>()),
      admin.from("scoring_levels").select("id, score, label, scoring_scales!inner(is_default)").eq("scoring_scales.is_default", true).order("score"),
      terms(admin, "profession"), terms(admin, "specialty"),
    ]);
    const frameworks: AuthoringFramework[] = (fws ?? []).map((f: any) => ({
      id: f.id, code: f.code ?? null, name: f.name, description: f.description ?? null, layer: f.competency_layer ?? null, pubStatus: f.pub_status ?? "draft", versionNum: f.version_num ?? 0,
      professionTermId: f.profession_term_id ?? null, specialtyTermId: f.specialty_term_id ?? null, parentFrameworkId: f.parent_framework_id ?? null,
      domains: [...(f.framework_domains ?? [])].sort((a: any, b: any) => a.sort_order - b.sort_order).map((d: any) => ({
        id: d.id, code: d.code ?? null, name: d.name, sortOrder: d.sort_order,
        practices: (d.practices ?? []).map((p: any) => ({ id: p.id, code: p.code ?? null, name: p.name,
          cpus: (p.clinical_practice_units ?? []).map((u: any) => ({ id: u.id, code: u.code ?? null, name: u.name, riskCategory: u.risk_category ?? "standard", complexity: u.complexity ?? 2 })) })),
        competencies: [...(d.framework_competencies ?? [])].sort((a: any, b: any) => a.sort_order - b.sort_order).map((c: any) => ({
          id: c.id, code: c.code ?? null, name: c.name, description: c.description ?? null,
          learningOutcomes: Array.isArray(c.learning_outcomes) ? c.learning_outcomes.map(String) : [],
          expectedLevelId: c.expected_level_id ?? null, riskCategory: c.risk_category ?? "standard", sortOrder: c.sort_order, cpuId: c.cpu_id ?? null,
          clinical: reviews ? reviews.get(c.id) ?? null : null,
        })),
      })),
    }));
    return {
      frameworks, clinicalReadable: reviews !== null,
      levels: (lv.data ?? []).map((l: any) => ({ id: l.id, score: l.score, label: l.label })),
      professions, specialties,
    };
  } catch { return null; }
}
