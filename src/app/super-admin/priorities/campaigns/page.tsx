import { loadCampaigns } from "@/lib/priorities/modules";
import { ppeGuard, Head, ModuleNav, Card, Stat, Pill, Progress, Provision, Foot, STATUS_TONE } from "../_ui";

export const dynamic = "force-dynamic";

// PPE-005 Campaign & Initiative Manager — the initiative portfolio advancing objectives (budget, sponsor, progress).
/* eslint-disable @typescript-eslint/no-explicit-any */
const money = (n: number) => (n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`);

export default async function CampaignsPage() {
  const { admin } = await ppeGuard();
  const d = await loadCampaigns(admin) as any;
  const head = <Head code="PPE-005 · Priority & Execution Framework" title="Campaign & Initiative Manager" sub="Plan and track the initiatives that deliver strategic objectives — milestones, budgets, sponsors, KPIs and progress." />;
  if (!d.provisioned) return <div className="max-w-[1400px] space-y-4">{head}<ModuleNav active="005" /><Provision module="the Campaign Manager" /></div>;

  const k = d.kpis;
  return (
    <div className="max-w-[1400px] space-y-4">
      {head}
      <ModuleNav active="005" />
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <Stat label="Campaigns" value={k.total} sub="initiatives" />
        <Stat label="Active" value={k.active} sub="in delivery" tone="text-[var(--cmp-text-success)]" />
        <Stat label="Planned" value={k.planned} sub="upcoming" />
        <Stat label="Completed" value={k.completed} sub="delivered" tone="text-teal-600" />
        <Stat label="Total Budget" value={money(k.budget)} sub="allocated" />
        <Stat label="Avg Progress" value={`${k.avgProgress}%`} sub="active" tone={k.avgProgress >= 60 ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-warning)]"} />
        <Stat label="Linked Actions" value={k.actions} sub="generated" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Initiative Portfolio" className="xl:col-span-2" right={<span className="text-[11px] text-gray-400">{d.campaigns.length} campaigns</span>}>
          <div className="space-y-2">
            {d.campaigns.map((c: any) => (
              <div key={c.id} className="border border-gray-100 rounded-lg p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: c.themeColor }} /><p className="text-[13px] font-medium text-gray-900">{c.name}</p><Pill text={c.status} tone={STATUS_TONE[c.status]} /></div>
                    <p className="text-[11px] text-gray-500 mt-0.5">{c.scopeLabel} · {c.sponsor}{c.objectiveTitle ? ` · ↳ ${c.objectiveTitle.slice(0, 36)}` : ""}</p>
                  </div>
                  <div className="text-right shrink-0"><p className="text-sm font-bold text-gray-900 tabular-nums">{Math.round(Number(c.progress_pct))}%</p><p className="text-[10px] text-gray-400">{c.budget ? money(Number(c.budget)) : "—"}</p></div>
                </div>
                <div className="mt-2"><Progress pct={Number(c.progress_pct)} /></div>
                <div className="flex items-center gap-3 mt-1.5 text-[10px] text-gray-400"><span>{c.actionCount} actions</span>{c.daysLeft != null && <span className={c.daysLeft < 0 ? "text-rose-500" : c.daysLeft < 30 ? "text-amber-500" : ""}>{c.daysLeft < 0 ? `${-c.daysLeft}d overdue` : `${c.daysLeft}d left`}</span>}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Campaigns by Theme">
          {d.byTheme.length ? <div className="space-y-2 text-[12px]">{d.byTheme.map((t: any) => (
            <div key={t.name} className="flex items-center gap-2"><span className="w-2 h-2 rounded-full" style={{ background: t.color }} /><span className="text-gray-600 flex-1 truncate">{t.name}</span><span className="font-semibold text-gray-900 tabular-nums">{t.n}</span></div>
          ))}</div> : <p className="text-sm text-gray-400 py-4 text-center">No campaigns.</p>}
        </Card>
      </div>

      <Foot>PPE-005 — the initiative portfolio over ppe_campaigns (linked to themes/objectives + generated ppe_actions). Budget, sponsor, progress and timelines are real from the framework. Milestone tracking &amp; risk registers are the next build phase.</Foot>
    </div>
  );
}
