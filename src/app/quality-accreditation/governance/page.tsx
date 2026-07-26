import { qaGuard, Head, Tabs, Stat, Card, Pill, Donut, Legend, Trend, Bars, Table, Foot } from "../_ui";
import { loadGovernance } from "@/lib/qaw/governance";

export const dynamic = "force-dynamic";

// QAW-011 Quality Governance & Committee Centre.
/* eslint-disable @typescript-eslint/no-explicit-any */
const TABS = ["Overview", "Committees", "Meetings", "Decisions & Actions", "Policies & Approvals", "Strategy & Objectives", "Governance Documents", "Board Reporting", "Settings"];
const LEVEL_TONE: Record<string, string> = { enterprise: "violet", country: "indigo", facility: "teal", department: "blue", specialty: "amber" };
const ST_TONE: Record<string, string> = { open: "amber", approved: "blue", implemented: "emerald", rejected: "rose" };

export default async function GovernancePage() {
  const { admin, isSuper, hid } = await qaGuard();
  const d = await loadGovernance(admin, hid, isSuper);
  const head = <Head code="QAW-011 · Quality & Accreditation" title="Quality Governance & Committee Centre" sub="Oversee quality governance, committees, decisions, policies and organisational oversight." action={{ label: "+ Add committee", href: "/enterprise-governance" }} />;
  if (!d.provisioned) return <div className="space-y-4">{head}<Tabs tabs={TABS} active="Overview" /><Card><p className="text-sm text-gray-400">Governance committees are not provisioned yet.</p></Card></div>;
  const k = d.kpis;

  return (
    <div className="space-y-4">
      {head}
      <Tabs tabs={TABS} active="Overview" />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat icon="🏛️" tone="teal" label="Active committees" value={k.committees} sub={`${k.totalCommittees} total`} />
        <Stat icon="👥" tone="blue" label="Committee members" value={k.members} sub="distinct" />
        <Stat icon="✅" tone="emerald" label="Governance decisions" value={k.decisions} sub="change register" />
        <Stat icon="🕓" tone="amber" label="Pending review" value={k.pending} />
        <Stat icon="🚀" tone="violet" label="Implemented" value={k.implemented} />
        <Stat icon="📄" tone="indigo" label="Policies under review" value={k.policiesUnderReview} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Committees" className="xl:col-span-2" right={`${k.totalCommittees}`}>
          <Table cols={["Committee", "Level", "Members", "Chair", "Quorum", "Status"]} rows={d.committees.map((c: any) => [
            <span key="n" className="font-medium text-gray-800">{c.name}</span>,
            <Pill key="l" text={c.level} tone={LEVEL_TONE[c.level] ?? "slate"} />,
            <span key="m" className="tabular-nums text-gray-600">{c.members}</span>,
            <span key="ch" className="tabular-nums text-gray-500">{c.chairs}</span>,
            <span key="q" className="tabular-nums text-gray-400">{c.quorum ?? "—"}</span>,
            <Pill key="s" text={c.active ? "active" : "inactive"} tone={c.active ? "emerald" : "slate"} />,
          ])} empty="No committees registered." />
        </Card>

        <Card title="Committees by level">
          {d.levelDonut.length ? <div className="flex items-center gap-2"><Donut segments={d.levelDonut} total={k.totalCommittees} label="Committees" size={130} /><Legend items={d.levelDonut.map((l: any) => ({ label: l.label, value: l.value, tone: l.tone }))} /></div> : <p className="text-sm text-gray-400 py-6 text-center">No committees.</p>}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Decisions by kind">
          {d.kindDonut.length ? <div className="flex items-center gap-2"><Donut segments={d.kindDonut} total={k.decisions} label="Decisions" size={120} /><Legend items={d.kindDonut.map((x: any) => ({ label: x.label, value: x.value, tone: x.tone }))} /></div> : <p className="text-sm text-gray-400 py-6 text-center">No decisions recorded.</p>}
        </Card>

        <Card title="Decision status">
          <Bars items={d.statusBars.filter((s: any) => s.value > 0).map((s: any) => ({ label: s.label, pct: k.decisions ? Math.round((s.value / k.decisions) * 100) : 0, tone: s.tone, value: s.value }))} />
        </Card>

        <Card title="Decisions trend" right="last 6 months">
          <Trend points={d.trend.map((b: any) => b.value)} labels={d.trend.map((b: any) => b.label)} tone="teal" />
          <p className="text-[10px] text-gray-400 text-center mt-1">Governance decisions logged per month.</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Recent decisions & changes">
          <Table cols={["Item", "Kind", "Requested by", "Effective", "Status"]} rows={d.recent.map((c: any) => [
            <span key="e" className="text-gray-800 truncate block max-w-[220px]">{c.entity}</span>,
            <Pill key="k" text={c.kind} tone={c.kind === "major" ? "rose" : c.kind === "revision" ? "amber" : "blue"} />,
            <span key="b" className="text-gray-500">{c.by ?? "—"}</span>,
            <span key="w" className="text-gray-400 tabular-nums">{c.when ? String(c.when).slice(0, 10) : "—"}</span>,
            <Pill key="s" text={c.status} tone={ST_TONE[c.status] ?? "slate"} />,
          ])} empty="No governance changes recorded." />
        </Card>

        <Card title="Meetings, minutes & maturity">
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <span className="text-2xl mb-1">🗓️</span>
            <p className="text-[12px] text-gray-500">Meeting management, minutes and the governance-maturity model are the next phase.</p>
            <p className="text-[10px] text-gray-400 mt-1">Committees, membership and the decision/change register above are live; agendas, minutes, attendance, board reporting and maturity scoring need their own stores.</p>
          </div>
        </Card>
      </div>

      <Foot>QAW-011 — live over <code>governance_committees</code> + <code>committee_members</code> (hospital-scoped) and <code>change_requests</code> (the global governance change/decision register). Committee registry, membership, decision mix, status and trend are real. Meeting lifecycle (agenda / minutes / attendance), board reporting and governance-maturity scoring are the next build phases.</Foot>
    </div>
  );
}
