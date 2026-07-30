import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { loadMyAssessments } from "@/lib/hww/assessments";
import { PEWS_BANDS, A_LEVELS, acuityMaxFor } from "@/lib/hww/instruments";
import { titleCase, fmtWhen, AcuityChip, StatCard, SectionCard, Empty, Chip } from "@/lib/hww/kit";
import PewsForm from "./PewsForm";
import CiafForm from "./CiafForm";

// Acuity Assessment v2 (HWW-WARD-ACU-001 / HWW-ICU-ACU-001 / UNIT-ASM-001) —
// the tool is RESOLVED from each patient's care location: ward patients get
// rapid PEWS entry (0-15 + category-3 trigger -> colour band + reassessment
// timer), ICU patients get the CIAF composite (/100 -> A1-A5 + ratio). No
// manual tool selection; wrong tools are rejected server-side. Historical
// rows render under their original instrument.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

const A_TONE: Record<string, string> = { A1: "bg-green-100 text-green-700", A2: "bg-yellow-100 text-yellow-800", A3: "bg-orange-100 text-orange-700", A4: "bg-red-100 text-red-700", A5: "bg-red-100 text-red-700" };

function ClassificationChip({ a }: { a: any }) {
  if (a.framework === "pews") {
    const band = PEWS_BANDS.find(b => b.key === a.classification);
    return band ? <Chip tone={band.tone}>PEWS {a.score}{a.category3 ? " +cat3" : ""} · {band.label}</Chip> : null;
  }
  if (a.framework === "ciaf") {
    const lvl = A_LEVELS.find(l => l.level === a.classification);
    return <Chip tone={A_TONE[a.classification] ?? A_TONE.A1}>{a.score}/100 · {a.classification}{lvl ? ` ${lvl.label} · ${lvl.ratio}` : ""}</Chip>;
  }
  return <Chip tone="bg-gray-100 text-gray-500">{a.score}/18 · {titleCase(a.level)} (legacy)</Chip>;
}

export default async function AcuityPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const data = await loadMyAssessments(admin, user.id);

  const latest = (pid: string) => (data.acuityByPatient.get(pid) ?? [])[0] ?? null;
  const history = (pid: string) => (data.acuityByPatient.get(pid) ?? []).slice(0, 6);
  const latestAll = data.patients.map(p => latest(p.id)).filter(Boolean);
  const reassessOverdue = latestAll.filter((a: any) => a.reassess_by && +new Date(a.reassess_by) < data.loadedAt).length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Acuity Assessment</h1>
        <p className="text-sm text-gray-500 mt-1">The right tool, automatically: Ward PEWS for ward patients, the ICU Composite Acuity Framework for ICU patients.</p>
      </div>

      {data.migrationMissing && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          <p className="font-semibold text-amber-900">⚙️ Store not yet enabled</p>
          <p className="text-sm text-amber-800 mt-1">Apply migrations <code className="bg-amber-100 px-1.5 py-0.5 rounded font-mono text-xs">153</code> + <code className="bg-amber-100 px-1.5 py-0.5 rounded font-mono text-xs">157</code> to enable assessments.</p>
        </div>
      )}

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard icon="🧑‍⚕️" title="My Patients" value={data.patients.length} sub={`${latestAll.length} with a recorded assessment`} />
        <StatCard icon="🌡️" title="High / Critical" value={latestAll.filter((a: any) => ["high", "critical"].includes(a.level)).length}
          tone={latestAll.some((a: any) => a.level === "critical") ? "text-red-600" : undefined} sub="by latest classification" />
        <StatCard icon="⚡" title="Significant Changes" value={latestAll.filter((a: any) => a.significant_change).length}
          tone={latestAll.some((a: any) => a.significant_change) ? "text-orange-600" : undefined} sub="vs the prior reading" />
        <StatCard icon="⏰" title="Reassessment Overdue" value={reassessOverdue} tone={reassessOverdue > 0 ? "text-red-600" : undefined} sub="past the band's interval" />
      </div>

      <SectionCard icon="🌡️" title="My Patients" count={data.patients.length}>
        {data.patients.length === 0 ? (
          <Empty>No active patient assignments.</Empty>
        ) : (
          <div className="divide-y divide-gray-100">
            {data.patients.map((p: any) => {
              const a = latest(p.id);
              const h = history(p.id);
              const reassessDue = a?.reassess_by && +new Date(a.reassess_by) < data.loadedAt;
              return (
                <div key={p.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-800">{p.label}</span>
                    {p.bed && <span className="text-xs text-gray-400">{p.bed}</span>}
                    <AcuityChip level={p.acuity_level} />
                    <Chip tone={p.unit_type === "icu" ? "bg-sky-100 text-sky-700" : "bg-emerald-50 text-emerald-700"}>{p.tools.acuityLabel}</Chip>
                    {a?.significant_change && <Chip tone="bg-orange-100 text-orange-700">Significant change</Chip>}
                    {reassessDue && <Chip tone="bg-red-100 text-red-700">Reassessment overdue</Chip>}
                    <span className="ml-auto" />
                    {p.unit_type === "icu"
                      ? <CiafForm patientId={p.id} patientLabel={p.label} />
                      : <PewsForm patientId={p.id} patientLabel={p.label} />}
                  </div>
                  {a ? (
                    <div className="mt-1.5 text-sm text-gray-600 flex flex-wrap items-center gap-x-4 gap-y-1">
                      <ClassificationChip a={a} />
                      <span className="text-xs text-gray-400">{a.assessed_by_name ?? "—"} · {fmtWhen(a.assessed_at)}</span>
                      {a.reassess_by && <span className={`text-xs ${reassessDue ? "text-red-600 font-medium" : "text-gray-400"}`}>reassess by {fmtWhen(a.reassess_by)}</span>}
                      {h.length > 1 && (
                        <span className="text-xs text-gray-400 tabular-nums">
                          History: {h.slice().reverse().map((x: any) => `${x.score}/${acuityMaxFor(x.framework)}`).join(" → ")}
                        </span>
                      )}
                      {a.notes && <span className="text-xs text-gray-400 italic w-full">“{a.notes}”</span>}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 mt-1">No assessment recorded yet — the operational level ({titleCase(p.acuity_level)}) is the coordinator&apos;s coarse rating.</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      <p className="text-center text-[11px] text-gray-400 pt-1">
        PEWS: 0-1 routine · 2 early concern · 3 increased concern · 4 high risk · 5+ (or any category 3) critical, with band reassessment timers. CIAF: A1-A5 with staffing ratios. Each recording updates the patient&apos;s operational level everywhere; significant changes trigger assignment review.
      </p>
    </div>
  );
}
