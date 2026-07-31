import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadDependencies } from "@/lib/studio/dependencies";
import DependencyManager from "./DependencyManager";

// CST-105 — Competency Dependency Manager. Defines and governs prerequisite / co-requisite /
// recommended / inherited relationships between competencies (the progression graph). Reads the
// competency_dependencies store (migration 128) via loadDependencies, surfaces the type distribution
// and — critically — any prerequisite CYCLES, and lets an authoriser add/remove dependencies.

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function StudioDependenciesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles = (profile?.roles?.length ? profile.roles : [profile?.role]) as (string | null)[];
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const dep = await loadDependencies(admin, profile?.hospital_id ?? null, true);
  const { data: compData } = await admin.from("framework_competencies").select("id, name, framework_domains(name, frameworks(name))").order("name").limit(2000);
  const options = ((compData ?? []) as any[]).map(c => {
    const ctx = c.framework_domains?.frameworks?.name ?? c.framework_domains?.name ?? null;
    return { id: c.id, label: ctx ? `${c.name} · ${ctx}` : c.name };
  });

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-rose-500 uppercase tracking-widest mb-0.5">CST-105 · Dependency Manager</p>
          <h1 className="text-xl font-bold text-gray-900">Competency Dependencies</h1>
          <p className="text-gray-400 text-sm mt-0.5">Prerequisite, co-requisite, recommended and inherited relationships — the progression graph, cycle-checked.</p>
        </div>
        <Link href="/super-admin/studio" className="text-xs font-semibold text-gray-500 hover:text-teal-700 border border-gray-200 rounded-lg px-3 py-2">← Studio</Link>
      </div>

      {!dep.provisioned ? (
        <div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6 text-sm text-amber-800">Run migration 128 (<code className="text-[11px]">competency_dependencies</code>) to enable the Dependency Manager.</div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 mb-5">
            {[
              { label: "Dependencies", value: dep.kpis.total, tone: "text-gray-900" },
              { label: "Prerequisites", value: dep.kpis.prerequisite, tone: "text-[var(--cmp-text-information)]" },
              { label: "Co-requisites", value: dep.kpis.co_requisite, tone: "text-[var(--cmp-text-warning)]" },
              { label: "Recommended", value: dep.kpis.recommended, tone: "text-teal-600" },
              { label: "Inherited", value: dep.kpis.inherited, tone: "text-violet-600" },
              { label: "Competencies w/ deps", value: dep.kpis.sourced, tone: "text-gray-900" },
              { label: "Cycles", value: dep.kpis.cycles, tone: dep.kpis.cycles > 0 ? "text-[var(--cmp-text-critical)]" : "text-gray-300" },
            ].map(k => (
              <div key={k.label} className="bg-white rounded-xl border border-gray-100 p-3.5">
                <p className={`text-xl font-bold ${k.tone}`}>{k.value}</p>
                <p className="text-[10px] text-gray-400 font-medium mt-0.5">{k.label}</p>
              </div>
            ))}
          </div>

          {/* Cycle warnings */}
          {dep.cycles.length > 0 && (
            <div className="bg-[var(--cmp-surface-critical)] border border-[var(--cmp-color-critical)] rounded-xl p-4 mb-5">
              <p className="text-xs font-bold text-[var(--cmp-text-critical)] uppercase tracking-widest mb-2">⚠️ Prerequisite cycles detected</p>
              <div className="flex flex-col gap-1">
                {dep.cycles.map((chain, i) => (
                  <p key={i} className="text-xs text-red-800">{chain.join("  →  ")}</p>
                ))}
              </div>
              <p className="text-[10px] text-red-500 mt-2">These make progression impossible to satisfy — remove one edge in each loop. (New cycles are blocked on write; these predate the check or came from imports.)</p>
            </div>
          )}

          {/* Type distribution + equivalency cross-ref */}
          <div className="grid md:grid-cols-3 gap-5 mb-5">
            <div className="bg-white rounded-xl border border-gray-100 p-5 md:col-span-2">
              <h2 className="font-semibold text-gray-900 text-sm mb-3">By relationship type</h2>
              {dep.distribution.length === 0 ? (
                <p className="text-xs text-gray-400">No dependencies defined yet.</p>
              ) : dep.distribution.map(d => {
                const pct = dep.kpis.total ? Math.round((d.n / dep.kpis.total) * 100) : 0;
                return (
                  <div key={d.type} className="flex items-center gap-3 py-1.5">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                    <span className="text-xs text-gray-600 w-32">{d.label}</span>
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: d.color }} /></div>
                    <span className="text-[11px] font-bold text-gray-600 w-8 text-right">{d.n}</span>
                  </div>
                );
              })}
            </div>
            <Link href="/competency-office/recognition" className="bg-white rounded-xl border border-gray-100 p-5 hover:border-teal-200 transition-colors block">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Cross-reference</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{dep.kpis.equivalencies}</p>
              <p className="text-xs text-gray-500 mt-0.5">Equivalency rules</p>
              <p className="text-[10px] text-gray-400 mt-2">Equivalency &amp; recognition is governed separately in Mobility &amp; Recognition (COMP-024) →</p>
            </Link>
          </div>

          <DependencyManager options={options} rows={dep.rows} />
        </>
      )}
    </div>
  );
}
