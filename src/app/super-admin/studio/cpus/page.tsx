import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import CpuLibrary from "./CpuLibrary";

// Clinical Practice & CPU Library ("Clinical Practice and CPUs" spec §4):
// Practices are the governance taxonomy; CPUs are the reusable
// implementation objects. This is the cross-framework overview of both.

export default async function CpuLibraryPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "super_admin") redirect("/dashboard");

  const [{ data: practices }, { data: cpus }, { data: comps }, { data: skills }, { data: methods }] = await Promise.all([
    admin.from("practices")
      .select("id, name, code, framework_domains(name, frameworks(id, name))")
      .order("name"),
    admin.from("clinical_practice_units")
      .select("id, name, code, practice_id, risk_category, complexity, pub_status, reassessment_months")
      .order("name"),
    admin.from("framework_competencies").select("id, cpu_id").not("cpu_id", "is", null),
    admin.from("competency_skills").select("id, competency_id"),
    admin.from("blueprint_methods").select("id, assessment_blueprints!blueprint_id(cpu_id)"),
  ]);

  // Counts
  const compsByCpu = new Map<string, string[]>();
  for (const c of comps ?? []) {
    if (!compsByCpu.has(c.cpu_id!)) compsByCpu.set(c.cpu_id!, []);
    compsByCpu.get(c.cpu_id!)!.push(c.id);
  }
  const skillsByComp = new Map<string, number>();
  for (const s of skills ?? []) skillsByComp.set(s.competency_id, (skillsByComp.get(s.competency_id) ?? 0) + 1);
  const methodsByCpu = new Map<string, number>();
  for (const m of methods ?? []) {
    const cpuId = (m.assessment_blueprints as unknown as { cpu_id: string } | null)?.cpu_id;
    if (cpuId) methodsByCpu.set(cpuId, (methodsByCpu.get(cpuId) ?? 0) + 1);
  }

  const practiceRows = (practices ?? []).map(p => {
    const d = p.framework_domains as unknown as { name: string; frameworks: { id: string; name: string } | null } | null;
    const pCpus = (cpus ?? []).filter(c => c.practice_id === p.id);
    const compCount = pCpus.reduce((s, c) => s + (compsByCpu.get(c.id)?.length ?? 0), 0);
    return {
      id: p.id, name: p.name, code: p.code,
      domain: d?.name ?? "—", framework: d?.frameworks?.name ?? "—", frameworkId: d?.frameworks?.id ?? null,
      cpuCount: pCpus.length, compCount,
      published: pCpus.filter(c => c.pub_status === "published").length,
    };
  });

  const practiceById = new Map(practiceRows.map(p => [p.id, p]));
  const cpuRows = (cpus ?? []).map(c => {
    const compIds = compsByCpu.get(c.id) ?? [];
    return {
      id: c.id, name: c.name, code: c.code,
      practice: practiceById.get(c.practice_id)?.name ?? "—",
      frameworkId: practiceById.get(c.practice_id)?.frameworkId ?? null,
      risk: c.risk_category, status: c.pub_status,
      competencies: compIds.length,
      skills: compIds.reduce((s, id) => s + (skillsByComp.get(id) ?? 0), 0),
      assessments: methodsByCpu.get(c.id) ?? 0,
    };
  });

  return (
    <div className="max-w-5xl">
      <div className="flex items-center gap-2 text-xs text-gray-400 mb-4">
        <Link href="/super-admin/studio" className="hover:text-gray-600">Studio</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Clinical Practices &amp; CPUs</span>
      </div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Clinical Practices &amp; CPUs</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Practices organize the clinical library; CPUs are the reusable, version-controlled implementation objects.
        </p>
      </div>
      <CpuLibrary practices={practiceRows as never} cpus={cpuRows as never} />
    </div>
  );
}
