import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { loadMyAssessments, WORKLOAD_FRAMEWORKS, OVERLOAD_THRESHOLD } from "@/lib/hww/assessments";
import { titleCase, fmtWhen, StatCard, SectionCard, Empty, Chip, card } from "@/lib/hww/kit";
import NasForm from "./NasForm";

// Workload Assessment (HWW-WARD-001 §4 / HWW-ICU-001 §7) — the nurse's NAS
// surface: per-patient Nursing Activities Score with history, and the nurse's
// CUMULATIVE load across assignments (sum of latest per-patient percentages;
// >100% of one nurse's capacity triggers a rebalancing signal). Ward workload
// components for non-ICU patients. Server-rendered over migration 153.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

export default async function WorkloadPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const data = await loadMyAssessments(admin, user.id);

  const latest = (pid: string) => (data.workloadByPatient.get(pid) ?? [])[0] ?? null;
  const history = (pid: string) => (data.workloadByPatient.get(pid) ?? []).slice(0, 6);
  const assessedCount = data.patients.filter(p => latest(p.id)).length;
  const reassessed24h = data.workloadReassessed24h;
  const agg = data.aggregate;
  const barPct = Math.min(100, (agg.total / Math.max(OVERLOAD_THRESHOLD, agg.total)) * 100);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Workload Assessment</h1>
        <p className="text-sm text-gray-500 mt-1">Nursing Activities Score (Miranda 2003) per patient, aggregated to your cumulative shift load.</p>
      </div>

      {data.migrationMissing && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          <p className="font-semibold text-amber-900">⚙️ Store not yet enabled</p>
          <p className="text-sm text-amber-800 mt-1">Apply migration <code className="bg-amber-100 px-1.5 py-0.5 rounded font-mono text-xs">153-acuity-workload-assessments.sql</code> to enable assessments.</p>
        </div>
      )}

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard icon="⚖️" title="My Cumulative Load" value={`${agg.total.toFixed(1)}%`}
          tone={agg.overloaded ? "text-red-600" : agg.total > 80 ? "text-orange-600" : undefined}
          sub={agg.overloaded ? <span className="text-red-600 font-medium">Over {OVERLOAD_THRESHOLD}% — rebalancing signalled</span> : "of one nurse's capacity"} />
        <StatCard icon="🧑‍⚕️" title="Patients Assessed" value={`${assessedCount}/${data.patients.length}`} sub="latest workload on record" />
        <StatCard icon="📊" title="Heaviest Patient" value={(() => {
          const scored = data.patients.map(p => ({ p, a: latest(p.id) })).filter(x => x.a);
          if (!scored.length) return "—";
          const top = scored.sort((x, y) => Number(y.a.percentage) - Number(x.a.percentage))[0];
          return `${Number(top.a.percentage).toFixed(0)}%`;
        })()} sub="single-patient NAS" />
        <StatCard icon="🔁" title="Reassessments (24h)" value={reassessed24h} sub="across my patients" />
      </div>

      {/* Cumulative load bar */}
      <div className={card}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Cumulative load vs one-nurse capacity</span>
          <span className={`text-sm font-bold tabular-nums ${agg.overloaded ? "text-red-600" : "text-gray-900"}`}>{agg.total.toFixed(1)}% / {OVERLOAD_THRESHOLD}%</span>
        </div>
        <div className="h-3 rounded-full bg-gray-100 overflow-hidden">
          <div className={`h-full rounded-full ${agg.overloaded ? "bg-red-500" : agg.total > 80 ? "bg-orange-400" : "bg-emerald-500"}`} style={{ width: `${barPct}%` }} />
        </div>
        <p className="text-[11px] text-gray-400 mt-2">Sum of the latest workload percentage for each patient currently assigned to you. NAS semantics: 100% ≈ the full capacity of one nurse per shift.</p>
      </div>

      <SectionCard icon="⚖️" title="My Patients" count={data.patients.length}>
        {data.patients.length === 0 ? (
          <Empty>No active patient assignments.</Empty>
        ) : (
          <div className="divide-y divide-gray-100">
            {data.patients.map((p: any) => {
              const a = latest(p.id);
              const h = history(p.id);
              return (
                <div key={p.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-800">{p.label}</span>
                    {p.bed && <span className="text-xs text-gray-400">{p.bed}</span>}
                    {p.default_framework === "icu" && <Chip tone="bg-sky-100 text-sky-700">ICU bed</Chip>}
                    {a && <span className={`text-sm font-bold tabular-nums ${Number(a.percentage) >= 80 ? "text-orange-600" : "text-gray-900"}`}>{Number(a.percentage).toFixed(1)}%</span>}
                    <span className="ml-auto" />
                    <NasForm patientId={p.id} patientLabel={p.label} defaultFramework={p.default_framework} />
                  </div>
                  {a ? (
                    <div className="mt-1 text-xs text-gray-400 flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span>{WORKLOAD_FRAMEWORKS[a.framework]?.label ?? titleCase(a.framework)} · {(a.items ?? []).length} items · {a.assessed_by_name ?? "—"} · {fmtWhen(a.assessed_at)}</span>
                      {h.length > 1 && <span className="tabular-nums">History: {h.slice().reverse().map((x: any) => Number(x.percentage).toFixed(0)).join(" → ")}%</span>}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 mt-1">No workload assessment yet — record the first one.</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      <p className="text-center text-[11px] text-gray-400 pt-1">
        Workload scores feed the Assignment &amp; Workload Engine: exceeding one nurse&apos;s capacity signals your supervisor to rebalance assignments.
      </p>
    </div>
  );
}
