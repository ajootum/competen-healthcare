import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import MethodsManager from "./MethodsManager";

const METHOD_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  knowledge:            { label: "Knowledge Assessment",    icon: "📝", color: "bg-blue-50 text-blue-700" },
  direct_observation:   { label: "Direct Observation",      icon: "👁️",  color: "bg-teal-50 text-teal-700" },
  simulation:           { label: "Simulation",              icon: "🎮", color: "bg-violet-50 text-violet-700" },
  osce:                 { label: "OSCE",                    icon: "🏥", color: "bg-rose-50 text-rose-700" },
  concurrent_audit:     { label: "Concurrent Audit",        icon: "📋", color: "bg-amber-50 text-amber-700" },
  retrospective_audit:  { label: "Retrospective/Chart Audit",icon: "🗂️", color: "bg-orange-50 text-orange-700" },
  logbook:              { label: "Logbook",                 icon: "📓", color: "bg-indigo-50 text-indigo-700" },
};

export default async function AssessmentMethodsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const { data: methods } = await admin
    .from("assessment_method_configs")
    .select("id, method, is_required, min_assessors, weight, is_active, frameworks(name), framework_competencies(name)")
    .eq("is_active", true)
    .order("method");

  const { data: frameworks } = await admin.from("frameworks").select("id, name").order("name");

  // Group by scope
  const byFramework: Record<string, typeof methods> = {};
  const byCompetency: Record<string, typeof methods> = {};
  for (const m of methods ?? []) {
    const fw = m.frameworks as unknown as { name: string } | null;
    const comp = m.framework_competencies as unknown as { name: string } | null;
    if (fw?.name) {
      const k = fw.name;
      if (!byFramework[k]) byFramework[k] = [];
      byFramework[k]!.push(m);
    } else if (comp?.name) {
      const k = comp.name;
      if (!byCompetency[k]) byCompetency[k] = [];
      byCompetency[k]!.push(m);
    }
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Assessment Methods</h1>
          <p className="text-gray-400 text-sm mt-0.5">Configure which of the 7 methods apply to each framework or competency</p>
        </div>
        <MethodsManager frameworks={frameworks ?? []} />
      </div>

      {/* Method cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-8">
        {Object.entries(METHOD_LABELS).map(([key, { label, icon, color }]) => {
          const count = (methods ?? []).filter(m => m.method === key).length;
          return (
            <div key={key} className={`rounded-xl border border-transparent ${color} p-3`}>
              <div className="text-xl mb-1">{icon}</div>
              <p className="text-xs font-semibold leading-tight">{label}</p>
              <p className="text-[10px] opacity-60 mt-1">{count} config{count !== 1 ? "s" : ""}</p>
            </div>
          );
        })}
      </div>

      {/* Framework-level configs */}
      {Object.keys(byFramework).length > 0 && (
        <div className="mb-6">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Framework-level configurations</h2>
          <div className="flex flex-col gap-2">
            {Object.entries(byFramework).map(([fw, configs]) => (
              <div key={fw} className="bg-white rounded-xl border border-gray-100 px-5 py-3">
                <p className="text-sm font-semibold text-gray-800 mb-2">{fw}</p>
                <div className="flex flex-wrap gap-2">
                  {(configs ?? []).map(c => {
                    const m = METHOD_LABELS[c.method] ?? { label: c.method, icon: "•", color: "bg-gray-100 text-gray-500" };
                    return (
                      <div key={c.id} className={`flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-lg ${m.color}`}>
                        <span>{m.icon}</span>
                        <span className="font-medium">{m.label}</span>
                        {c.is_required && <span className="font-bold">*</span>}
                        <span className="opacity-60">×{c.weight}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!(methods ?? []).length && (
        <div className="bg-white rounded-xl border border-gray-100 p-10 text-center">
          <p className="text-2xl mb-2">🩺</p>
          <p className="text-gray-400 text-sm">No method configurations yet. Use &quot;+ Configure Method&quot; to assign assessment methods to frameworks.</p>
        </div>
      )}
    </div>
  );
}
