import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import CpuBuilder from "./CpuBuilder";

export default async function CpuBuilderPage({ params }: { params: Promise<{ frameworkId: string }> }) {
  const { frameworkId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "super_admin") redirect("/dashboard");

  const { data: framework } = await admin
    .from("frameworks").select("id, name, library").eq("id", frameworkId).single();
  if (!framework) notFound();

  // Domains → competencies (with current practice/cpu assignment)
  const { data: domains } = await admin
    .from("framework_domains")
    .select("id, name, sort_order, framework_competencies(id, name, practice_id, cpu_id, risk_category)")
    .eq("framework_id", frameworkId)
    .order("sort_order");

  const domainIds = (domains ?? []).map(d => d.id);

  // Practices for these domains
  const { data: practices } = domainIds.length
    ? await admin.from("practices").select("id, domain_id, name, code, sort_order").in("domain_id", domainIds).order("sort_order")
    : { data: [] as { id: string; domain_id: string; name: string; code: string | null; sort_order: number }[] };

  const practiceIds = (practices ?? []).map(p => p.id);

  // CPUs for these practices
  const { data: cpus } = practiceIds.length
    ? await admin.from("clinical_practice_units")
        .select("id, practice_id, name, code, risk_category, complexity, reassessment_months, pub_status, sort_order")
        .in("practice_id", practiceIds).order("sort_order")
    : { data: [] as {
        id: string; practice_id: string; name: string; code: string | null;
        risk_category: string; complexity: number; reassessment_months: number; pub_status: string; sort_order: number;
      }[] };

  const LIB_LABEL: Record<string, string> = { core: "Core Nursing", specialty: "Specialty", role: "Role-Based" };

  return (
    <div className="max-w-5xl">
      <div className="flex items-center gap-2 text-xs text-gray-400 mb-4">
        <Link href="/super-admin/content" className="hover:text-gray-600">Content Builder</Link>
        <span>/</span>
        <Link href={`/super-admin/content/${frameworkId}`} className="hover:text-gray-600">{framework.name}</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Practice & CPU Structure</span>
      </div>

      <div className="mb-6">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold text-gray-900">{framework.name}</h1>
          <span className="text-[10px] bg-teal-100 text-teal-700 font-bold px-2 py-0.5 rounded capitalize">
            {LIB_LABEL[framework.library] ?? framework.library}
          </span>
        </div>
        <p className="text-gray-400 text-sm mt-0.5">
          Organise competencies into <span className="font-medium text-gray-600">Practices → Clinical Practice Units</span> and configure each CPU&apos;s assessment blueprint (Book I).
        </p>
      </div>

      <CpuBuilder
        frameworkId={frameworkId}
        domains={domains ?? []}
        practices={practices ?? []}
        cpus={cpus ?? []}
      />
    </div>
  );
}
