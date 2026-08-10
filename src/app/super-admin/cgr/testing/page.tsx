import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadGovernanceTesting } from "@/lib/cgr/testing";
import { Kpi } from "../_kit";
import { requireHqCapability } from "@/lib/hq/context";

// CGR-017 — Competency Governance Simulation, Testing & Validation. The validation backbone: release-readiness
// gate, test-suite health and run history over configuration_test_suites/runs, with change-impact simulation
// cross-linked to CGR-004. Deep authoring cross-links to Studio Release Readiness. Super-admin.
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

const STATUS_META: Record<string, { label: string; cls: string }> = {
  passing: { label: "Passing", cls: "text-emerald-700 bg-[var(--cmp-surface-success)] border-[var(--cmp-color-success)]" },
  failing: { label: "Failing", cls: "text-[var(--cmp-text-error)] bg-[var(--cmp-surface-error)] border-[var(--cmp-color-error)]" },
  draft: { label: "Draft", cls: "text-gray-500 bg-gray-50 border-gray-200" },
};
const VALIDATION = [
  { name: "Functional", q: "Does the system behave correctly?" },
  { name: "Governance", q: "Does the change follow governance requirements?" },
  { name: "Safety", q: "Could the change introduce risk?" },
  { name: "Performance", q: "Can the system support operational load?" },
];
const fmt = (iso: string) => (iso ? String(iso).slice(0, 16).replace("T", " ") : "—");

export default async function GovernanceTestingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  await requireHqCapability("hq.quality.regulation.view");

  const d = await loadGovernanceTesting(admin) as any;
  const k = d.kpis;
  const rr = k.releaseReady;

  return (
    <div className="max-w-[1400px]">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-[var(--cmp-text-success)] uppercase tracking-widest mb-0.5">CGR-017 · Competency Governance</p>
          <h1 className="text-xl font-bold text-gray-900">Simulation, Testing &amp; Validation</h1>
          <p className="text-gray-400 text-sm mt-0.5">What happens if we change a governance rule, workflow or policy before we release it? Test before release, predictable outcomes, evidence-based validation.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Link href="/super-admin/studio/testing" className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 border border-[var(--cmp-color-success)] bg-[var(--cmp-surface-success)] rounded-lg px-3 py-2">Release readiness →</Link>
          <Link href="/super-admin/cgr" className="text-xs font-semibold text-gray-500 hover:text-emerald-700 border border-gray-200 rounded-lg px-3 py-2">← CGR</Link>
        </div>
      </div>

      {!d.provisioned ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center"><p className="text-sm text-gray-400">No governance test suites yet. Configuration validation suites are authored in <Link href="/super-admin/studio/testing" className="text-[var(--cmp-text-success)] hover:underline">Studio Release Readiness</Link>; once they exist, release-readiness gating and run history compute here. For change blast-radius, see <Link href="/super-admin/cgr/change-control" className="text-[var(--cmp-text-success)] hover:underline">Change Control</Link>.</p></div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Kpi label="Test suites" value={k.suites} sub={`${k.totalCases} cases`} />
            <Kpi label="Passing" value={k.passing} sub="green suites" tone={k.passing ? "text-[var(--cmp-text-success)]" : "text-gray-900"} />
            <Kpi label="Failing" value={k.failing} sub="need attention" tone={k.failing ? "text-[var(--cmp-text-error)]" : "text-gray-900"} />
            <Kpi label="Release-ready" value={rr == null ? "—" : `${rr}%`} sub="suites passing" tone={rr == null ? "text-gray-900" : rr >= 90 ? "text-[var(--cmp-text-success)]" : rr >= 60 ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-error)]"} />
            <Kpi label="Test runs" value={k.totalRuns} sub={`${k.last30Runs} in 30d`} />
            <Kpi label="Run pass rate" value={k.passRate == null ? "—" : `${k.passRate}%`} sub="gate = pass" tone={k.passRate == null ? "text-gray-900" : k.passRate >= 80 ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-warning)]"} />
          </div>

          {/* Release readiness gate */}
          <div className={`rounded-xl border p-4 ${k.failing === 0 && k.suites > 0 ? "bg-[var(--cmp-surface-success)] border-[var(--cmp-color-success)]" : k.failing ? "bg-[var(--cmp-surface-error)] border-[var(--cmp-color-error)]" : "bg-white border-gray-100"}`}>
            <div className="flex items-center gap-4">
              <div className={`text-3xl ${k.failing ? "" : "grayscale-0"}`}>{k.failing === 0 && k.suites > 0 ? "✅" : k.failing ? "⛔" : "🧪"}</div>
              <div className="flex-1">
                <p className="text-sm font-bold text-gray-800">{k.failing === 0 && k.suites > 0 ? "Release gate: clear" : k.failing ? `Release gate: blocked — ${k.failing} suite${k.failing === 1 ? "" : "s"} failing` : "Release gate: no passing evidence yet"}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">Before deployment (§10): test completion, governance approval, risk assessment, rollback availability. Governance changes must be validated before production (§4.1).</p>
              </div>
            </div>
          </div>

          {/* Test suites */}
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <p className="text-sm font-bold text-gray-800">Validation suites</p>
              <p className="text-[10px] text-gray-400">failing first</p>
            </div>
            {d.suiteList.length === 0 ? (
              <div className="p-6 text-center"><p className="text-[12px] text-gray-400">No test suites defined.</p></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px]">
                  <thead><tr className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">
                    <th className="text-left py-2 pl-4 pr-2">Suite</th>
                    <th className="text-center py-2 px-2">Cases</th>
                    <th className="text-center py-2 px-2">Last run</th>
                    <th className="text-left py-2 px-2">Gate</th>
                    <th className="text-left py-2 pr-4 pl-2">Status</th>
                  </tr></thead>
                  <tbody>
                    {d.suiteList.map((s: any) => (
                      <tr key={s.key} className="border-t border-gray-50">
                        <td className="py-2 pl-4 pr-2"><p className="text-[12px] font-medium text-gray-800">{s.name}</p><p className="text-[10px] text-gray-400 font-mono">{s.key}</p></td>
                        <td className="py-2 px-2 text-center text-[12px] text-gray-600 tabular-nums">{s.cases}</td>
                        <td className="py-2 px-2 text-center text-[11px] tabular-nums">{s.lastTotal != null ? <span><span className="text-[var(--cmp-text-success)] font-semibold">{s.lastPassed}</span><span className="text-gray-300">/</span><span className={s.lastFailed ? "text-[var(--cmp-text-error)] font-semibold" : "text-gray-400"}>{s.lastFailed}</span> <span className="text-gray-300">of {s.lastTotal}</span></span> : <span className="text-gray-300">not run</span>}</td>
                        <td className="py-2 px-2">{s.gate ? <span className={`text-[10px] font-bold ${s.gate === "pass" ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-error)]"}`}>{s.gate === "pass" ? "✓ pass" : "⛔ blocked"}</span> : <span className="text-[10px] text-gray-300">—</span>}</td>
                        <td className="py-2 pr-4 pl-2"><span className={`text-[10px] font-bold border rounded px-1.5 py-0.5 ${(STATUS_META[s.status] ?? STATUS_META.draft).cls}`}>{(STATUS_META[s.status] ?? STATUS_META.draft).label}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Recent runs */}
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100"><p className="text-sm font-bold text-gray-800">Recent test runs</p></div>
              {d.runList.length === 0 ? (
                <div className="p-6 text-center"><p className="text-[12px] text-gray-400">No test runs recorded.</p></div>
              ) : (
                <div className="divide-y divide-gray-50 max-h-[280px] overflow-y-auto">
                  {d.runList.map((r: any, i: number) => (
                    <div key={i} className="flex items-center justify-between gap-2 px-4 py-2">
                      <div className="min-w-0">
                        <p className="text-[11px] font-mono text-gray-700 truncate">{r.suite}</p>
                        <p className="text-[10px] text-gray-400">{r.by} · {fmt(r.at)}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[11px] tabular-nums"><span className="text-[var(--cmp-text-success)] font-semibold">{r.passed}</span><span className="text-gray-300">/</span><span className={r.failed ? "text-[var(--cmp-text-error)]" : "text-gray-400"}>{r.failed}</span></span>
                        <span className={`text-[9px] font-bold rounded px-1.5 py-0.5 ${r.gate === "pass" ? "text-emerald-700 bg-[var(--cmp-surface-success)] border border-[var(--cmp-color-success)]" : "text-[var(--cmp-text-error)] bg-[var(--cmp-surface-error)] border border-[var(--cmp-color-error)]"}`}>{r.gate}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Validation framework + change impact */}
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Validation framework (§8)</p>
              <div className="space-y-2 mb-3">
                {VALIDATION.map((v) => (
                  <div key={v.name} className="flex items-start gap-2">
                    <span className="text-[11px] font-semibold text-gray-700 w-24 shrink-0">{v.name}</span>
                    <span className="text-[11px] text-gray-400 leading-snug">{v.q}</span>
                  </div>
                ))}
              </div>
              <div className="pt-3 border-t border-gray-100">
                <p className="text-[11px] text-gray-600">Change-impact simulation (§5.3) — the downstream blast radius of a change — is computed in <Link href="/super-admin/cgr/change-control" className="text-[var(--cmp-text-success)] hover:underline font-medium">Change Control</Link>.</p>
              </div>
            </div>
          </div>

          <p className="text-[11px] text-gray-400 leading-relaxed">Every figure is real — the validation suites, their last-run pass/fail and gate, and the run history come straight from the configuration test-suite store. Authoring suites and executing tests happen in <Link href="/super-admin/studio/testing" className="text-[var(--cmp-text-success)] hover:underline">Studio Release Readiness</Link>; change blast-radius in <Link href="/super-admin/cgr/change-control" className="text-[var(--cmp-text-success)] hover:underline">Change Control</Link>. Per the CGR mandate, AI outputs themselves require validation (accuracy, explainability, bias) and AI never approves a release.</p>
        </div>
      )}
    </div>
  );
}
