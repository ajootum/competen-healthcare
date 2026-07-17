import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import CpuImporter from "./CpuImporter";

// CPU Document Import — paste an authored Clinical Practice Unit document,
// review exactly what was extracted, then commit it to the library.

export default async function CpuImportPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "super_admin") redirect("/dashboard");

  const [{ data: practices }, { data: domains }] = await Promise.all([
    admin.from("practices").select("id, name, code, framework_domains(name, frameworks(name))").order("name"),
    admin.from("framework_domains").select("id, name, frameworks(name)").order("name"),
  ]);

  const practiceOpts = (practices ?? []).map(p => {
    const d = p.framework_domains as unknown as { name: string; frameworks: { name: string } | null } | null;
    return { id: p.id, label: `${p.name}${d?.frameworks?.name ? ` — ${d.frameworks.name}` : ""}` };
  });
  const domainOpts = (domains ?? []).map(d => {
    const f = d.frameworks as unknown as { name: string } | null;
    return { id: d.id, label: `${d.name}${f?.name ? ` — ${f.name}` : ""}` };
  });

  return (
    <div className="max-w-5xl">
      <div className="flex items-center gap-2 text-xs text-gray-400 mb-4">
        <Link href="/super-admin/studio" className="hover:text-gray-600">Studio</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Import CPU Document</span>
      </div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Import CPU Document</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Paste an authored Clinical Practice Unit document. Nothing is saved until you review the extraction and confirm.
        </p>
      </div>
      <CpuImporter practices={practiceOpts} domains={domainOpts} />
    </div>
  );
}
