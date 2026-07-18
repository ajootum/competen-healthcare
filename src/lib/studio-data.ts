import { createAdminClient } from "@/lib/supabase/server";

type Admin = ReturnType<typeof createAdminClient>;

// Live content-portfolio + design-pipeline figures for the Education Studio,
// aggregated across the real content object tables. Statuses normalise onto a
// single pipeline: draft → review → validation → published → retired.

export type StudioPortfolio = {
  frameworks: number; domains: number; competencies: number; cpus: number;
  courses: number; resources: number; questionBanks: number; questions: number;
  knowledge: number; cases: number; checklists: number; osce: number;
  pipeline: { draft: number; review: number; validation: number; published: number; retired: number };
  pendingReview: number;
};

const norm = (s: string | null | undefined): keyof StudioPortfolio["pipeline"] => {
  const v = (s ?? "draft").toLowerCase();
  if (["published", "active"].includes(v)) return "published";
  if (["retired", "archived", "superseded", "obsolete", "inactive"].includes(v)) return "retired";
  if (["validation", "clinical_review", "pending_validation"].includes(v)) return "validation";
  if (["in_review", "peer_review", "review", "pending"].includes(v)) return "review";
  return "draft";
};

export async function loadPortfolio(admin: Admin): Promise<StudioPortfolio> {
  const [
    { count: frameworks }, { count: domains }, { count: competencies }, { count: cpus },
    { count: courses }, { count: resources }, { count: questionBanks }, { count: questions },
    { count: checklists }, { count: osce },
    { data: fwStatus }, { data: cpuStatus }, { data: koStatus }, { data: caseStatus },
  ] = await Promise.all([
    admin.from("frameworks").select("id", { count: "exact", head: true }),
    admin.from("framework_domains").select("id", { count: "exact", head: true }),
    admin.from("framework_competencies").select("id", { count: "exact", head: true }),
    admin.from("clinical_practice_units").select("id", { count: "exact", head: true }),
    admin.from("courses").select("id", { count: "exact", head: true }),
    admin.from("learning_resources").select("id", { count: "exact", head: true }).eq("is_active", true),
    admin.from("question_banks").select("id", { count: "exact", head: true }).eq("is_active", true),
    admin.from("questions").select("id", { count: "exact", head: true }).not("bank_id", "is", null),
    admin.from("skill_checklists").select("id", { count: "exact", head: true }).eq("is_active", true),
    admin.from("osce_exams").select("id", { count: "exact", head: true }),
    admin.from("frameworks").select("pub_status").limit(2000),
    admin.from("clinical_practice_units").select("pub_status").limit(2000),
    admin.from("knowledge_objects").select("status").limit(2000),
    admin.from("clinical_cases").select("status").limit(2000),
  ]);

  const pipeline = { draft: 0, review: 0, validation: 0, published: 0, retired: 0 };
  for (const r of fwStatus ?? []) pipeline[norm(r.pub_status)]++;
  for (const r of cpuStatus ?? []) pipeline[norm(r.pub_status)]++;
  const koRows = koStatus ?? [];
  const caseRows = caseStatus ?? [];
  for (const r of koRows) pipeline[norm(r.status)]++;
  for (const r of caseRows) pipeline[norm(r.status)]++;

  return {
    frameworks: frameworks ?? 0, domains: domains ?? 0, competencies: competencies ?? 0, cpus: cpus ?? 0,
    courses: courses ?? 0, resources: resources ?? 0, questionBanks: questionBanks ?? 0, questions: questions ?? 0,
    knowledge: koRows.length, cases: caseRows.length, checklists: checklists ?? 0, osce: osce ?? 0,
    pipeline,
    pendingReview: pipeline.draft + pipeline.review + pipeline.validation,
  };
}
