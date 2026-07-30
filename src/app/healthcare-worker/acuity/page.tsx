import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { loadMyAssessments, ACUITY_FRAMEWORKS } from "@/lib/hww/assessments";
import { titleCase, fmtWhen, AcuityChip, StatCard, SectionCard, Empty, Chip } from "@/lib/hww/kit";
import AcuityForm from "./AcuityForm";

// Acuity Assessment (HWW-WARD-001 §4 / HWW-ICU-001 §6) — the nurse's
// reassessment surface: current acuity per assigned patient with full scoring
// history, significant-change flags, and repeated capture through the shift.
// Ward and ICU instruments in one module; the ICU variant is the default for
// patients in critical-care beds. Server-rendered over migration 153.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

export default async function AcuityPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const data = await loadMyAssessments(admin, user.id);

  const latest = (pid: string) => (data.acuityByPatient.get(pid) ?? [])[0] ?? null;
  const history = (pid: string) => (data.acuityByPatient.get(pid) ?? []).slice(0, 6);
  const latestAll = data.patients.map(p => latest(p.id)).filter(Boolean);
  const reassessed24h = data.acuityReassessed24h;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Acuity Assessment</h1>
        <p className="text-sm text-gray-500 mt-1">Competen Ward &amp; ICU acuity instruments — six domains scored 0–3, repeated through the shift with full history.</p>
      </div>

      {data.migrationMissing && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          <p className="font-semibold text-amber-900">⚙️ Store not yet enabled</p>
          <p className="text-sm text-amber-800 mt-1">Apply migration <code className="bg-amber-100 px-1.5 py-0.5 rounded font-mono text-xs">153-acuity-workload-assessments.sql</code> to enable assessments.</p>
        </div>
      )}

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard icon="🧑‍⚕️" title="My Patients" value={data.patients.length} sub={`${latestAll.length} with an acuity score`} />
        <StatCard icon="🌡️" title="High / Critical" value={latestAll.filter((a: any) => ["high", "critical"].includes(a.level)).length}
          tone={latestAll.some((a: any) => a.level === "critical") ? "text-red-600" : undefined} sub="by latest assessment" />
        <StatCard icon="⚡" title="Significant Changes" value={latestAll.filter((a: any) => a.significant_change).length}
          tone={latestAll.some((a: any) => a.significant_change) ? "text-orange-600" : undefined} sub="latest assessment vs prior" />
        <StatCard icon="🔁" title="Reassessments (24h)" value={reassessed24h} sub="across my patients" />
      </div>

      <SectionCard icon="🌡️" title="My Patients" count={data.patients.length}>
        {data.patients.length === 0 ? (
          <Empty>No active patient assignments. Your coordinator allocates patients in the Clinical Operations Centre.</Empty>
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
                    <AcuityChip level={p.acuity_level} />
                    {p.default_framework === "icu" && <Chip tone="bg-sky-100 text-sky-700">ICU bed</Chip>}
                    {a?.significant_change && <Chip tone="bg-orange-100 text-orange-700">Significant change</Chip>}
                    <span className="ml-auto" />
                    <AcuityForm patientId={p.id} patientLabel={p.label} defaultFramework={p.default_framework} />
                  </div>
                  {a ? (
                    <div className="mt-1.5 text-sm text-gray-600 flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span>Latest: <span className="font-bold tabular-nums text-gray-900">{a.score}</span><span className="text-gray-400">/18</span> · {ACUITY_FRAMEWORKS[a.framework]?.label ?? titleCase(a.framework)}</span>
                      <span className="text-xs text-gray-400">{a.assessed_by_name ?? "—"} · {fmtWhen(a.assessed_at)}</span>
                      {h.length > 1 && (
                        <span className="text-xs text-gray-400 tabular-nums">
                          History: {h.slice().reverse().map((x: any) => x.score).join(" → ")}
                        </span>
                      )}
                      {a.notes && <span className="text-xs text-gray-400 italic w-full">“{a.notes}”</span>}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 mt-1">No acuity assessment recorded yet — the operational level ({titleCase(p.acuity_level)}) is the coordinator&apos;s coarse rating. Record the first scored assessment.</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      <p className="text-center text-[11px] text-gray-400 pt-1">
        Recording an assessment updates the patient&apos;s acuity level across every workspace. Significant changes (≥4 points or level change) notify your supervisor for assignment review.
      </p>
    </div>
  );
}
