import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import DomainCompetencyBuilder from "./DomainCompetencyBuilder";
import VersionHistory from "./VersionHistory";
import ImpactAnalysis from "./ImpactAnalysis";

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

  const [{ data: domains }, { data: versions }] = await Promise.all([
    admin
      .from("framework_domains")
      .select(`
        id, name, sort_order,
        framework_competencies(
          id, name, description, sort_order,
          competency_skills(id, name, sort_order, is_active)
        )
      `)
      .eq("framework_id", frameworkId)
      .order("sort_order"),

    admin
      .from("framework_versions")
      .select("id, version_num, published_by_name, published_at, notes, snapshot")
      .eq("framework_id", frameworkId)
      .order("version_num", { ascending: false })
      .limit(20),
  ]);

  const LIBRARY_LABEL: Record<string, string> = { core: "Core Nursing", specialty: "Specialty", role: "Role-Based" };
  const versionNum = framework.version_num ?? 0;

  return (
    <div className="max-w-5xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-gray-400 mb-4">
        <Link href="/super-admin/content" className="hover:text-gray-600">Content Builder</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">{framework.name}</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-gray-900">{framework.name}</h1>
            <span className="text-[10px] bg-teal-100 text-teal-700 font-bold px-2 py-0.5 rounded capitalize">
              {LIBRARY_LABEL[framework.library] ?? framework.library}
            </span>
            {versionNum > 0 && (
              <span className="text-[10px] bg-gray-100 text-gray-600 font-semibold px-2 py-0.5 rounded">
                v{versionNum}
              </span>
            )}
          </div>
          <p className="text-gray-400 text-sm mt-0.5">
            {(domains ?? []).length} domains · {(domains ?? []).reduce((s, d) => s + (d.framework_competencies?.length ?? 0), 0)} competencies
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ImpactAnalysis frameworkId={frameworkId} />
          <Link href={`/super-admin/content/${frameworkId}/cpus`}
            className="px-4 py-2 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
            🧩 Practice &amp; CPU Structure →
          </Link>
        </div>
      </div>

      <DomainCompetencyBuilder frameworkId={frameworkId} domains={domains ?? []} />

      {(versions ?? []).length > 0 && (
        <VersionHistory versions={versions as Parameters<typeof VersionHistory>[0]["versions"]} />
      )}
    </div>
  );
}
