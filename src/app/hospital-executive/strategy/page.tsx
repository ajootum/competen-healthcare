import { hexGuard, Head, Tabs, Stat, Card, Pill, Donut, Legend, Bars, Table, Foot, T } from "../_ui";
import { loadExecStrategy } from "@/lib/hex/strategy";

export const dynamic = "force-dynamic";

// HEX-009 Strategy & Transformation (executive lens) over ppe_* + the balanced scorecard.
/* eslint-disable @typescript-eslint/no-explicit-any */
const TABS = ["Executive Dashboard", "Strategy", "Objectives & OKRs", "Portfolios", "Transformation", "Performance", "Risks & Dependencies", "Scenarios", "Reports"];
const money = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${Math.round(n)}`);
const ST_TONE: Record<string, string> = { active: "emerald", planned: "slate", paused: "amber", completed: "blue", cancelled: "rose" };

export default async function ExecStrategyPage() {
  const { admin, isSuper, hid } = await hexGuard();
  const d = await loadExecStrategy(admin, hid, isSuper);
  const head = <Head code="HEX-009 · Hospital Executive" title="Strategy & Transformation" sub="Drive direction. Execute transformation. Deliver impact." action={{ label: "Priorities framework →", href: "/super-admin/priorities" }} />;
  if (!d.provisioned) return <div className="space-y-4">{head}<Tabs tabs={TABS} active="Executive Dashboard" /><Card><p className="text-sm text-gray-400">The strategy framework (<code>ppe_*</code>) is not provisioned yet.</p></Card></div>;
  const k = d.kpis, tr = d.transformation;

  return (
    <div className="space-y-4">
      {head}
      <Tabs tabs={TABS} active="Executive Dashboard" />

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <Stat icon="🎯" tone={k.strategyProgress != null && k.strategyProgress >= 70 ? "emerald" : "amber"} label="Strategy progress" value={k.strategyProgress != null ? `${k.strategyProgress}%` : "—"} />
        <Stat icon="🎖️" tone="blue" label="Objectives on track" value={k.objOnTrack != null ? `${k.objOnTrack}%` : "—"} />
        <Stat icon="🚀" tone="teal" label="Strategic initiatives" value={k.activeInitiatives} sub={`${k.totalInitiatives} total`} />
        <Stat icon="💰" tone="violet" label="Initiative budget" value={k.initiativeBudget ? money(k.initiativeBudget) : "—"} sub="under management" />
        <Stat icon="🔄" tone="indigo" label="Transformation progress" value={k.transformationProgress != null ? `${k.transformationProgress}%` : "—"} />
        <Stat icon="⚠️" tone={k.strategicRisksHigh ? "rose" : "emerald"} label="Strategic risks (high)" value={k.strategicRisksHigh} />
        <Stat icon="✅" tone="amber" label="Approvals pending" value={k.pendingApprovals} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Strategy map" className="xl:col-span-2" right="themes × progress">
          {d.strategyMap.length ? <div className="space-y-2.5">{d.strategyMap.map((t: any, i: number) => (
            <div key={i}>
              <div className="flex items-center justify-between text-[12.5px] mb-1"><span className="text-gray-700">{t.name} <span className="text-gray-400">· {t.count} objectives</span></span><span className="font-medium text-gray-800 tabular-nums">{t.progress}%</span></div>
              <div className="h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.max(2, t.progress)}%`, backgroundColor: T(t.tone).hex }} /></div>
            </div>
          ))}</div> : <p className="text-sm text-gray-400 py-6 text-center">No strategic themes defined.</p>}
        </Card>

        <Card title="Top strategic risks">
          {d.topRisks.length ? <div className="space-y-2">{d.topRisks.map((r: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-[12px]"><div className="min-w-0 flex-1"><p className="text-gray-800 truncate">{r.title}</p><p className="text-[10px] text-gray-400">{r.owner ?? "—"}</p></div><span className="tabular-nums text-gray-500">{r.inherent}→<b className="text-gray-800">{r.residual}</b></span></div>
          ))}</div> : <p className="text-sm text-gray-400 py-6 text-center">No strategic-category risks registered.</p>}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Strategic initiatives — top 5" className="xl:col-span-2">
          <Table cols={["Initiative", "Theme", "Progress", "Status"]} rows={d.topInitiatives.map((c: any) => [
            <span key="t" className="font-medium text-gray-800">{c.title}</span>,
            <span key="th" className="text-gray-500">{c.theme}</span>,
            <span key="p" className="inline-flex items-center gap-2"><span className="w-16 h-1.5 rounded-full bg-gray-100 overflow-hidden inline-block"><span className="h-full block rounded-full bg-teal-500" style={{ width: `${c.progress}%` }} /></span><b className="tabular-nums text-gray-700">{c.progress}%</b></span>,
            <Pill key="s" text={c.status} tone={ST_TONE[c.status] ?? "slate"} />,
          ])} empty="No initiatives defined." />
        </Card>

        <Card title="Transformation programs">
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="border border-gray-100 rounded-lg p-3"><p className="text-2xl font-bold text-emerald-600 tabular-nums">{tr.onTrack}</p><p className="text-[11px] text-gray-500">On track</p></div>
            <div className="border border-gray-100 rounded-lg p-3"><p className="text-2xl font-bold text-amber-600 tabular-nums">{tr.atRisk}</p><p className="text-[11px] text-gray-500">At risk</p></div>
            <div className="border border-gray-100 rounded-lg p-3"><p className="text-2xl font-bold text-blue-600 tabular-nums">{tr.completed}</p><p className="text-[11px] text-gray-500">Completed</p></div>
            <div className="border border-gray-100 rounded-lg p-3"><p className="text-2xl font-bold text-gray-400 tabular-nums">{tr.notStarted}</p><p className="text-[11px] text-gray-500">Not started</p></div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Strategic performance (balanced scorecard)">
          {d.scorecard.length ? <Bars items={d.scorecard} /> : <p className="text-sm text-gray-400 py-6 text-center">Balanced scorecard not provisioned.</p>}
        </Card>

        <Card title="Initiative budget by theme">
          {d.budgetByTheme.length ? <div className="flex items-center gap-2"><Donut segments={d.budgetByTheme} total={k.initiativeBudget} label="Budget" size={130} /><Legend items={d.budgetByTheme.map((b: any) => ({ label: b.label, value: money(b.value), tone: b.tone }))} /></div> : <p className="text-sm text-gray-400 py-6 text-center">No initiative budgets recorded.</p>}
          <p className="text-[10px] text-gray-400 mt-2">Budget under management by theme — formal benefits-realisation (value delivered vs planned) is the next build phase.</p>
        </Card>
      </div>

      <Foot>HEX-009 — live over the strategy framework (<code>ppe_*</code>: themes, objectives, initiatives/campaigns, approvals) and the <code>pa_*</code> balanced scorecard, with strategic risks from <code>gov_risks</code>. Strategy map, objective progress, initiative portfolio, transformation status and scorecard are real. Benefits-realisation, change/adoption and scenario planning need dedicated stores (next phase).</Foot>
    </div>
  );
}
