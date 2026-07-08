import { createAdminClient } from "@/lib/supabase/server";

type Admin = ReturnType<typeof createAdminClient>;

export type ImpactReport = {
  entity: { type: string; id: string; name: string };
  affected: { label: string; count: number; items: string[] }[];
  edges: { relationship: string; target_type: string; target_id: string }[];
};

/**
 * Book I Ch.11.15 — Knowledge Dependency Graph impact analysis.
 * Given a framework, computes every downstream object that a change would touch,
 * by walking the governed hierarchy plus any explicit knowledge_edges.
 */
export async function frameworkImpact(admin: Admin, frameworkId: string): Promise<ImpactReport> {
  const { data: fw } = await admin.from("frameworks").select("id, name").eq("id", frameworkId).single();

  const { data: domains } = await admin
    .from("framework_domains")
    .select("id, name, framework_competencies(id, name, cpu_id, competency_skills(id, name))")
    .eq("framework_id", frameworkId);

  const domainList = domains ?? [];
  const competencies = domainList.flatMap(d => (d.framework_competencies as unknown as {
    id: string; name: string; cpu_id: string | null;
    competency_skills: { id: string; name: string }[];
  }[]) ?? []);
  const skills = competencies.flatMap(c => c.competency_skills ?? []);
  const cpuIds = [...new Set(competencies.map(c => c.cpu_id).filter(Boolean))] as string[];

  // CPUs + their blueprints / evidence matrices
  let cpus: { id: string; name: string }[] = [];
  let blueprintCount = 0;
  let evidenceCount = 0;
  if (cpuIds.length) {
    const [{ data: cpuRows }, { data: bps }, { data: mats }] = await Promise.all([
      admin.from("clinical_practice_units").select("id, name").in("id", cpuIds).returns<{ id: string; name: string }[]>(),
      admin.from("assessment_blueprints").select("id").in("cpu_id", cpuIds),
      admin.from("evidence_matrix").select("id").in("cpu_id", cpuIds),
    ]);
    cpus = cpuRows ?? [];
    blueprintCount = (bps ?? []).length;
    evidenceCount = (mats ?? []).length;
  }

  // Live cycles referencing this framework, and future decisions
  const [{ data: cycleFws }, { data: decisions }] = await Promise.all([
    admin.from("cycle_frameworks").select("cycle_id").eq("framework_id", frameworkId),
    admin.from("competency_decisions").select("id").eq("framework_id", frameworkId),
  ]);

  // Explicit graph edges out of this framework
  const { data: edges } = await admin
    .from("knowledge_edges")
    .select("relationship, target_type, target_id")
    .eq("source_type", "framework")
    .eq("source_id", frameworkId)
    .returns<{ relationship: string; target_type: string; target_id: string }[]>();

  const affected = [
    { label: "Domains",              count: domainList.length,        items: domainList.map(d => d.name) },
    { label: "Practices → CPUs",     count: cpus.length,              items: cpus.map(c => c.name) },
    { label: "Competencies",         count: competencies.length,      items: competencies.map(c => c.name) },
    { label: "Skills",               count: skills.length,            items: skills.map(s => s.name) },
    { label: "Assessment Blueprints", count: blueprintCount,          items: [] },
    { label: "Evidence Matrices",    count: evidenceCount,            items: [] },
    { label: "Active Cycles",        count: (cycleFws ?? []).length,  items: [] },
    { label: "Competency Decisions", count: (decisions ?? []).length, items: [] },
  ].filter(a => a.count > 0);

  return {
    entity: { type: "framework", id: frameworkId, name: fw?.name ?? frameworkId },
    affected,
    edges: edges ?? [],
  };
}
