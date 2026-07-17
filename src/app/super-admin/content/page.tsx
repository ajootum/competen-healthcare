import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import FrameworkActions from "./FrameworkActions";
import FrameworkLifecycle from "./FrameworkLifecycle";

const LIBRARY_STYLES: Record<string, { bg: string; badge: string; icon: string }> = {
  core:      { bg: "border-teal-100 bg-teal-50/30",    badge: "bg-teal-100 text-teal-700",    icon: "🏥" },
  specialty: { bg: "border-indigo-100 bg-indigo-50/30", badge: "bg-indigo-100 text-indigo-700", icon: "⚕️" },
  role:      { bg: "border-violet-100 bg-violet-50/30", badge: "bg-violet-100 text-violet-700", icon: "👤" },
};

export default async function ContentBuilderPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const { data: frameworks } = await admin
    .from("frameworks")
    .select(`
      id, name, library, sort_order, is_active, pub_status, version_num,
      framework_domains(
        id, name,
        framework_competencies(id)
      )
    `)
    .order("library")
    .order("sort_order")
    .returns<{
      id: string; name: string; library: string; sort_order: number;
      is_active: boolean; pub_status?: string | null; version_num?: number | null;
      framework_domains?: { id: string; name: string; framework_competencies?: { id: string }[] }[];
    }[]>();

  const grouped: Record<string, typeof frameworks> = { core: [], specialty: [], role: [] };
  for (const f of frameworks ?? []) {
    if (grouped[f.library]) grouped[f.library]!.push(f);
  }

  const totalDomains = (frameworks ?? []).reduce((s, f) => s + (f.framework_domains?.length ?? 0), 0);
  const totalComps = (frameworks ?? []).reduce((s, f) =>
    s + (f.framework_domains ?? []).reduce((d: number, dom: { framework_competencies?: {id:string}[] }) => d + (dom.framework_competencies?.length ?? 0), 0), 0);

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Framework Builder</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            {(frameworks ?? []).length} frameworks · {totalDomains} domains · {totalComps} competencies — all editable without code
          </p>
        </div>
        <FrameworkActions />
      </div>

      {(["core","specialty","role"] as const).map(lib => {
        const fws = grouped[lib] ?? [];
        if (!fws.length) return null;
        const style = LIBRARY_STYLES[lib];
        return (
          <div key={lib} className="mb-8">
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">
              {lib === "core" ? "Core Nursing" : lib === "specialty" ? "Specialty" : "Role-Based"} ({fws.length})
            </h2>
            <div className="flex flex-col gap-2">
              {fws.map(f => {
                const domCount = f.framework_domains?.length ?? 0;
                const compCount = (f.framework_domains ?? []).reduce((s: number, d: { framework_competencies?: {id:string}[] }) => s + (d.framework_competencies?.length ?? 0), 0);
                return (
                  <div key={f.id} className={`rounded-xl border ${style.bg} overflow-hidden`}>
                    <div className="flex items-center justify-between px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <span className="text-lg">{style.icon}</span>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-semibold text-gray-900 text-sm">{f.name}</p>
                            {!f.is_active && <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded">Inactive</span>}
                            {(f.version_num ?? 0) > 0 && (
                              <span className="text-[10px] bg-gray-100 text-gray-500 font-semibold px-1.5 py-0.5 rounded">v{f.version_num}</span>
                            )}
                          </div>
                          <p className="text-[10px] text-gray-400 mt-0.5">{domCount} domains · {compCount} competencies</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        <FrameworkLifecycle frameworkId={f.id} initialStatus={f.pub_status} />
                        <Link href={`/super-admin/content/${f.id}`}
                          className="px-3 py-1.5 text-xs font-semibold bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors shrink-0">
                          Configure →
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {!(frameworks ?? []).length && (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <p className="text-3xl mb-3">🪪</p>
          <p className="text-gray-500 text-sm">No frameworks yet. Click &quot;+ Add Framework&quot; to create your first.</p>
        </div>
      )}
    </div>
  );
}
