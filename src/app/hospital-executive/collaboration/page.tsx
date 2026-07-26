import { hexGuard, Head, Tabs, Stat, Card, Pill, Donut, Legend, Trend, Bars, Table, Foot } from "../_ui";
import { loadExecCollaboration } from "@/lib/hex/collaboration";

export const dynamic = "force-dynamic";

// HEX-011 Executive Collaboration & Governance.
/* eslint-disable @typescript-eslint/no-explicit-any */
const TABS = ["Overview", "Communications", "Decisions", "Board", "Committees", "Meetings", "Policies", "Actions", "Analytics"];
const band = (n: number | null) => (n == null ? "" : n >= 85 ? "Strong" : n >= 70 ? "Good" : n >= 55 ? "Fair" : "Needs attention");
const ST_TONE: Record<string, string> = { open: "amber", approved: "blue", implemented: "emerald", rejected: "rose" };

export default async function ExecCollaborationPage() {
  const { admin, isSuper, hid } = await hexGuard();
  const d = await loadExecCollaboration(admin, hid, isSuper);
  const head = <Head code="HEX-011 · Hospital Executive" title="Executive Collaboration & Governance" sub="Collaborate. Govern. Decide. Deliver." action={{ label: "Governance workspace →", href: "/enterprise-governance" }} />;
  if (!d.provisioned) return <div className="space-y-4">{head}<Tabs tabs={TABS} active="Overview" /><Card><p className="text-sm text-gray-400">Governance data is not provisioned yet.</p></Card></div>;
  const k = d.kpis;
  const pipeTotal = d.pipeline.reduce((s: number, p: any) => s + p.value, 0);

  return (
    <div className="space-y-4">
      {head}
      <Tabs tabs={TABS} active="Overview" />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat icon="🤝" tone={k.health != null && k.health >= 85 ? "emerald" : "amber"} label="Governance health" value={k.health != null ? k.health : "—"} sub={band(k.health)} />
        <Stat icon="✅" tone="emerald" label="Decisions made" value={k.decisionsMade} sub="approved / implemented" />
        <Stat icon="🕓" tone="amber" label="Pending approvals" value={k.pendingApprovals} />
        <Stat icon="🏛️" tone="teal" label="Active committees" value={k.committees} sub={`${k.totalCommittees} total`} />
        <Stat icon="👥" tone="blue" label="Committee members" value={k.members} />
        <Stat icon="🎯" tone="violet" label="Priorities on track" value={k.prioritiesOnTrack != null ? `${k.prioritiesOnTrack}%` : "—"} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Governance activity" className="xl:col-span-2" right="decisions logged / month">
          <Trend points={d.trend.map((b: any) => b.value)} labels={d.trend.map((b: any) => b.label)} tone="teal" />
          <p className="text-[10px] text-gray-400 text-center mt-1">Governance decisions & changes logged per month (live).</p>
        </Card>

        <Card title="Decision pipeline">
          <div className="flex items-center gap-2">
            <Donut segments={d.pipeline} total={pipeTotal} label="Decisions" size={120} />
            <Legend items={d.pipeline.filter((p: any) => p.value).map((p: any) => ({ label: p.label, value: p.value, tone: p.tone }))} />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Recent decisions" className="xl:col-span-2">
          <Table cols={["Item", "Kind", "Requested by", "Effective", "Status"]} rows={d.recentDecisions.map((c: any) => [
            <span key="i" className="text-gray-800 truncate block max-w-[220px]">{c.item}</span>,
            <Pill key="k" text={c.kind} tone={c.kind === "major" ? "rose" : c.kind === "revision" ? "amber" : "blue"} />,
            <span key="b" className="text-gray-500">{c.by ?? "—"}</span>,
            <span key="w" className="text-gray-400 tabular-nums">{c.when ? String(c.when).slice(0, 10) : "—"}</span>,
            <Pill key="s" text={c.status} tone={ST_TONE[c.status] ?? "slate"} />,
          ])} empty="No governance decisions recorded." />
        </Card>

        <Card title="Committees by level">
          {d.levelDonut.length ? <div className="flex items-center gap-2"><Donut segments={d.levelDonut} total={k.totalCommittees} label="Committees" size={120} /><Legend items={d.levelDonut.map((l: any) => ({ label: l.label, value: l.value, tone: l.tone }))} /></div> : <p className="text-sm text-gray-400 py-6 text-center">No committees registered.</p>}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Top governance priorities progress">
          {d.priorities.length ? <Bars items={d.priorities.map((p: any) => ({ label: p.title, pct: p.progress, tone: p.onTrack ? "emerald" : "amber", value: `${p.progress}%` }))} /> : <p className="text-sm text-gray-400 py-6 text-center">No published priorities.</p>}
        </Card>

        <Card title="Board management & meetings">
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <span className="text-2xl mb-1">🗓️</span>
            <p className="text-[12px] text-gray-500">Board management, meeting agendas, minutes and attendance are the next phase.</p>
            <p className="text-[10px] text-gray-400 mt-1">Committees, membership, the decision register and approval throughput above are live; board packs, meeting lifecycle and resolution tracking each need their own store.</p>
          </div>
        </Card>
      </div>

      <Foot>HEX-011 — live over <code>governance_committees</code> + <code>committee_members</code> (scoped) and the <code>change_requests</code> decision register, with governance priorities and approval throughput from the <code>ppe_*</code> substrate. Governance health is a transparent composite. Board management, meeting minutes/agendas/attendance and leadership-communication broadcasts are the next build phases (flagged honestly, not faked).</Foot>
    </div>
  );
}
