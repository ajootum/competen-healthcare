import { cmoGuard, Head, Card, Kpi, Pill, Donut, Foot } from "../_cmo-ui";
import { loadLifecycleStates, STATE_LABEL, STATE_COLOR } from "@/lib/competency/lifecycle-state";
import Link from "next/link";

export const dynamic = "force-dynamic";

// COMP-017 Competency Lifecycle state machine — the PERSISTED current state per worker×competency + the
// immutable transition log (competency_lifecycle_state / lifecycle_events, migration 126). Complements the
// inferred CMO-004 lifecycle view at /competency-office/lifecycle with a real, transitioning record.
/* eslint-disable @typescript-eslint/no-explicit-any */
const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const stateTone = (s: string) => (["competent", "renewed", "competent_conditions"].includes(s) ? "emerald" : ["expired", "suspended"].includes(s) ? "rose" : s === "remediation_required" ? "amber" : "blue");

export default async function LifecycleStatePage() {
  const { admin, isSuper, hid } = await cmoGuard();
  const d = await loadLifecycleStates(admin, hid, isSuper);
  const head = <Head code="COMP-017 · Competency Office" title="Competency Lifecycle State Machine" sub="The persisted state of every competency, per worker — with an immutable transition log. A real record, not inferred on read." />;
  if (!d.provisioned) return <div className="space-y-4">{head}<Card><p className="text-sm text-gray-400">The lifecycle state machine (<code>competency_lifecycle_state</code>) is not provisioned yet — apply migration 126 (it seeds the current state from your latest competency decisions).</p></Card></div>;
  const k = d.kpis;

  return (
    <div className="space-y-4">
      {head}
      {d.empty && <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-[12px] text-blue-800">No lifecycle states recorded yet — states seed from competency decisions and transition as competencies are assigned, assessed, validated and expire.</div>}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Competencies tracked" value={k.total} />
        <Kpi label="Active / current" value={k.active} tone="text-emerald-600" sub="competent + renewed" />
        <Kpi label="Needs attention" value={k.attention} tone={k.attention ? "text-rose-600" : "text-gray-900"} sub="expired / remediation / suspended" />
        <Kpi label="In progress" value={k.inProgress} tone="text-blue-600" sub="assigned → under review" />
        <Kpi label="Renewed" value={k.renewed} tone="text-emerald-600" />
        <Kpi label="Transitions (30d)" value={k.transitions30d} sub="logged events" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="State distribution" right={<Link href="/competency-office/lifecycle" className="text-[11px] text-teal-600 hover:underline">Lifecycle engine →</Link>}>
          {d.distribution.length ? (
            <div className="flex flex-col items-center gap-3">
              <Donut segs={d.distribution.map((s: any) => ({ n: s.n, color: s.color }))} total={k.total} centre={k.total} sub="competencies" size={150} />
              <div className="w-full space-y-1 max-h-56 overflow-y-auto">
                {d.distribution.map((s: any) => (
                  <div key={s.state} className="flex items-center gap-2 text-[11px]"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} /><span className="text-gray-600 flex-1 truncate">{s.label}</span><span className="tabular-nums text-gray-800 font-semibold w-8 text-right">{s.n}</span><span className="tabular-nums text-gray-400 w-9 text-right">{k.total ? Math.round((s.n / k.total) * 100) : 0}%</span></div>
                ))}
              </div>
            </div>
          ) : <p className="text-sm text-gray-400 py-6 text-center">No states recorded yet.</p>}
        </Card>

        <Card title="Recent transitions" className="xl:col-span-2" right="immutable log">
          {d.recentTransitions.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead><tr className="text-left text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-100"><th className="pb-2 pr-3 font-medium">Worker</th><th className="pb-2 pr-3 font-medium">Competency</th><th className="pb-2 pr-3 font-medium">Transition</th><th className="pb-2 font-medium text-right">When</th></tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {d.recentTransitions.map((t: any, i: number) => (
                    <tr key={i} className="text-gray-700">
                      <td className="py-2 pr-3 font-medium text-gray-800">{t.person}</td>
                      <td className="py-2 pr-3 truncate max-w-[12rem]">{t.competency}</td>
                      <td className="py-2 pr-3"><span className="inline-flex items-center gap-1.5">{t.from && <span className="text-gray-400 text-[11px]">{STATE_LABEL[t.from] ?? t.from} →</span>}<Pill text={STATE_LABEL[t.to] ?? t.to} tone={stateTone(t.to)} /></span></td>
                      <td className="py-2 text-right tabular-nums text-gray-400 text-[11px]">{fmt(t.when)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-sm text-gray-400 py-6 text-center">No transitions logged yet.</p>}
        </Card>
      </div>

      <Card title="The lifecycle" right="draft → competent → renewed / expired → archived">
        <div className="flex flex-wrap items-center gap-1.5">
          {Object.keys(STATE_LABEL).map((s, i, arr) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1 text-[11px] text-gray-600"><span className="w-2 h-2 rounded-full" style={{ background: STATE_COLOR[s] }} />{STATE_LABEL[s]}</span>
              {i < arr.length - 1 && <span className="text-gray-300">→</span>}
            </span>
          ))}
        </div>
      </Card>

      <Foot>COMP-017 — the persisted lifecycle over <code>competency_lifecycle_state</code> (current state per worker×competency) + <code>lifecycle_events</code> (immutable transitions), seeded from the latest competency decisions and transitioned on real events (e.g. educator validation → Competent). This complements the inferred <Link href="/competency-office/lifecycle" className="text-teal-600 hover:underline">Lifecycle Engine</Link> (CMO-004) with a real record. Wiring every lifecycle event (assign / accept / evidence / expiry / renewal) into transitions, and surfacing the per-worker timeline on the passport, are the next-phase deepening.</Foot>
    </div>
  );
}
