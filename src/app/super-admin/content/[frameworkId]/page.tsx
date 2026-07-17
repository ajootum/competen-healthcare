import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import BuilderWorkspace, { type DomainNode } from "./BuilderWorkspace";
import VersionHistory from "./VersionHistory";

// Content Builder — framework detail workspace (rebuilt per the design brief).
// Three-region layout: stat header, filterable framework tree, right context
// panel. Every number is computed from real data; content types the schema
// does not yet track are shown as "not tracked", never fabricated.

export default async function FrameworkDetailPage({ params }: { params: Promise<{ frameworkId: string }> }) {
  const { frameworkId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const { data: framework } = await admin
    .from("frameworks")
    .select("id, name, library, description, is_active, pub_status, version_num, review_date")
    .eq("id", frameworkId)
    .returns<{ id: string; name: string; library: string; description: string | null; is_active: boolean; pub_status?: string | null; version_num?: number | null; review_date?: string | null }[]>()
    .single();
  if (!framework) notFound();

  const [{ data: domains }, { data: cpus }, { data: banks }, { data: versions }] = await Promise.all([
    admin.from("framework_domains")
      .select(`id, name, sort_order,
        framework_competencies(
          id, name, description, sort_order, cpu_id, risk_category,
          competency_skills(id, name, sort_order, is_active)
        )`)
      .eq("framework_id", frameworkId).order("sort_order"),
    admin.from("clinical_practice_units").select("id, name, practice_id, pub_status"),
    admin.from("question_banks").select("id, cpu_id").eq("is_active", true),
    admin.from("framework_versions")
      .select("id, version_num, published_by_name, published_at, notes, snapshot")
      .eq("framework_id", frameworkId).order("version_num", { ascending: false }).limit(20),
  ]);

  const cpuById = new Map((cpus ?? []).map(c => [c.id, c]));
  const mcqByCpu = new Map<string, number>();
  for (const b of banks ?? []) if (b.cpu_id) mcqByCpu.set(b.cpu_id, (mcqByCpu.get(b.cpu_id) ?? 0) + 1);

  // Build the domain tree with computed aggregates
  const tree: DomainNode[] = (domains ?? []).map(d => {
    const comps = (d.framework_competencies ?? []).map(c => {
      const skills = (c.competency_skills ?? []) as { id: string; name: string; is_active: boolean; sort_order: number }[];
      const cpu = c.cpu_id ? cpuById.get(c.cpu_id) : null;
      return {
        id: c.id, name: c.name, description: c.description ?? null,
        riskCategory: c.risk_category ?? null,
        cpuId: c.cpu_id ?? null, cpuName: cpu?.name ?? null, cpuPublished: cpu?.pub_status === "published",
        practiceId: cpu?.practice_id ?? null,
        skills: skills.sort((a, b) => a.sort_order - b.sort_order).map(s => ({ id: s.id, name: s.name, active: s.is_active })),
        mcqs: c.cpu_id ? (mcqByCpu.get(c.cpu_id) ?? 0) : 0,
      };
    });
    const cpuIds = new Set(comps.map(c => c.cpuId).filter(Boolean));
    const practiceIds = new Set(comps.map(c => c.practiceId).filter(Boolean));
    const skillCount = comps.reduce((s, c) => s + c.skills.length, 0);
    // Completeness = competencies that are attached to a CPU (assessable) / total
    const withCpu = comps.filter(c => c.cpuId).length;
    const completeness = comps.length ? Math.round((withCpu / comps.length) * 100) : 0;
    return {
      id: d.id, name: d.name,
      competencies: comps,
      cpuCount: cpuIds.size, practiceCount: practiceIds.size, skillCount,
      completeness,
      published: cpuIds.size > 0 && [...cpuIds].every(id => cpuById.get(id!)?.pub_status === "published"),
    };
  });

  const totals = {
    domains: tree.length,
    competencies: tree.reduce((s, d) => s + d.competencies.length, 0),
    skills: tree.reduce((s, d) => s + d.skillCount, 0),
    cpus: new Set(tree.flatMap(d => d.competencies.map(c => c.cpuId).filter(Boolean))).size,
    mcqs: tree.reduce((s, d) => s + d.competencies.reduce((t, c) => t + c.mcqs, 0), 0),
    completeness: tree.length ? Math.round(tree.reduce((s, d) => s + d.completeness, 0) / tree.length) : 0,
  };

  const LIBRARY_LABEL: Record<string, string> = { core: "Core Nursing", specialty: "Specialty", role: "Role-Based" };

  return (
    <div>
      <div className="flex items-center gap-2 text-xs text-gray-400 mb-4">
        <Link href="/super-admin/content" className="hover:text-gray-600">Framework Builder</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">{framework.name}</span>
      </div>

      <BuilderWorkspace
        frameworkId={frameworkId}
        frameworkName={framework.name}
        libraryLabel={LIBRARY_LABEL[framework.library] ?? framework.library}
        pubStatus={framework.pub_status ?? "draft"}
        version={framework.version_num ?? 0}
        updatedAt={versions?.[0]?.published_at ?? null}
        totals={totals}
        domains={tree}
      />

      {(versions ?? []).length > 0 && (
        <div className="max-w-6xl">
          <VersionHistory versions={versions as Parameters<typeof VersionHistory>[0]["versions"]} />
        </div>
      )}
    </div>
  );
}
