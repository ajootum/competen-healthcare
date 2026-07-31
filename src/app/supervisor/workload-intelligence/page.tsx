import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadWorkloadIntelligence } from "@/lib/operations/workload-intelligence";
import { cardClass } from "@/components/ui/primitives";

// Workforce Workload Intelligence (SSW-WFM-004) — the supervisor's view of the
// instrument data the bedside produces. HWW records Ward PEWS / ICU CIAF acuity
// and Ward-12 / NAS workload (migrations 153 + 157) and medication activity
// (154); until now NO SSW surface read any of it, so the supervisor saw only
// the coarse acuity enum. This closes that loop: measured workload per patient,
// per nurse and per unit, the acuity/workload distribution the spec asks for,
// the drivers behind the load, and the unsafe-workload monitor (QS-003).
// Unassessed patients are reported as unmeasured — never silently zeroed.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

const card = cardClass;
const label = "text-[11px] font-semibold text-gray-400 uppercase tracking-wider";
const titleCase = (s: string | null | undefined) => (s ?? "").replace(/_/g, " ").replace(/\b\w/g, ch => ch.toUpperCase());
const fmtWhen = (iso: string | null) => iso ? new Date(iso).toLocaleString([], { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }) : "";
const ACUITY: Record<string, string> = { stable: "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]", moderate: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]", high: "bg-[var(--cmp-surface-warning)] text-orange-700", critical: "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]" };
const LEVEL_TONE: Record<string, string> = {
  W1: "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]", W2: "bg-lime-100 text-lime-700", W3: "bg-[var(--cmp-surface-warning)] text-yellow-800", W4: "bg-[var(--cmp-surface-warning)] text-orange-700", W5: "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]",
  I1: "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]", I2: "bg-lime-100 text-lime-700", I3: "bg-[var(--cmp-surface-warning)] text-yellow-800", I4: "bg-[var(--cmp-surface-warning)] text-orange-700", I5: "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]",
};
const bar = (pct: number) => pct >= 100 ? "bg-[var(--cmp-color-critical)]" : pct >= 70 ? "bg-[var(--cmp-color-warning)]" : pct >= 40 ? "bg-[var(--cmp-color-warning)]" : "bg-teal-500";

function Kpi({ label: l, value, tone, sub }: { label: string; value: React.ReactNode; tone?: string; sub?: React.ReactNode }) {
  return (
    <div className={card}>
      <p className={`text-2xl font-bold tabular-nums ${tone ?? "text-gray-900"}`}>{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{l}</p>
      {sub != null && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default async function WorkloadIntelligencePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  const d: any = await loadWorkloadIntelligence(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));

  if (!d.provisioned) {
    return (
      <div className="space-y-5">
        <h1 className="text-2xl font-bold text-gray-900">Workforce Workload Intelligence</h1>
        <div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-5">
          <p className="font-semibold text-amber-900">⚙️ Assessment stores not enabled</p>
          <p className="text-sm text-amber-800 mt-1">Apply migrations <code className="bg-[var(--cmp-surface-warning)] px-1.5 py-0.5 rounded font-mono text-xs">153</code> + <code className="bg-[var(--cmp-surface-warning)] px-1.5 py-0.5 rounded font-mono text-xs">157</code> to enable acuity and workload measurement.</p>
        </div>
      </div>
    );
  }
  if (d.empty) {
    return (
      <div className="space-y-5">
        <h1 className="text-2xl font-bold text-gray-900">Workforce Workload Intelligence</h1>
        <div className={card}><p className="text-sm text-gray-400">No patients currently in the census, so there is no workload to measure.</p></div>
      </div>
    );
  }

  const k = d.kpis;
  const maxUnit = Math.max(1, ...d.units.map((u: any) => u.totalPct ?? 0));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Workforce Workload Intelligence</h1>
          <p className="text-sm text-gray-500 mt-1">Measured nursing workload from the bedside instruments — by patient, nurse and unit. 100% ≈ the capacity of one nurse.</p>
        </div>
        <Link href="/supervisor/assignment-engine" className="text-sm text-teal-700 hover:underline self-center">Rebalance assignments →</Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
        <Kpi label="Measured workload" value={`${k.totalMeasured}%`} sub={`≈ ${k.nurseEquivalents} nurse-equivalents`} />
        <Kpi label="Assessment coverage" value={`${k.coverage}%`} tone={k.coverage < 60 ? "text-[var(--cmp-text-warning)]" : undefined} sub={`${k.assessed}/${k.census} patients assessed`} />
        <Kpi label="Avg per patient" value={k.avgPerPatient != null ? `${k.avgPerPatient}%` : "—"} sub="of one nurse's capacity" />
        <Kpi label="Nurses carrying load" value={k.nursesOnLoad} sub={`${k.overloadedNurses} over capacity`} tone={k.overloadedNurses > 0 ? "text-[var(--cmp-text-critical)]" : undefined} />
        <Kpi label="High / critical acuity" value={k.highAcuity} tone={k.highAcuity > 0 ? "text-[var(--cmp-text-warning)]" : undefined} sub="of the census" />
        <Kpi label="Unmeasured patients" value={d.unassessed.length} tone={d.unassessed.length > 0 ? "text-[var(--cmp-text-warning)]" : undefined} sub="no workload assessment yet" />
      </div>

      {/* Unsafe workload monitor */}
      {d.unsafe.length > 0 && (
        <div className={card}>
          <p className={label}>Unsafe workload monitor</p>
          <div className="mt-2 space-y-1">
            {d.unsafe.map((u: any, i: number) => (
              <p key={i} className={`text-sm ${u.severity === "high" ? "text-[var(--cmp-text-critical)]" : "text-[var(--cmp-text-warning)]"}`}>⚠ {u.text}</p>
            ))}
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Per-nurse load */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">👥 Load by Nurse <span className="text-gray-400 font-normal">({d.nurses.length})</span></h3>
          {d.nurses.length === 0 ? (
            <p className="text-sm text-gray-400">No active patient assignments — allocate patients to see per-nurse load.</p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {d.nurses.map((n: any) => (
                <div key={n.id} className="flex items-center gap-3">
                  <span className="text-sm text-gray-700 w-36 truncate">{n.name}</span>
                  <div className="flex-1 h-2.5 rounded-full bg-gray-100 overflow-hidden">
                    <div className={`h-full rounded-full ${bar(n.load)}`} style={{ width: `${Math.min(100, n.load)}%` }} />
                  </div>
                  <span className={`text-xs tabular-nums w-28 text-right ${n.overloaded ? "text-[var(--cmp-text-critical)] font-semibold" : "text-gray-500"}`}>
                    {n.load}% · {n.count} pt{n.count === 1 ? "" : "s"}
                  </span>
                  {n.highAcuity > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--cmp-surface-warning)] text-orange-700">{n.highAcuity} high</span>}
                  {n.unassessed > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500" title="patients with no workload assessment">{n.unassessed}?</span>}
                </div>
              ))}
            </div>
          )}
          <p className="text-[10px] text-gray-400 mt-2">Sum of each nurse&apos;s actively-assigned patients&apos; latest assessment — the same rule the assignment engine balances on. &quot;?&quot; marks unmeasured patients.</p>
        </div>

        {/* Unit rollup */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">🏥 Load by Unit <span className="text-gray-400 font-normal">({d.units.length})</span></h3>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {d.units.map((u: any) => (
              <div key={u.unit}>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-700 w-36 truncate">{u.unit}</span>
                  <div className="flex-1 h-2.5 rounded-full bg-gray-100 overflow-hidden">
                    <div className="h-full rounded-full bg-teal-500" style={{ width: `${((u.totalPct ?? 0) / maxUnit) * 100}%` }} />
                  </div>
                  <span className="text-xs tabular-nums text-gray-500 w-24 text-right">{u.totalPct}%</span>
                </div>
                <p className="text-[10px] text-gray-400 ml-[9.5rem]">
                  {u.patients} patients · {u.coverage}% assessed{u.avgPct != null ? ` · avg ${u.avgPct}%` : ""}{u.high ? ` · ${u.high} high acuity` : ""}{u.icu ? ` · ${u.icu} ICU` : ""}{u.isolation ? ` · ${u.isolation} isolation` : ""}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Distribution + drivers */}
      <div className="grid md:grid-cols-3 gap-5">
        <div className={card}>
          <p className={label}>Acuity distribution</p>
          <div className="mt-2 space-y-1.5">
            {d.distribution.acuity.map((a: any) => (
              <div key={a.level} className="flex items-center gap-2">
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full w-20 text-center ${ACUITY[a.level]}`}>{titleCase(a.level)}</span>
                <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                  <div className="h-full rounded-full bg-gray-400" style={{ width: `${k.census ? (a.n / k.census) * 100 : 0}%` }} />
                </div>
                <span className="text-xs tabular-nums text-gray-600 w-8 text-right">{a.n}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={card}>
          <p className={label}>Workload distribution</p>
          <div className="mt-2 space-y-1.5">
            {d.distribution.workload.map((w: any) => (
              <div key={w.band} className="flex items-center gap-2">
                <span className="text-[11px] text-gray-600 w-32">{w.band}</span>
                <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                  <div className="h-full rounded-full bg-teal-400" style={{ width: `${k.assessed ? (w.n / k.assessed) * 100 : 0}%` }} />
                </div>
                <span className="text-xs tabular-nums text-gray-600 w-8 text-right">{w.n}</span>
              </div>
            ))}
          </div>
          {d.distribution.levels.length > 0 && (
            <div className="mt-3 pt-2 border-t border-gray-100">
              <p className="text-[10px] text-gray-400 uppercase mb-1">Instrument levels</p>
              <div className="flex flex-wrap gap-1">
                {d.distribution.levels.map((l: any) => (
                  <span key={l.level} className={`text-[10px] px-1.5 py-0.5 rounded-full ${LEVEL_TONE[l.level] ?? "bg-gray-100 text-gray-500"}`}>{l.level} × {l.n}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className={card}>
          <p className={label}>Workload drivers</p>
          <div className="mt-2 space-y-1.5">
            {d.drivers.map((dr: any) => (
              <div key={dr.label} className="flex items-baseline gap-2">
                <span className="text-sm font-bold tabular-nums text-gray-900 w-16">{dr.value}</span>
                <span className="text-xs text-gray-600 flex-1">{dr.label}<span className="block text-[10px] text-gray-400">{dr.sub}</span></span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Per-patient detail */}
      <div className={card}>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">🧑‍⚕️ Patient Workload Detail <span className="text-gray-400 font-normal">({d.patients.length})</span></h3>
          <span className="text-[11px] text-gray-400">heaviest first</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                <th className="py-1.5 pr-2 font-medium">Patient</th>
                <th className="py-1.5 px-1 font-medium">Unit</th>
                <th className="py-1.5 px-1 font-medium">Acuity</th>
                <th className="py-1.5 px-1 font-medium">Score</th>
                <th className="py-1.5 px-1 font-medium">Workload</th>
                <th className="py-1.5 px-1 font-medium">Level</th>
                <th className="py-1.5 px-1 font-medium">Meds</th>
                <th className="py-1.5 pl-1 font-medium">Assessed</th>
              </tr>
            </thead>
            <tbody>
              {d.patients.slice(0, 40).map((p: any) => (
                <tr key={p.id} className="border-b border-gray-50">
                  <td className="py-2 pr-2 font-medium text-gray-800">{p.bed ? `${p.bed} · ` : ""}{p.label}{p.icu && <span className="ml-1 text-[9px] text-[var(--cmp-text-information)]">ICU</span>}{p.isolation && <span className="ml-1 text-[9px] text-purple-600">ISO</span>}</td>
                  <td className="py-2 px-1 text-xs text-gray-500">{p.unit}</td>
                  <td className="py-2 px-1"><span className={`text-[10px] px-1.5 py-0.5 rounded-full ${ACUITY[p.acuityLevel] ?? ACUITY.stable}`}>{titleCase(p.acuityLevel)}</span></td>
                  <td className="py-2 px-1 text-xs tabular-nums text-gray-600">
                    {p.acuityScore != null ? `${p.acuityScore}${p.acuityFramework === "ciaf" ? "/100" : p.acuityFramework === "pews" ? " PEWS" : "/18"}` : "—"}
                    {p.acuitySignificant && <span className="ml-1 text-[9px] text-[var(--cmp-text-warning)]">Δ</span>}
                  </td>
                  <td className="py-2 px-1">
                    {p.workloadPct != null ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="tabular-nums font-medium text-gray-800">{Math.round(p.workloadPct)}%</span>
                        <span className="inline-block w-12 h-1.5 rounded-full bg-gray-100 overflow-hidden align-middle">
                          <span className={`block h-full rounded-full ${bar(p.workloadPct)}`} style={{ width: `${Math.min(100, p.workloadPct)}%` }} />
                        </span>
                      </span>
                    ) : <span className="text-xs text-[var(--cmp-text-warning)]">unmeasured</span>}
                  </td>
                  <td className="py-2 px-1">{p.workloadLevel ? <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${LEVEL_TONE[p.workloadLevel] ?? "bg-gray-100 text-gray-500"}`}>{p.workloadLevel}{p.workloadRatio ? ` · ${p.workloadRatio}` : ""}</span> : <span className="text-gray-300">—</span>}</td>
                  <td className={`py-2 px-1 text-xs tabular-nums ${p.highRiskMeds > 0 ? "text-[var(--cmp-text-warning)] font-semibold" : "text-gray-500"}`}>{p.openMeds}{p.highRiskMeds > 0 ? ` (${p.highRiskMeds} HR)` : ""}</td>
                  <td className="py-2 pl-1 text-[11px] text-gray-400">{p.workloadAt ? fmtWhen(p.workloadAt) : "never"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {d.unassessed.length > 0 && (
          <p className="text-[11px] text-[var(--cmp-text-warning)] mt-2">
            {d.unassessed.length} patient{d.unassessed.length === 1 ? "" : "s"} have never been workload-assessed — their contribution is UNMEASURED, not zero. Totals above count only assessed patients.
          </p>
        )}
      </div>

      <p className="text-center text-[11px] text-gray-400 pt-1">
        Sourced from the bedside instruments: Ward PEWS / ICU CIAF acuity and Ward 12-domain / ICU NAS workload, plus the live medication schedule. Nurses record them in the Healthcare Worker Workspace; this is the supervisor&apos;s aggregate view of the same rows.
      </p>
    </div>
  );
}
