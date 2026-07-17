import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import BuilderWorkspace, { type DomainNode, type CompetencyNode } from "./BuilderWorkspace";
import VersionHistory from "./VersionHistory";

// Clinical Knowledge & Competency Studio — per-framework authoring workspace.
// Built to the UX Enhancement Specification: stat header with breakdowns,
// filterable tree, and a dynamic context panel with a real completeness
// breakdown. Every figure is computed from live data; the three dimensions the
// schema does not yet model (Policies, References, Analytics) are reported as
// "not tracked" rather than fabricated.

export default async function FrameworkDetailPage({ params }: { params: Promise<{ frameworkId: string }> }) {
  const { frameworkId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const { data: framework } = await admin
    .from("frameworks")
    .select("id, name, library, description, is_active, pub_status, version_num")
    .eq("id", frameworkId)
    .returns<{ id: string; name: string; library: string; description: string | null; is_active: boolean; pub_status?: string | null; version_num?: number | null }[]>()
    .single();
  if (!framework) notFound();

  const [
    { data: domains }, { data: practices }, { data: cpus }, { data: blueprints },
    { data: evidence }, { data: knowledge }, { data: cases }, { data: banks },
    { data: critical }, { data: owners }, { data: versions }, { data: allFrameworks },
  ] = await Promise.all([
    admin.from("framework_domains")
      .select(`id, name, sort_order,
        framework_competencies(
          id, name, description, sort_order, code, cpu_id, risk_category, created_at,
          competency_skills(id, name, is_active, library_skill_id)
        )`)
      .eq("framework_id", frameworkId).order("sort_order"),
    admin.from("practices").select("id, name, domain_id"),
    admin.from("clinical_practice_units").select("id, name, code, practice_id, pub_status, risk_category"),
    admin.from("assessment_blueprints").select("id, cpu_id, blueprint_methods(id, method)"),
    admin.from("evidence_matrix").select("id, cpu_id"),
    admin.from("knowledge_objects").select("id, cpu_id, status"),
    admin.from("clinical_cases").select("id, cpu_id, status"),
    admin.from("question_banks").select("id, cpu_id, questions(id)").eq("is_active", true),
    admin.from("critical_failure_rules").select("id, cpu_id"),
    admin.from("content_responsibilities")
      .select("content_id, content_type, responsibility_type, profiles!user_id(full_name)")
      .eq("status", "active"),
    admin.from("framework_versions")
      .select("id, version_num, published_by_name, published_at, notes, snapshot")
      .eq("framework_id", frameworkId).order("version_num", { ascending: false }).limit(20),
    admin.from("frameworks").select("id, name, library").eq("is_active", true).order("name"),
  ]);

  // ── Indexes ──
  const domainIds = new Set((domains ?? []).map(d => d.id));
  const frameworkPractices = (practices ?? []).filter(p => domainIds.has(p.domain_id));
  const practiceIds = new Set(frameworkPractices.map(p => p.id));
  const frameworkCpus = (cpus ?? []).filter(c => practiceIds.has(c.practice_id));
  const cpuById = new Map((cpus ?? []).map(c => [c.id, c]));

  const countBy = <T extends { cpu_id: string | null }>(rows: T[] | null, filter?: (r: T) => boolean) => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) {
      if (!r.cpu_id || (filter && !filter(r))) continue;
      m.set(r.cpu_id, (m.get(r.cpu_id) ?? 0) + 1);
    }
    return m;
  };
  const knowledgeByCpu = countBy(knowledge ?? []);
  const knowledgePubByCpu = countBy(knowledge ?? [], k => k.status === "active");
  const casesByCpu = countBy(cases ?? []);
  const evidenceByCpu = countBy(evidence ?? []);
  const criticalByCpu = countBy(critical ?? []);

  const methodsByCpu = new Map<string, number>();
  for (const b of blueprints ?? []) {
    if (!b.cpu_id) continue;
    methodsByCpu.set(b.cpu_id, ((b.blueprint_methods ?? []) as unknown[]).length);
  }
  const mcqByCpu = new Map<string, number>();
  for (const b of banks ?? []) {
    if (!b.cpu_id) continue;
    mcqByCpu.set(b.cpu_id, (mcqByCpu.get(b.cpu_id) ?? 0) + ((b.questions ?? []) as unknown[]).length);
  }
  const ownerByContent = new Map<string, string>();
  for (const o of owners ?? []) {
    if (o.responsibility_type !== "product_owner") continue;
    const name = (o.profiles as unknown as { full_name: string } | null)?.full_name;
    if (name) ownerByContent.set(o.content_id, name);
  }

  // ── Build the tree ──
  const tree: DomainNode[] = (domains ?? []).map((d, di) => {
    const comps: CompetencyNode[] = (d.framework_competencies ?? [])
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((c, ci) => {
        const skills = (c.competency_skills ?? []) as { id: string; name: string; is_active: boolean; library_skill_id: string | null }[];
        const cpu = c.cpu_id ? cpuById.get(c.cpu_id) : null;
        const k = c.cpu_id ? (knowledgeByCpu.get(c.cpu_id) ?? 0) : 0;
        const kPub = c.cpu_id ? (knowledgePubByCpu.get(c.cpu_id) ?? 0) : 0;
        const cs = c.cpu_id ? (casesByCpu.get(c.cpu_id) ?? 0) : 0;
        const ev = c.cpu_id ? (evidenceByCpu.get(c.cpu_id) ?? 0) : 0;
        const me = c.cpu_id ? (methodsByCpu.get(c.cpu_id) ?? 0) : 0;
        const mcq = c.cpu_id ? (mcqByCpu.get(c.cpu_id) ?? 0) : 0;
        const cf = c.cpu_id ? (criticalByCpu.get(c.cpu_id) ?? 0) : 0;

        // Completeness across the six dimensions the schema models
        const dims = [
          { key: "Knowledge", present: k > 0, detail: k ? `${kPub}/${k} published` : "none" },
          { key: "Skills", present: skills.length > 0, detail: skills.length ? `${skills.filter(s => s.is_active).length} active` : "none" },
          { key: "Assessments", present: me > 0, detail: me ? `${me} methods` : "no blueprint" },
          { key: "Knowledge test", present: mcq > 0, detail: mcq ? `${mcq} questions` : "none" },
          { key: "Case studies", present: cs > 0, detail: cs ? `${cs} cases` : "none" },
          { key: "Evidence", present: ev > 0, detail: ev ? `${ev} requirements` : "none" },
        ];
        const completeness = Math.round((dims.filter(x => x.present).length / dims.length) * 100);

        const status = !c.cpu_id ? "incomplete"
          : cpu?.pub_status === "published" ? "published"
          : cpu?.pub_status === "in_review" ? "review"
          : cpu?.pub_status === "approved" ? "approved"
          : "draft";

        return {
          id: c.id, number: `${di + 1}.${ci + 1}`, name: c.name, code: c.code ?? null,
          description: c.description ?? null, riskCategory: c.risk_category ?? null,
          cpuId: c.cpu_id ?? null, cpuName: cpu?.name ?? null,
          status,
          completeness, dimensions: dims,
          skills: skills.map(s => ({ id: s.id, name: s.name, active: s.is_active, reusable: !!s.library_skill_id })),
          stats: { knowledge: k, knowledgePublished: kPub, cases: cs, evidence: ev, methods: me, mcqs: mcq, criticalRules: cf },
          owner: (c.cpu_id ? ownerByContent.get(c.cpu_id) : null) ?? null,
          addedAt: c.created_at ?? null,
          sortOrder: c.sort_order ?? 0,
        };
      });

    const skillCount = comps.reduce((s, c) => s + c.skills.length, 0);
    const cpuIds = new Set(comps.map(c => c.cpuId).filter(Boolean));
    const completeness = comps.length ? Math.round(comps.reduce((s, c) => s + c.completeness, 0) / comps.length) : 0;
    return {
      id: d.id, number: di + 1, name: d.name, competencies: comps,
      skillCount, cpuCount: cpuIds.size, completeness, sortOrder: d.sort_order ?? 0,
    };
  });

  // ── Framework-level stats (with the breakdowns the design calls for) ──
  const allComps = tree.flatMap(d => d.competencies);
  const allSkills = allComps.flatMap(c => c.skills);
  const linkedCpuIds = new Set(allComps.map(c => c.cpuId).filter(Boolean));
  const stats = {
    domains: tree.length,
    domainsWithContent: tree.filter(d => d.competencies.length > 0).length,
    competencies: allComps.length,
    competenciesPublished: allComps.filter(c => c.status === "published").length,
    competenciesDraft: allComps.filter(c => c.status === "draft" || c.status === "incomplete").length,
    skills: allSkills.length,
    skillsReusable: allSkills.filter(s => s.reusable).length,
    skillsCustom: allSkills.filter(s => !s.reusable).length,
    cpus: frameworkCpus.length,
    cpusLinked: frameworkCpus.filter(c => linkedCpuIds.has(c.id)).length,
    cpusUnlinked: frameworkCpus.filter(c => !linkedCpuIds.has(c.id)).length,
    completeness: allComps.length ? Math.round(allComps.reduce((s, c) => s + c.completeness, 0) / allComps.length) : 0,
  };

  const LIBRARY_LABEL: Record<string, string> = { core: "Core Nursing", specialty: "Specialty", role: "Role-Based" };

  return (
    <div data-wide>
      <div className="flex items-center gap-2 text-xs text-gray-400 mb-4">
        <span>Competency Studio</span>
        <span>/</span>
        <span className="text-gray-700 font-medium">{framework.name}</span>
      </div>

      <BuilderWorkspace
        frameworkId={frameworkId}
        frameworkName={framework.name}
        libraryLabel={LIBRARY_LABEL[framework.library] ?? framework.library}
        pubStatus={framework.pub_status ?? "draft"}
        version={framework.version_num ?? 0}
        stats={stats}
        domains={tree}
        owners={[...new Set([...ownerByContent.values()])]}
        allFrameworks={allFrameworks ?? []}
      />

      {(versions ?? []).length > 0 && (
        <div id="version-history" className="max-w-full">
          <VersionHistory versions={versions as Parameters<typeof VersionHistory>[0]["versions"]} />
        </div>
      )}
    </div>
  );
}
