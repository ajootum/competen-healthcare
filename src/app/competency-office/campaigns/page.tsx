import Link from "next/link";
import { cmoGuard, Head, Card, Kpi, Pill, Progress, Foot } from "../_cmo-ui";
import { loadCampaigns } from "@/lib/delivery/campaigns";

// CMO-011 — Competency Campaign & Initiative Management. The office's oversight lens over organisation-wide
// competency campaigns: participation, live compliance and at-risk initiatives. Real over cdp_campaigns (144) +
// cmo_assignments (114) + competency_decisions (011) via the shared loadCampaigns. Authoring (create/launch/close)
// lives in the Delivery campaign manager — cross-linked, not duplicated. Hospital-scoped.
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

const compTone = (n: number | null) => (n == null ? "text-gray-300" : n >= 80 ? "text-emerald-600" : n >= 50 ? "text-amber-600" : "text-rose-600");
// Date.now()/new Date() must live in module helpers, not the render body (react-hooks/purity).
const todayISO = () => new Date().toISOString().slice(0, 10);
const horizonISO = (days: number) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);

export default async function CmoCampaignsPage() {
  const { admin, isSuper, hid } = await cmoGuard();
  const d = await loadCampaigns(admin, hid, isSuper) as any;

  const head = <Head code="CMO-011 · Campaigns & Initiatives" title="Competency Campaign & Initiative Management" sub="Launch, monitor and measure organisation-wide competency improvement initiatives — live participation and compliance." />;
  if (!d.provisioned) {
    return <div className="space-y-4">{head}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="text-sm text-amber-800">Campaigns aren&apos;t provisioned — apply migration <code className="font-mono">144</code> (<code className="font-mono">cdp_campaigns</code>).</p></div></div>;
  }

  const camps: any[] = d.campaigns ?? [];
  const active = camps.filter(c => c.status === "active");
  const scored = active.filter(c => c.compliance != null);
  const avgCompliance = scored.length ? Math.round(scored.reduce((a, c) => a + c.compliance, 0) / scored.length) : null;
  const atRisk = active.filter(c => c.compliance != null && c.compliance < 50);
  const today = todayISO(); const horizon = horizonISO(30);
  const dueSoon = active.filter(c => c.dueOn && c.dueOn >= today && c.dueOn <= horizon);

  return (
    <div className="space-y-4 max-w-[1400px]">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        {head}
        <Link href="/super-admin/delivery/campaigns" className="text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-lg px-3.5 py-2 shrink-0">Manage campaigns ↗</Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Active campaigns" value={d.kpis.active} sub={`${d.kpis.total} total`} tone="text-teal-600" />
        <Kpi label="Workforce reach" value={d.kpis.reach} sub="in active cohorts" />
        <Kpi label="Avg compliance" value={avgCompliance != null ? `${avgCompliance}%` : "—"} sub="active campaigns" tone={avgCompliance != null && avgCompliance < 60 ? "text-amber-600" : "text-gray-900"} />
        <Kpi label="Mandatory" value={d.kpis.mandatory} sub="open" />
        <Kpi label="Due ≤30 days" value={dueSoon.length} sub="deadlines" tone={dueSoon.length ? "text-amber-600" : "text-gray-900"} />
        <Kpi label="At risk" value={atRisk.length} sub="< 50% compliance" tone={atRisk.length ? "text-rose-600" : "text-gray-900"} />
      </div>

      <Card title="Active campaigns" right={<span className="text-[11px] text-gray-400">{active.length} running · live compliance</span>}>
        {active.length === 0 ? (
          <p className="text-sm text-gray-400 py-6 text-center">No active campaigns. Launch one from the <Link href="/super-admin/delivery/campaigns" className="text-teal-600 hover:underline">campaign manager</Link>.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-100"><th className="py-2 pr-3 font-medium">Campaign</th><th className="py-2 px-3 font-medium">Competency</th><th className="py-2 px-3 font-medium">Target</th><th className="py-2 px-3 font-medium">Due</th><th className="py-2 px-3 font-medium w-40">Compliance</th><th className="py-2 pl-3 font-medium text-right">Cohort</th></tr></thead>
              <tbody className="divide-y divide-gray-50">
                {active.map(c => (
                  <tr key={c.id}>
                    <td className="py-2 pr-3 text-gray-800 font-medium">{c.name}{c.mandatory && <span className="ml-1.5"><Pill text="mandatory" tone="rose" /></span>}</td>
                    <td className="py-2 px-3 text-gray-500 truncate max-w-[160px]">{c.competency}</td>
                    <td className="py-2 px-3 text-gray-500">{c.target}</td>
                    <td className="py-2 px-3 text-gray-500 tabular-nums">{c.dueOn ?? "—"}</td>
                    <td className="py-2 px-3">
                      {c.compliance == null ? <span className="text-[11px] text-gray-300">no cohort</span> : (
                        <div className="flex items-center gap-2"><div className="flex-1"><Progress pct={c.compliance} /></div><span className={`text-[11px] font-semibold tabular-nums w-9 text-right ${compTone(c.compliance)}`}>{c.compliance}%</span></div>
                      )}
                    </td>
                    <td className="py-2 pl-3 text-gray-500 tabular-nums text-right">{c.achieved}/{c.cohort}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="At-risk initiatives" right={<span className="text-[11px] text-gray-400">below 50% compliance</span>}>
          {atRisk.length === 0 ? <p className="text-sm text-gray-400 py-4 text-center">No campaigns at risk. 🎯</p> : (
            <div className="space-y-2">
              {atRisk.map(c => (
                <div key={c.id} className="flex items-center gap-3">
                  <span className="text-sm text-gray-800 flex-1 truncate">{c.name}</span>
                  <span className="text-[11px] text-gray-400">{c.achieved}/{c.cohort}</span>
                  <span className={`text-xs font-bold tabular-nums ${compTone(c.compliance)}`}>{c.compliance}%</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Campaign portfolio" right={<span className="text-[11px] text-gray-400">{camps.length} total</span>}>
          <div className="space-y-2">
            {[["active", "emerald"], ["draft", "slate"], ["closed", "slate"]].map(([st, tone]) => {
              const n = camps.filter(c => c.status === st).length;
              return (
                <div key={st} className="flex items-center gap-2 text-[12px]"><Pill text={st} tone={tone} /><div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full rounded-full ${st === "active" ? "bg-emerald-500" : "bg-gray-300"}`} style={{ width: `${camps.length ? (n / camps.length) * 100 : 0}%` }} /></div><span className="text-gray-900 font-semibold tabular-nums w-8 text-right">{n}</span></div>
              );
            })}
          </div>
        </Card>
      </div>

      <Foot>CMO-011 — the Competency Office&apos;s oversight lens over campaigns, with compliance measured live against competency_decisions. Campaigns are authored, launched and closed in the <Link href="/super-admin/delivery/campaigns" className="text-teal-600 hover:underline">Delivery campaign manager</Link> (CDP-008); this surface measures and governs them. Impact-vs-baseline analytics need a campaign-outcome store — next phase.</Foot>
    </div>
  );
}
