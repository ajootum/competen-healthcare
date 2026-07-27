import { ogsGuard, Head, Stat, Card, Pill, Donut, Legend, Bars, Table, Foot } from "../_ui";
import { loadOgsDecisions } from "@/lib/ogs/decisions";
import { loadFormalDecisions } from "@/lib/ogs/meetings";
import Link from "next/link";

export const dynamic = "force-dynamic";

// OGS-004 Meetings, Decisions & Governance Centre — plan meetings, capture decisions and ensure governance
// follow-through. The DECISIONS side is live over change_requests (the governance decision / change register)
// and the platform approval engine (plat_approval_requests / plat_approval_decisions). Meetings, agendas,
// attendance, quorum, minutes and formal voting have no store yet — they are the next-phase OGS-004 engine.
/* eslint-disable @typescript-eslint/no-explicit-any */
const KIND_TONE: Record<string, string> = { major: "rose", revision: "amber", minor: "blue" };
const STATUS_TONE: Record<string, string> = { approved: "emerald", implemented: "emerald", rejected: "rose", open: "amber" };

export default async function OgsDecisions() {
  const { admin, isSuper, hid } = await ogsGuard();
  const d = await loadOgsDecisions(admin, hid, isSuper);
  const head = <Head code="OGS-004 · Office Governance System" title="Meetings, Decisions & Governance" sub="Plan meetings, capture decisions and ensure governance follow-through." />;
  if (!d.provisioned) return <div className="space-y-4">{head}<Card><p className="text-sm text-gray-400">The governance decision register (<code>change_requests</code>) is not provisioned yet. Once its migration is applied, this module lights up with live decisions and approvals.</p></Card></div>;
  const k = d.kpis;
  const formal = await loadFormalDecisions(admin, hid, isSuper);
  const OUT_TONE: Record<string, string> = { carried: "emerald", rejected: "rose", deferred: "amber", tabled: "slate" };

  return (
    <div className="space-y-4">
      {head}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat icon="⚖️" tone="indigo" label="Decisions" value={k.total} sub="change register" />
        <Stat icon="✅" tone="emerald" label="Approved" value={k.approved} />
        <Stat icon="🚀" tone="teal" label="Implemented" value={k.implemented} />
        <Stat icon="⏳" tone="amber" label="Pending" value={k.pending} sub="decisions + approvals" />
        <Stat icon="⛔" tone={k.rejected ? "rose" : "emerald"} label="Rejected" value={k.rejected} />
        <Stat icon="📈" tone={k.implementationRate != null && k.implementationRate >= 70 ? "emerald" : "amber"} label="Implementation rate" value={k.implementationRate != null ? `${k.implementationRate}%` : "—"} sub="of decided" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Decision register" className="xl:col-span-2" right={d.scopeNote}>
          <Table
            cols={["Item", "Kind", "Requested by", "Effective / created", "Status"]}
            rows={d.register.map((r: any) => [
              <span key="i" className="font-medium text-gray-800">{r.item}</span>,
              <Pill key="k" text={r.kind} tone={KIND_TONE[r.kind] ?? "slate"} />,
              <span key="rb" className="text-gray-500">{r.requestedBy}</span>,
              <span key="dt" className="tabular-nums text-gray-500">{r.date}<span className="text-[10px] text-gray-400"> · {r.dated}</span></span>,
              <Pill key="s" text={r.status} tone={STATUS_TONE[r.status] ?? "slate"} />,
            ])}
            empty="No governance decisions recorded yet."
          />
        </Card>

        <Card title="Decisions by kind">
          <div className="flex items-center gap-2">
            <Donut segments={d.byKind} total={k.total} label="Decisions" size={130} />
            <Legend items={d.byKind.map((s: any) => ({ label: s.label, value: s.value, tone: s.tone, pct: k.total ? Math.round((s.value / k.total) * 100) : 0 }))} />
          </div>
          <p className="text-[10px] text-gray-400 mt-2">Major / minor / revision from <code>change_requests.change_kind</code>.</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Decisions by status">
          <Bars items={d.statusBars.map((s: any) => ({ label: s.label, pct: s.pct, tone: s.tone, value: s.value }))} />
        </Card>

        <Card title="Approval queue" className="xl:col-span-2" right="plat_approval_requests · pending">
          <Table
            cols={["Item", "Workflow", "Step", "Requested by"]}
            rows={d.queue.map((r: any) => [
              <span key="i" className="font-medium text-gray-800">{r.item}</span>,
              <span key="w" className="text-gray-600 capitalize">{r.workflow}</span>,
              <span key="st" className="tabular-nums text-gray-500">{r.step}</span>,
              <span key="rb" className="text-gray-500">{r.requestedBy}</span>,
            ])}
            empty="No approvals awaiting a decision."
          />
        </Card>
      </div>

      <Card title="Recent approval decisions" right="plat_approval_decisions">
        {d.recentDecisions.length ? (
          <div className="space-y-2">
            {d.recentDecisions.map((r: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-[12px]">
                <Pill text={r.decision} tone={r.decision === "approved" ? "emerald" : r.decision === "rejected" ? "rose" : "slate"} />
                <span className="font-medium text-gray-800 shrink-0">{r.actor}</span>
                <span className="text-gray-500 truncate flex-1 min-w-0">{r.note}</span>
                <span className="text-[11px] text-gray-400 tabular-nums shrink-0">{r.when}</span>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-gray-400 py-6 text-center">No approval decisions recorded yet.</p>}
      </Card>

      <Card title="Formal office decisions" right={<Link href="/office-governance/meetings" className="text-teal-600 hover:underline">Meetings &amp; Votes →</Link>}>
        {formal.provisioned && formal.decisions.length ? (
          <Table
            cols={["Decision", "Office", "Type", "Votes (for / against / abstain)", "Decided", "Outcome"]}
            rows={formal.decisions.map((r: any) => [
              <span key="t" className="font-medium text-gray-800">{r.title}</span>,
              <span key="o" className="text-gray-600">{r.office}</span>,
              <span key="ty" className="text-gray-500 capitalize">{r.type}</span>,
              <span key="v" className="tabular-nums text-gray-600">{r.votesFor} / {r.votesAgainst} / {r.votesAbstain}</span>,
              <span key="d" className="tabular-nums text-gray-500">{r.decidedAt ? new Date(r.decidedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—"}</span>,
              <Pill key="out" text={r.outcome} tone={OUT_TONE[r.outcome] ?? "slate"} />,
            ])}
            empty="No formal decisions recorded."
          />
        ) : (
          <p className="text-sm text-gray-400 py-6 text-center">{formal.provisioned ? <>No formal office decisions recorded yet — record them in <Link href="/office-governance/meetings" className="text-teal-600 hover:underline">Meetings &amp; Votes</Link>.</> : <>Run migrations 118/119 to enable formal meeting decisions &amp; voting.</>}</p>
        )}
      </Card>

      <Foot>OGS-004 — the register aggregates three real sources: <code>change_requests</code> (the organisation-wide governance decision / change register), the platform approval engine <code>plat_approval_requests</code> / <code>plat_approval_decisions</code> (the multi-step approval queue &amp; recent decisions), and now <strong>formal office decisions</strong> from <code>ogs_decisions</code> — the vote-tallied resolutions taken at office meetings (see <Link href="/office-governance/meetings" className="text-teal-600 hover:underline">Meetings &amp; Votes</Link> for the full meeting lifecycle: agenda, attendance, quorum, minutes and voting). Per-member roll-call voting and e-signatures are the next refinement.</Foot>
    </div>
  );
}
