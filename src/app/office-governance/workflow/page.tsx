import { ogsGuard, Head, Stat, Card, Pill, Donut, Legend, Bars, Table, Foot } from "../_ui";
import { loadOgsWorkflow } from "@/lib/ogs/workflow";

export const dynamic = "force-dynamic";

// OGS-007 Notifications, Communications & Workflow.
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function OgsWorkflowPage() {
  const { admin, isSuper, hid } = await ogsGuard();
  const d = await loadOgsWorkflow(admin, hid, isSuper);
  const head = <Head code="OGS-007 · Office Governance System" title="Notifications, Communications & Workflow" sub="Automate notifications, approvals and communications across all governance offices." />;
  if (!d.provisioned) return <div className="space-y-4">{head}<Card><p className="text-sm text-gray-400">The notification store (<code>notifications</code>) is not provisioned yet.</p></Card></div>;
  const k = d.kpis;

  return (
    <div className="space-y-4">
      {head}
      {d.empty && <div className="bg-[var(--cmp-surface-information)] border border-[var(--cmp-color-information)] rounded-xl p-3 text-[12px] text-blue-800">No notifications, delivery attempts or approval requests in the recent window yet — the notification centre, workflow mix and delivery status populate as the notification &amp; approval engines run.</div>}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat icon="🔔" tone={k.unread ? "amber" : "emerald"} label="Unread notifications" value={k.unread} sub="last 30 days" />
        <Stat icon="📬" tone="blue" label="Total notifications" value={k.total} sub="last 30 days" />
        <Stat icon="🗳️" tone="indigo" label="Pending approvals" value={k.pendingApprovals} />
        <Stat icon="🔄" tone="violet" label="In flight" value={k.inFlight} sub="approvals + changes" />
        <Stat icon="⏰" tone={k.overdue ? "rose" : "emerald"} label="Overdue (>14d)" value={k.overdue} />
        <Stat icon="📡" tone={k.deliverySuccess != null && k.deliverySuccess >= 90 ? "emerald" : k.deliverySuccess != null ? "amber" : "slate"} label="Delivery success" value={k.deliverySuccess != null ? `${k.deliverySuccess}%` : "—"} sub="sent / attempted" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Notification centre" className="xl:col-span-2" right={d.scopeNote}>
          {d.notifList.length ? <div className="space-y-1">{d.notifList.map((n: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-[12px] border-b border-gray-50 py-1.5">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${n.read ? "bg-gray-300" : "bg-teal-500"}`} />
              <span className={`flex-1 truncate ${n.read ? "text-gray-500" : "text-gray-800 font-medium"}`}>{n.title}</span>
              <Pill text={n.type} tone="slate" />
              <span className="text-gray-400 text-[10px] tabular-nums w-24 text-right">{n.when ? new Date(n.when).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</span>
            </div>
          ))}</div> : <p className="text-sm text-gray-400 py-6 text-center">No notifications in the recent window.</p>}
        </Card>

        <Card title="Workflow overview" right="by type">
          {d.workflowDonut.length ? <div className="flex items-center gap-2"><Donut segments={d.workflowDonut} total={d.workflowDonut.reduce((s: number, x: any) => s + x.value, 0)} label="Workflows" size={120} /><Legend items={d.workflowDonut.map((s: any) => ({ label: s.label, value: s.value, tone: s.tone }))} /></div> : <p className="text-sm text-gray-400 py-6 text-center">No approval workflows yet.</p>}
        </Card>
      </div>

      <Card title="Pending approvals" right="oldest first · overdue after 14 days">
        <Table cols={["Item", "Workflow", "Step", "Requested by", "Age"]} rows={d.pendingRows.map((r: any) => [
          <span key="e" className="font-medium text-gray-800">{r.entity}</span>,
          <span key="w" className="text-gray-500 capitalize">{r.workflow}</span>,
          <span key="s" className="tabular-nums text-gray-500">{r.step}</span>,
          <span key="b" className="text-gray-500">{r.requestedBy}</span>,
          <span key="a" className={`tabular-nums font-semibold ${r.overdue ? "text-[var(--cmp-text-error)]" : "text-gray-600"}`}>{r.age}d{r.overdue ? " · overdue" : ""}</span>,
        ])} empty="No pending approvals." />
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Delivery by channel" right="recent · multi-channel">
          {d.channelBars.length ? <Bars items={d.channelBars} /> : <p className="text-sm text-gray-400 py-6 text-center">No delivery attempts in the recent window.</p>}
        </Card>

        <Card title="Delivery status">
          {d.statusDonut.length ? <div className="flex items-center gap-2"><Donut segments={d.statusDonut} total={d.statusDonut.reduce((s: number, x: any) => s + x.value, 0)} label="Attempts" size={120} /><Legend items={d.statusDonut.map((s: any) => ({ label: s.label, value: s.value, tone: s.tone }))} /></div> : <p className="text-sm text-gray-400 py-6 text-center">No delivery attempts yet.</p>}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Escalations" right="derived · pending >14d">
          {d.escalations.length ? <div className="space-y-2">{d.escalations.map((e: any, i: number) => (
            <div key={i} className="flex items-start gap-2">
              <span className="w-2 h-2 rounded-full mt-1.5 shrink-0 bg-[var(--cmp-color-error)]" />
              <div className="min-w-0 flex-1"><p className="text-[12px] font-medium text-gray-800 leading-snug truncate">{e.entity}</p><p className="text-[11px] text-gray-500 capitalize">{e.workflow} · {e.requestedBy}</p></div>
              <span className="text-[11px] font-semibold text-[var(--cmp-text-error)] tabular-nums shrink-0">{e.age}d</span>
            </div>
          ))}</div> : <p className="text-sm text-[var(--cmp-text-success)] py-6 text-center">No escalations — all pending approvals within the 14-day SLA.</p>}
        </Card>

        <Card title="Workflow performance" right="derived from timestamps">
          <Bars items={d.slaBars.map((b: any) => ({ label: b.label, pct: b.pct, value: b.value, tone: b.tone }))} />
          <p className="text-[10px] text-gray-400 mt-2">SLA buckets derived from real request → decision timestamps (14-day threshold). Configurable per-workflow SLAs are the next-phase engine.</p>
        </Card>
      </div>

      <Foot>OGS-007 — live over <code>notifications</code> (in-app message store) + <code>notif_deliveries</code> (multi-channel delivery: in-app, email, SMS, webhook, Teams, Slack) + <code>plat_approval_requests</code>/<code>plat_approval_decisions</code> (the approval workflow engine) + <code>change_requests</code> (governance change workflows). These are platform-global backbone tables (no <code>hospital_id</code>), so metrics aggregate across all tenants; escalations are derived honestly from approval age (&gt;14d). A visual workflow designer, configurable escalation rules / SLAs and office messaging &amp; announcements are the next-phase OGS-007 engine.</Foot>
    </div>
  );
}
