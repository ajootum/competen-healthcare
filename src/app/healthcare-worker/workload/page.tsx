import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { loadMyAssessments, OVERLOAD_THRESHOLD } from "@/lib/hww/assessments";
import { titleCase, fmtWhen, StatCard, SectionCard, Empty, Chip, card } from "@/lib/hww/kit";
import NasForm from "./NasForm";
import Ward12Form from "./Ward12Form";

// Workload Assessment v2 (HWW-WARD-WKL-001 / HWW-ICU-WKL-001 / UNIT-ASM-001)
// — the tool resolves from each patient's care location: ward patients get
// the 12-domain Ward Workload (0-3 each + modifiers -> W1-W5 + ratio), ICU
// patients get NAS (Miranda activities -> I1-I5 + ratio). Professional
// overrides carry their reason. The nurse's cumulative load aggregates the
// latest percentage per assigned patient.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

const LEVEL_TONE: Record<string, string> = {
  W1: "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]", W2: "bg-lime-100 text-lime-700", W3: "bg-[var(--cmp-surface-warning)] text-yellow-800", W4: "bg-[var(--cmp-surface-warning)] text-orange-700", W5: "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]",
  I1: "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]", I2: "bg-lime-100 text-lime-700", I3: "bg-[var(--cmp-surface-warning)] text-yellow-800", I4: "bg-[var(--cmp-surface-warning)] text-orange-700", I5: "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]",
};

function WorkloadChip({ w }: { w: any }) {
  const effective = w.override_level || w.level;
  if (effective) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Chip tone={LEVEL_TONE[effective] ?? "bg-gray-100 text-gray-500"}>
          {w.framework === "ward12" ? `${w.score} pts` : `${Number(w.percentage).toFixed(0)}%`} · {effective}{w.ratio ? ` · ${w.ratio}` : ""}
        </Chip>
        {w.override_level && <Chip tone="bg-purple-100 text-purple-700">Override: {w.override_level}</Chip>}
      </span>
    );
  }
  return <Chip tone="bg-gray-100 text-gray-500">{Number(w.percentage).toFixed(0)}% (legacy)</Chip>;
}

export default async function WorkloadPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const data = await loadMyAssessments(admin, user.id);

  const latest = (pid: string) => (data.workloadByPatient.get(pid) ?? [])[0] ?? null;
  const history = (pid: string) => (data.workloadByPatient.get(pid) ?? []).slice(0, 6);
  const assessedCount = data.patients.filter(p => latest(p.id)).length;
  const agg = data.aggregate;
  const barPct = Math.min(100, (agg.total / Math.max(OVERLOAD_THRESHOLD, agg.total)) * 100);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Workload Assessment</h1>
        <p className="text-sm text-gray-500 mt-1">The right tool, automatically: 12-domain Ward Workload (W1–W5) on the ward, NAS (I1–I5) in ICU — each with staffing-ratio guidance.</p>
      </div>

      {data.migrationMissing && (
        <div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-5">
          <p className="font-semibold text-amber-900">⚙️ Store not yet enabled</p>
          <p className="text-sm text-amber-800 mt-1">Apply migrations <code className="bg-[var(--cmp-surface-warning)] px-1.5 py-0.5 rounded font-mono text-xs">153</code> + <code className="bg-[var(--cmp-surface-warning)] px-1.5 py-0.5 rounded font-mono text-xs">157</code> to enable assessments.</p>
        </div>
      )}

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard icon="⚖️" title="My Cumulative Load" value={`${agg.total.toFixed(1)}%`}
          tone={agg.overloaded ? "text-[var(--cmp-text-critical)]" : agg.total > 80 ? "text-[var(--cmp-text-warning)]" : undefined}
          sub={agg.overloaded ? <span className="text-[var(--cmp-text-critical)] font-medium">Over {OVERLOAD_THRESHOLD}% — rebalancing signalled</span> : "of one nurse's capacity"} />
        <StatCard icon="🧑‍⚕️" title="Patients Assessed" value={`${assessedCount}/${data.patients.length}`} sub="latest workload on record" />
        <StatCard icon="📊" title="Highest Level" value={(() => {
          const levels = data.patients.map(p => latest(p.id)).filter(Boolean).map((w: any) => w.override_level || w.level).filter(Boolean);
          return levels.sort().reverse()[0] ?? "—";
        })()} sub="across my patients (override honoured)" />
        <StatCard icon="🔁" title="Reassessments (24h)" value={data.workloadReassessed24h} sub="across my patients" />
      </div>

      <div className={card}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Cumulative load vs one-nurse capacity</span>
          <span className={`text-sm font-bold tabular-nums ${agg.overloaded ? "text-[var(--cmp-text-critical)]" : "text-gray-900"}`}>{agg.total.toFixed(1)}% / {OVERLOAD_THRESHOLD}%</span>
        </div>
        <div className="h-3 rounded-full bg-gray-100 overflow-hidden">
          <div className={`h-full rounded-full ${agg.overloaded ? "bg-[var(--cmp-color-critical)]" : agg.total > 80 ? "bg-[var(--cmp-color-warning)]" : "bg-[var(--cmp-color-success)]"}`} style={{ width: `${barPct}%` }} />
        </div>
        <p className="text-[11px] text-gray-400 mt-2">Sum of the latest workload percentage per assigned patient (ward scores normalised against the 36-point domain maximum). Exceeding one nurse&apos;s capacity signals rebalancing.</p>
      </div>

      <SectionCard icon="⚖️" title="My Patients" count={data.patients.length}>
        {data.patients.length === 0 ? (
          <Empty>No active patient assignments.</Empty>
        ) : (
          <div className="divide-y divide-gray-100">
            {data.patients.map((p: any) => {
              const w = latest(p.id);
              const h = history(p.id);
              return (
                <div key={p.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-800">{p.label}</span>
                    {p.bed && <span className="text-xs text-gray-400">{p.bed}</span>}
                    <Chip tone={p.unit_type === "icu" ? "bg-[var(--cmp-surface-information)] text-[var(--cmp-text-information)]" : "bg-[var(--cmp-surface-success)] text-emerald-700"}>{p.tools.workloadLabel}</Chip>
                    {w && <WorkloadChip w={w} />}
                    <span className="ml-auto" />
                    {p.unit_type === "icu"
                      ? <NasForm patientId={p.id} patientLabel={p.label} />
                      : <Ward12Form patientId={p.id} patientLabel={p.label} />}
                  </div>
                  {w ? (
                    <div className="mt-1 text-xs text-gray-400 flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span>{w.assessed_by_name ?? "—"} · {fmtWhen(w.assessed_at)}</span>
                      {w.override_reason && <span className="text-purple-600">Override: {w.override_reason}</span>}
                      {h.length > 1 && <span className="tabular-nums">History: {h.slice().reverse().map((x: any) => x.level ?? `${Number(x.percentage).toFixed(0)}%`).join(" → ")}</span>}
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
        {titleCase("workload")} feeds the Assignment &amp; Workload Engine: levels carry staffing-ratio guidance (W1 1:6 → W5 1:2; I1 1:3 → I5 dedicated 1:1) and level changes trigger assignment review. Overrides always carry their professional-judgement reason.
      </p>
    </div>
  );
}
