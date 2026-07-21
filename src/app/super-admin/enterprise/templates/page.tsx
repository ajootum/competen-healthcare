import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadTemplateDirectory } from "@/lib/enterprise/templates";
import TemplateDirectory from "./TemplateDirectory";

export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function TemplatesModule() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const { rows, summary } = await loadTemplateDirectory(admin);

  return (
    <div data-wide className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Link href="/super-admin/enterprise" className="hover:text-teal-700">Enterprise Administration</Link><span>/</span><span className="text-gray-600">Enterprise Templates</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mt-0.5">Enterprise Templates</h1>
        <p className="text-sm text-gray-500">Create and deploy reusable templates for structure, roles and configurations.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { label: "Templates", n: summary.total, tone: "text-gray-900" },
          { label: "Published", n: summary.published, tone: "text-green-600" },
          { label: "In progress", n: summary.draft, tone: "text-amber-600" },
          { label: "Retired", n: summary.retired, tone: "text-gray-400" },
          { label: "Types", n: summary.types, tone: "text-violet-600" },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className={`text-2xl font-bold tabular-nums ${k.tone}`}>{k.n}</p>
            <p className="text-[11px] text-gray-500 mt-0.5">{k.label}</p>
          </div>
        ))}
      </div>

      <TemplateDirectory rows={rows} />
    </div>
  );
}
