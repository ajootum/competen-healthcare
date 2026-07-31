import { ogsGuard, Head, Stat, Card, Pill, Donut, Legend, Trend, Bars, Foot } from "../_ui";
import { loadOgsIntegration } from "@/lib/ogs/integration";

export const dynamic = "force-dynamic";

// OGS-010 Office Integration, APIs & Platform Services.
/* eslint-disable @typescript-eslint/no-explicit-any */
const ST_TONE: Record<string, string> = { processed: "emerald", pending: "amber", failed: "rose", dead_letter: "rose" };

export default async function OgsIntegrationPage() {
  const { admin, isSuper, hid } = await ogsGuard();
  const d = await loadOgsIntegration(admin, hid, isSuper);
  const head = <Head code="OGS-010 · Office Governance System" title="Office Integration, APIs & Platform Services" sub="Seamless integration across all workspaces, platform services and external systems through secure events." />;
  if (!d.provisioned) return <div className="space-y-4">{head}<Card><p className="text-sm text-gray-400">The event backbone (<code>domain_events</code>) is not provisioned yet.</p></Card></div>;
  const k = d.kpis;

  return (
    <div className="space-y-4">
      {head}
      {d.empty && <div className="bg-[var(--cmp-surface-information)] border border-[var(--cmp-color-information)] rounded-xl p-3 text-[12px] text-blue-800">No domain events emitted yet — the stream, flows and delivery status populate as producers publish to <code>domain_events</code>. The platform-service catalogue and workspace map below are structural.</div>}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat icon="📡" tone="blue" label="Events processed (today)" value={k.processedToday} />
        <Stat icon="✅" tone="emerald" label="Success rate" value={k.successRate != null ? `${k.successRate}%` : "—"} />
        <Stat icon="🕓" tone="amber" label="Pending events" value={k.pending} />
        <Stat icon="⛔" tone={k.failed ? "rose" : "emerald"} label="Failed" value={k.failed} />
        <Stat icon="🔗" tone="teal" label="Active event types" value={k.activeEventTypes} />
        <Stat icon="⚙️" tone="violet" label="Platform services" value={k.services} sub="connected" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Event volume" className="xl:col-span-2" right="last 6 months">
          {d.trend.length >= 2 ? <Trend points={d.trend.map((t: any) => t.value)} labels={d.trend.map((t: any) => t.label)} tone="blue" /> : <p className="text-sm text-gray-400 py-8 text-center">Not enough event history yet.</p>}
        </Card>

        <Card title="Delivery status">
          {d.deliveryDonut.length ? <div className="flex items-center gap-2"><Donut segments={d.deliveryDonut} total={d.deliveryDonut.reduce((s: number, x: any) => s + x.value, 0)} label="Events" size={120} /><Legend items={d.deliveryDonut.map((s: any) => ({ label: s.label, value: s.value, tone: s.tone }))} /></div> : <p className="text-sm text-gray-400 py-6 text-center">No events yet.</p>}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Business event stream" className="xl:col-span-2" right="live">
          {d.stream.length ? <div className="space-y-1">{d.stream.map((e: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-[12px] border-b border-gray-50 py-1"><span className="font-mono text-[11px] text-gray-700 flex-1 truncate">{e.type}</span><span className="text-gray-400 text-[11px] truncate w-32">{e.subject}</span><span className="text-gray-400 text-[10px] tabular-nums w-28">{e.when ? new Date(e.when).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</span><Pill text={e.status} tone={ST_TONE[e.status] ?? "slate"} /></div>
          ))}</div> : <p className="text-sm text-gray-400 py-6 text-center">No events emitted yet.</p>}
        </Card>

        <Card title="Top integration flows">
          {d.topFlows.length ? <Bars items={d.topFlows.map((f: any) => ({ label: f.label, pct: f.n, value: `${f.n}` }))} /> : <p className="text-sm text-gray-400 py-6 text-center">No flows yet.</p>}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Workspace integrations" right="structural · live-derived">
          <div className="grid grid-cols-2 gap-2">
            {d.workspaceHealth.map((w: any, i: number) => (
              <div key={i} className="flex items-center gap-2 border border-gray-100 rounded-lg px-2.5 py-1.5 text-[12px]"><span className={`w-1.5 h-1.5 rounded-full shrink-0 ${w.live ? "bg-[var(--cmp-color-success)]" : "bg-gray-300"}`} /><span className="text-gray-700 flex-1 truncate">{w.name}</span><span className="text-[10px] text-gray-400">{w.live ? "live" : "—"}</span></div>
            ))}
          </div>
        </Card>

        <Card title="Platform services" right="connected">
          <div className="grid grid-cols-2 gap-2">
            {d.services.map((s: string, i: number) => (
              <div key={i} className="flex items-center gap-2 border border-gray-100 rounded-lg px-2.5 py-1.5 text-[12px]"><span className="w-1.5 h-1.5 rounded-full bg-teal-500 shrink-0" /><span className="text-gray-700 flex-1 truncate">{s}</span></div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-2">Platform services are structural connections; live event throughput drives the stream/flows above.</p>
        </Card>
      </div>

      <Foot>OGS-010 — live over <code>domain_events</code> (the transactional event backbone): event volume, stream, top flows, delivery status and per-workspace flow are real and tenant-scoped. The platform-service catalogue and workspace map are structural; a published API registry with endpoint metrics, retry/replay controls and no-code event-subscription config are the next build phase.</Foot>
    </div>
  );
}
