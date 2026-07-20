import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

// Improvement Plans (QAS-004) — corrective/preventive actions (CAPA) and QI projects.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const prBadge: Record<string, string> = { critical: "bg-red-100 text-red-700", high: "bg-orange-100 text-orange-700", medium: "bg-yellow-100 text-yellow-700", low: "bg-gray-100 text-gray-500" };
const stBadge: Record<string, string> = { open: "bg-amber-100 text-amber-700", in_progress: "bg-blue-100 text-blue-700", completed: "bg-green-100 text-green-700", verified: "bg-teal-100 text-teal-700", closed: "bg-gray-100 text-gray-500" };

export default async function ImprovementPlansPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "super_admin", "assessor"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin"); const hid = profile?.hospital_id ?? null;
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const today = new Date().toISOString().slice(0, 10);

  const { data: capa } = await scope(admin.from("capa_actions").select("id, title, priority, status, due_date, owner_name").order("created_at", { ascending: false }).limit(200));
  const { data: projects } = await scope(admin.from("improvement_objects").select("id, code, title, status, aim_statement, target_date").order("created_at", { ascending: false }).limit(100));
  const actions = capa ?? [];
  const card = "bg-white rounded-xl border border-gray-200 p-5";

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Improvement Plans</h1>
          <p className="text-sm text-gray-500 mt-1">Corrective &amp; preventive actions and quality-improvement projects.</p>
        </div>
        <Link href="/admin/quality" className="shrink-0 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg px-4 py-2">Quality workspace →</Link>
      </div>

      <div className={card}>
        <h3 className="font-semibold text-gray-900 mb-3">Corrective &amp; preventive actions ({actions.length})</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-500 border-b"><th className="py-2 pr-3">Action</th><th className="pr-3">Priority</th><th className="pr-3">Owner</th><th className="pr-3">Due</th><th>Status</th></tr></thead>
            <tbody>
              {actions.length === 0 && <tr><td colSpan={5} className="py-3 text-gray-400">No corrective actions.</td></tr>}
              {actions.map((c: any) => {
                const overdue = c.due_date && c.due_date < today && !["completed", "verified", "closed"].includes(c.status);
                return (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="py-2.5 pr-3 font-medium text-gray-800">{c.title}</td>
                    <td className="pr-3"><span className={`text-[10px] px-2 py-0.5 rounded-full ${prBadge[c.priority] ?? "bg-gray-100 text-gray-500"}`}>{c.priority}</span></td>
                    <td className="pr-3 text-xs text-gray-400">{c.owner_name ?? "—"}</td>
                    <td className={`pr-3 text-xs ${overdue ? "text-red-600 font-medium" : "text-gray-500"}`}>{c.due_date ?? "—"}{overdue ? " · overdue" : ""}</td>
                    <td><span className={`text-[10px] px-2 py-0.5 rounded-full ${stBadge[c.status] ?? "bg-gray-100 text-gray-500"}`}>{(c.status ?? "").replace(/_/g, " ")}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {(projects ?? []).length > 0 && (
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Quality-improvement projects ({(projects ?? []).length})</h3>
          <div className="divide-y">
            {(projects ?? []).map((p: any) => (
              <div key={p.id} className="py-2.5">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-800 text-sm">{p.title}</span>
                  <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full ${stBadge[p.status] ?? "bg-gray-100 text-gray-500"}`}>{(p.status ?? "").replace(/_/g, " ")}</span>
                </div>
                {p.aim_statement && <p className="text-xs text-gray-500 mt-1">{p.aim_statement}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
