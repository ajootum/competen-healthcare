import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

// Framework Manager (CPO-002) — the governed competency framework library (own +
// shared master), with version, lifecycle status and competency counts.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const statusBadge: Record<string, string> = {
  published: "bg-green-100 text-green-700", approved: "bg-blue-100 text-blue-700",
  in_review: "bg-amber-100 text-amber-700", draft: "bg-gray-100 text-gray-500", archived: "bg-gray-100 text-gray-400",
};
const libBadge: Record<string, string> = { core: "bg-teal-50 text-teal-700", specialty: "bg-purple-50 text-purple-700", role: "bg-indigo-50 text-indigo-700" };

export default async function FrameworkManagerPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "educator", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");
  const hid = profile?.hospital_id ?? null;

  const q = admin.from("frameworks").select("id, name, library, pub_status, hospital_id, version_major, version_minor, version_revision").order("library").order("name").limit(2000);
  const { data: fws } = await (isSuper ? q : q.or(`hospital_id.eq.${hid ?? NONE},hospital_id.is.null`));
  const frameworks = fws ?? [];

  // Competency counts per framework (framework → domains → competencies).
  const fwIds = frameworks.map((f: any) => f.id);
  const compByFw = new Map<string, number>();
  if (fwIds.length) {
    const { data: doms } = await admin.from("framework_domains").select("id, framework_id").in("framework_id", fwIds).limit(8000);
    const domToFw = new Map<string, string>((doms ?? []).map((d: any) => [d.id, d.framework_id]));
    const domIds = [...domToFw.keys()];
    if (domIds.length) {
      const { data: comps } = await admin.from("framework_competencies").select("domain_id").in("domain_id", domIds).limit(20000);
      for (const c of comps ?? []) { const fwId = domToFw.get(c.domain_id); if (fwId) compByFw.set(fwId, (compByFw.get(fwId) ?? 0) + 1); }
    }
  }

  const card = "bg-white rounded-xl border border-gray-200 p-5";
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Framework Manager</h1>
          <p className="text-sm text-gray-500 mt-1">Governed competency frameworks — Core, Specialty and Role libraries.</p>
        </div>
        <Link href="/admin/studio" className="shrink-0 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg px-4 py-2">Open Competency Studio →</Link>
      </div>

      <div className={card}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-500 border-b"><th className="py-2 pr-3">Framework</th><th className="pr-3">Library</th><th className="pr-3">Scope</th><th className="pr-3">Version</th><th className="pr-3">Competencies</th><th>Status</th></tr></thead>
            <tbody>
              {frameworks.length === 0 && <tr><td colSpan={6} className="py-3 text-gray-400">No frameworks in scope.</td></tr>}
              {frameworks.map((f: any) => (
                <tr key={f.id} className="border-b last:border-0">
                  <td className="py-2.5 pr-3 font-medium text-gray-800">{f.name}</td>
                  <td className="pr-3"><span className={`text-[10px] px-2 py-0.5 rounded-full ${libBadge[f.library] ?? "bg-gray-100 text-gray-500"}`}>{f.library}</span></td>
                  <td className="pr-3 text-xs text-gray-400">{f.hospital_id ? "Hospital" : "Master library"}</td>
                  <td className="pr-3 tabular-nums text-gray-500">v{f.version_major ?? 1}.{f.version_minor ?? 0}.{f.version_revision ?? 0}</td>
                  <td className="pr-3 tabular-nums text-gray-700">{compByFw.get(f.id) ?? 0}</td>
                  <td><span className={`text-[10px] px-2 py-0.5 rounded-full ${statusBadge[f.pub_status] ?? "bg-gray-100 text-gray-500"}`}>{(f.pub_status ?? "draft").replace(/_/g, " ")}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
