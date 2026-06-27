import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import PolicyEditor from "./PolicyEditor";

export default async function PolicyManagerPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: policies } = await admin
    .from("policies")
    .select("id, title, policy_type, version, effective_date, review_date, is_active, created_at, hospitals(name), frameworks(name), departments(name)")
    .order("created_at", { ascending: false });

  const { data: frameworks } = await admin.from("frameworks").select("id, name").order("name");

  const TYPE_COLORS: Record<string, string> = {
    clinical: "bg-teal-50 text-teal-700",
    hr: "bg-blue-50 text-blue-700",
    safety: "bg-red-50 text-red-600",
    governance: "bg-indigo-50 text-indigo-700",
    infection_control: "bg-orange-50 text-orange-600",
    quality: "bg-violet-50 text-violet-700",
  };

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Policy Manager</h1>
          <p className="text-gray-400 text-sm mt-0.5">{(policies ?? []).length} policies — create, version, and link to frameworks or departments</p>
        </div>
        <PolicyEditor frameworks={frameworks ?? []} />
      </div>

      <div className="flex flex-col gap-3">
        {(policies ?? []).map(p => (
          <div key={p.id} className="bg-white rounded-xl border border-gray-100 px-5 py-4">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <p className="font-semibold text-gray-900">{p.title}</p>
                  <span className="text-[10px] text-gray-400">v{p.version}</span>
                  {!p.is_active && <span className="text-[10px] bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded">Inactive</span>}
                </div>
                <div className="flex flex-wrap gap-2 text-[10px] text-gray-400">
                  {(p.hospitals as unknown as { name: string } | null)?.name && <span>🏥 {(p.hospitals as unknown as { name: string }).name}</span>}
                  {(p.frameworks as unknown as { name: string } | null)?.name && <span>📋 {(p.frameworks as unknown as { name: string }).name}</span>}
                  {(p.departments as unknown as { name: string } | null)?.name && <span>🏢 {(p.departments as unknown as { name: string }).name}</span>}
                  {p.effective_date && <span>Effective: {new Date(p.effective_date).toLocaleDateString()}</span>}
                  {p.review_date && <span>Review: {new Date(p.review_date).toLocaleDateString()}</span>}
                </div>
              </div>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded capitalize ml-4 flex-shrink-0 ${TYPE_COLORS[p.policy_type] ?? "bg-gray-100 text-gray-500"}`}>
                {p.policy_type.replace("_", " ")}
              </span>
            </div>
          </div>
        ))}

        {!(policies ?? []).length && (
          <div className="bg-white rounded-xl border border-gray-100 p-10 text-center">
            <p className="text-2xl mb-2">📄</p>
            <p className="text-gray-400 text-sm">No policies yet — click &quot;+ New Policy&quot; to create one</p>
          </div>
        )}
      </div>
    </div>
  );
}
