import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

const LIBRARY_LABELS: Record<string, string> = {
  core:     "Core Nursing",
  specialty: "Specialty",
  role:     "Role-Based",
};

const LIBRARY_COLORS: Record<string, string> = {
  core:      "border-teal-100 bg-teal-50/40",
  specialty: "border-indigo-100 bg-indigo-50/40",
  role:      "border-violet-100 bg-violet-50/40",
};

const LIBRARY_BADGE: Record<string, string> = {
  core:      "text-teal-600",
  specialty: "text-indigo-600",
  role:      "text-violet-600",
};

export default async function CompetencyLibraryPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const { data: frameworks } = await admin
    .from("frameworks")
    .select("id, name, library, sort_order, framework_domains(id, name, framework_competencies(id))")
    .eq("is_active", true)
    .order("library")
    .order("sort_order");

  const grouped: Record<string, typeof frameworks> = {};
  for (const f of frameworks ?? []) {
    if (!grouped[f.library]) grouped[f.library] = [];
    grouped[f.library]!.push(f);
  }

  const totalDomains = (frameworks ?? []).reduce((s, f) => s + (f.framework_domains?.length ?? 0), 0);
  const totalComps = (frameworks ?? []).reduce((s, f) =>
    s + (f.framework_domains ?? []).reduce((d, dom) => d + (dom.framework_competencies?.length ?? 0), 0), 0);

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Global Competency Library</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            {(frameworks ?? []).length} frameworks · {totalDomains} domains · {totalComps} competencies
          </p>
        </div>
        <Link href="/super-admin/content"
          className="bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors shrink-0">
          + Add / edit competencies
        </Link>
      </div>

      {Object.entries(grouped).map(([library, fws]) => (
        <div key={library} className="mb-8">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">
            {LIBRARY_LABELS[library] ?? library} ({fws?.length ?? 0})
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(fws ?? []).map(f => {
              const domainCount = f.framework_domains?.length ?? 0;
              const compCount = (f.framework_domains ?? []).reduce((s, d) => s + (d.framework_competencies?.length ?? 0), 0);
              return (
                <Link key={f.id} href={`/super-admin/content/${f.id}`}
                  className={`rounded-xl border p-4 hover:shadow-sm transition-shadow group ${LIBRARY_COLORS[library] ?? "border-gray-100"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className={`text-[9px] font-bold uppercase tracking-wider ${LIBRARY_BADGE[library] ?? "text-gray-400"}`}>
                        {LIBRARY_LABELS[library] ?? library}
                      </span>
                      <p className="font-semibold text-gray-900 text-sm mt-0.5">{f.name}</p>
                    </div>
                    <span className="text-xs text-teal-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">Edit →</span>
                  </div>
                  <div className="flex gap-3 mt-2 text-xs text-gray-500">
                    <span>{domainCount} domains</span>
                    <span>·</span>
                    <span>{compCount} competencies</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      ))}

      {!frameworks?.length && (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <p className="text-3xl mb-3">🪪</p>
          <p className="text-gray-500 text-sm">No frameworks found. Run migration 004-seed-frameworks.sql.</p>
        </div>
      )}
    </div>
  );
}
