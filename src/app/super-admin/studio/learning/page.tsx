import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadLearningPaths } from "@/lib/studio/learning-paths";
import { requireHqCapability } from "@/lib/hq/context";

// CST-005 — Learning Path Studio. A Studio view over the authored learning structures: curricula
// (programmes) with their competency and module counts, the governed learning-resource library by type,
// and competency→learning coverage. Read on demand from the real stores (curricula/modules mig 016,
// learning_resources mig 014). Module sequencing is authored in the curriculum builder; a visual
// drag-drop path sequencer is the next-phase layer.

export const dynamic = "force-dynamic";

export default async function StudioLearningPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  await requireHqCapability("hq.learning.studio.view");

  const lp = await loadLearningPaths(admin, profile?.hospital_id ?? null, true);

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-rose-500 uppercase tracking-widest mb-0.5">CST-005 · Learning Path Studio</p>
          <h1 className="text-xl font-bold text-gray-900">Learning Paths &amp; Curricula</h1>
          <p className="text-gray-500 text-sm mt-0.5">Reusable programmes, the learning-resource library and competency coverage — the learning side of the Studio.</p>
        </div>
        <Link href="/admin/resources" className="text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-lg px-3 py-2">Resource library →</Link>
      </div>

      {!lp.provisioned ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-500">Learning tables are not available in this environment.</div>
      ) : lp.empty ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-500">No curricula or learning resources yet — author them in the <Link href="/admin/resources" className="text-teal-600 hover:underline">resource library</Link>.</div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mb-5">
            {[
              { label: "Curricula / programmes", value: lp.kpis.curricula, tone: "text-gray-900" },
              { label: "Learning resources", value: lp.kpis.resources, tone: "text-gray-900" },
              { label: "Curriculum modules", value: lp.kpis.modules, tone: "text-gray-900" },
              { label: "Competency coverage", value: `${lp.kpis.coverage}%`, tone: lp.kpis.coverage >= 50 ? "text-teal-600" : "text-[var(--cmp-text-warning)]" },
              { label: "Active pathways", value: lp.kpis.activePathways, tone: "text-gray-900" },
            ].map(k => (
              <div key={k.label} className="bg-white rounded-xl border border-gray-100 p-3.5">
                <p className={`text-xl font-bold ${k.tone}`}>{k.value}</p>
                <p className="text-[10px] text-gray-500 font-medium mt-0.5">{k.label}</p>
              </div>
            ))}
          </div>

          <div className="grid md:grid-cols-3 gap-5 mb-5">
            {/* Programmes */}
            <div className="bg-white rounded-xl border border-gray-100 p-5 md:col-span-2">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-gray-900 text-sm">Programmes</h2>
                <span className="text-[9px] text-gray-500">authored curricula — competency &amp; module counts</span>
              </div>
              {lp.programmes.length === 0 ? (
                <p className="text-xs text-gray-500">No curricula authored yet.</p>
              ) : (
                <div className="flex flex-col divide-y divide-gray-50">
                  {lp.programmes.map(p => (
                    <div key={p.id} className="flex items-center gap-3 py-2 text-xs">
                      <span className="font-semibold text-gray-800 truncate max-w-[40%]">{p.title}</span>
                      <span className="text-[10px] font-semibold text-gray-500 bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5 shrink-0">{p.typeLabel}</span>
                      {p.targetRole && <span className="text-[10px] text-gray-500 truncate hidden md:inline">{p.targetRole}</span>}
                      <span className="ml-auto flex items-center gap-2 text-[10px] text-gray-500 shrink-0">
                        <span>{p.competencies} comp</span>
                        <span>{p.modules} module{p.modules === 1 ? "" : "s"}</span>
                        {p.durationWeeks ? <span>{p.durationWeeks}w</span> : null}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Resource types */}
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h2 className="font-semibold text-gray-900 text-sm mb-3">Resource library</h2>
              {lp.resourceTypes.length === 0 ? <p className="text-xs text-gray-500">No resources yet.</p> : lp.resourceTypes.map(t => (
                <div key={t.key} className="flex items-center gap-2.5 py-1.5">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                  <span className="text-xs text-gray-600 flex-1">{t.label}</span>
                  <span className="text-[11px] font-bold text-gray-700">{t.n}</span>
                </div>
              ))}
              <p className="text-[10px] text-gray-500 mt-3">{lp.coverageDetail.covered} of {lp.coverageDetail.total} competencies have a linked learning resource.</p>
            </div>
          </div>

          <div className="bg-teal-50 border border-teal-100 rounded-xl p-4">
            <p className="text-[11px] text-teal-900">
              <span className="font-bold">Learning consolidation.</span> Programmes and their sequenced modules are authored in the curriculum builder and resource library; competencies map to resources via the governed library. A visual drag-drop path sequencer that composes adaptive, prerequisite-gated pathways from one canvas is the next-phase authoring layer.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
