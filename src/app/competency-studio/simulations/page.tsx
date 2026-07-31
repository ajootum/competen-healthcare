import Link from "next/link";
import { loadSimulations } from "@/lib/studio/simulations";
import SimulationManager from "@/app/super-admin/studio/simulations/SimulationManager";
import { studioGuard } from "../_studio-ui";

// CST-006 — Simulation Studio. The persistent, versioned scenario store (simulation_scenarios, migration
// 131): named, typed, competency-linked scenarios with a publish lifecycle. Delivery and AI-drafting live
// in the existing simulation runtime; the visual branching flow-builder is the next-phase layer.

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function StudioSimulationsPage() {
  const { admin, isSuper, hid } = await studioGuard();

  const sim = await loadSimulations(admin, hid, isSuper);
  const { data: compData } = await admin.from("framework_competencies").select("id, name, framework_domains(name, frameworks(name))").order("name").limit(2000);
  const options = ((compData ?? []) as any[]).map(c => {
    const ctx = c.framework_domains?.frameworks?.name ?? c.framework_domains?.name ?? null;
    return { id: c.id, label: ctx ? `${c.name} · ${ctx}` : c.name };
  });

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-indigo-500 uppercase tracking-widest mb-0.5">CST-006 · Simulation Studio</p>
          <h1 className="text-xl font-bold text-gray-900">Simulation Scenarios</h1>
          <p className="text-gray-400 text-sm mt-0.5">Author, version and govern simulation scenarios — mock codes, team sims, virtual patients — linked to competencies.</p>
        </div>
        <Link href="/super-admin/studio" className="text-xs font-semibold text-gray-500 hover:text-teal-700 border border-gray-200 rounded-lg px-3 py-2">← Studio</Link>
      </div>

      {!sim.provisioned ? (
        <div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6 text-sm text-amber-800">Run migration 131 (<code className="text-[11px]">simulation_scenarios</code>) to enable the Simulation Studio.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mb-5">
            {[
              { label: "Scenarios", value: sim.kpis.total, tone: "text-gray-900" },
              { label: "Published", value: sim.kpis.published, tone: "text-teal-600" },
              { label: "Draft", value: sim.kpis.draft, tone: "text-gray-500" },
              { label: "Competency-linked", value: sim.kpis.competencyLinked, tone: "text-gray-900" },
              { label: "Scenario types", value: sim.kpis.types, tone: "text-gray-900" },
            ].map(k => (
              <div key={k.label} className="bg-white rounded-xl border border-gray-100 p-3.5">
                <p className={`text-xl font-bold ${k.tone}`}>{k.value}</p>
                <p className="text-[10px] text-gray-400 font-medium mt-0.5">{k.label}</p>
              </div>
            ))}
          </div>

          {(sim.typeDist.length > 0 || sim.diffDist.length > 0) && (
            <div className="grid md:grid-cols-2 gap-5 mb-5">
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <h2 className="font-semibold text-gray-900 text-sm mb-3">By scenario type</h2>
                {sim.typeDist.length === 0 ? <p className="text-xs text-gray-400">No scenarios yet.</p> : (
                  <div className="flex flex-wrap gap-1.5">
                    {sim.typeDist.map(t => <span key={t.key} className="text-[11px] font-medium text-gray-600 bg-gray-50 border border-gray-100 rounded-full px-2.5 py-1">{t.label} <b className="text-gray-900">{t.n}</b></span>)}
                  </div>
                )}
              </div>
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <h2 className="font-semibold text-gray-900 text-sm mb-3">By difficulty</h2>
                {sim.diffDist.length === 0 ? <p className="text-xs text-gray-400">No scenarios yet.</p> : sim.diffDist.map(d => (
                  <div key={d.key} className="flex items-center gap-2.5 py-1.5">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                    <span className="text-xs text-gray-600 flex-1">{d.label}</span>
                    <span className="text-[11px] font-bold text-gray-700">{d.n}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <SimulationManager scenarios={sim.scenarios} competencyOptions={options} />
        </>
      )}
    </div>
  );
}
