import { loadGovernance } from "@/lib/priorities/modules";
import { ppeGuard, Head, ModuleNav, Card, Stat, Pill, Provision, Foot, STATUS_TONE } from "../_ui";

export const dynamic = "force-dynamic";

// PPE-008 Priority Governance & Approval Workflow — the approval queue, decisions, entity breakdown and the
// immutable audit trail over the framework.
/* eslint-disable @typescript-eslint/no-explicit-any */
const fmtDate = (t: string | null) => { if (!t) return ""; try { return new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }); } catch { return ""; } };

export default async function GovernancePage() {
  const { admin } = await ppeGuard();
  const d = await loadGovernance(admin) as any;
  const head = <Head code="PPE-008 · Priority & Execution Framework" title="Priority Governance & Approval Workflow" sub="Route strategic changes through approval workflows, capture decisions and evidence, and maintain an immutable audit trail." />;
  if (!d.provisioned) return <div className="max-w-[1400px] space-y-4">{head}<ModuleNav active="008" /><Provision module="Governance" /></div>;

  const k = d.kpis;
  return (
    <div className="max-w-[1400px] space-y-4">
      {head}
      <ModuleNav active="008" />
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat label="Total Requests" value={k.total} sub="all time" />
        <Stat label="Pending" value={k.pending} sub="awaiting decision" tone={k.pending ? "text-amber-600" : undefined} />
        <Stat label="Changes Requested" value={k.changesRequested} sub="returned" tone={k.changesRequested ? "text-amber-600" : undefined} />
        <Stat label="Approved" value={k.approved} sub="signed off" tone="text-emerald-600" />
        <Stat label="Rejected" value={k.rejected} sub="declined" tone={k.rejected ? "text-rose-600" : undefined} />
        <Stat label="Avg Decision" value={k.avgDays != null ? `${k.avgDays}d` : "—"} sub="turnaround" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Approval Queue" right={<span className="text-[11px] text-gray-400">{d.queue.length} open</span>}>
          {d.queue.length ? <div className="space-y-2">{d.queue.map((a: any) => (
            <div key={a.id} className="border border-gray-100 rounded-lg p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><p className="text-[12px] font-medium text-gray-900 leading-tight">{a.entity_title}</p><p className="text-[10px] text-gray-400 capitalize">{a.entity_type} · {a.scopeLabel} · {a.workflow} workflow</p></div>
                <Pill text={a.state} tone={STATUS_TONE[a.state]} />
              </div>
              <div className="flex items-center justify-between mt-1.5 text-[10px] text-gray-400"><span>by {a.requester} · step {a.step}/{a.total_steps}</span>{a.decision_reason && <span className="text-amber-600 truncate max-w-[55%]">“{a.decision_reason}”</span>}</div>
            </div>
          ))}</div> : <p className="text-sm text-gray-400 py-6 text-center">Queue clear. ✅</p>}
          {d.byEntity.length > 0 && <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100 text-[10px] text-gray-500">{d.byEntity.map((e: any) => <span key={e.type} className="capitalize">{e.type}: <b className="text-gray-800">{e.n}</b></span>)}</div>}
        </Card>

        <Card title="Recent Decisions">
          {d.decided.length ? <div className="space-y-2">{d.decided.map((a: any) => (
            <div key={a.id} className="flex items-start gap-2"><Pill text={a.state} tone={STATUS_TONE[a.state]} /><div className="min-w-0 flex-1"><p className="text-[12px] text-gray-800 leading-tight truncate">{a.entity_title}</p><p className="text-[10px] text-gray-400">{a.decider ? `by ${a.decider}` : ""} {a.decided_at ? `· ${fmtDate(a.decided_at)}` : ""}{a.decision_reason ? ` · ${a.decision_reason}` : ""}</p></div></div>
          ))}</div> : <p className="text-sm text-gray-400 py-6 text-center">No decisions yet.</p>}
        </Card>
      </div>

      <Card title="Audit Trail" right={<span className="text-[11px] text-gray-400">immutable · {d.audit.length} entries</span>}>
        {d.audit.length ? <div className="space-y-1.5 max-h-80 overflow-y-auto">{d.audit.map((a: any) => (
          <div key={a.id} className="flex items-start gap-2 text-[11px]"><Pill text={a.action} tone="teal" /><span className="text-gray-700 flex-1">{a.detail}</span><span className="text-gray-400 shrink-0">{a.actor} · {fmtDate(a.created_at)}</span></div>
        ))}</div> : <p className="text-sm text-gray-400 py-4 text-center">No audit entries.</p>}
      </Card>

      <Foot>PPE-008 — governance over ppe_approvals + the immutable ppe_audit trail. Approval queue, decisions and audit are real from the framework. Approval-workflow designer &amp; electronic-signature capture are the next build phase; decision routing is currently seeded per entity.</Foot>
    </div>
  );
}
