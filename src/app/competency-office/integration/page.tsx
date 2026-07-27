import { loadCmoIntegration } from "@/lib/competency/cmo-integration";
import { cmoGuard, Head, Card, Kpi, Pill, Bars, Donut, Provision, Foot } from "../_cmo-ui";

export const dynamic = "force-dynamic";

// CMO-005 Cross-Workspace Integration Framework — the Competency Office's integration lens over the real
// domain-event backbone (domain_events, migration 102). Event volume, the business-event stream, top flows,
// delivery-status split and failure alerts are REAL; the cross-workspace map + per-workspace health are
// STRUCTURAL/derived (event-type routing, never fabricated uptime). Tenant-scoped.
/* eslint-disable @typescript-eslint/no-explicit-any */
const STATUS_TONE: Record<string, string> = { processed: "emerald", pending: "amber", failed: "rose", dead_letter: "rose" };
const fmtT = (t: string | null) => { if (!t) return "—"; try { return new Date(t).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return "—"; } };

export default async function CrossWorkspaceIntegrationPage() {
  const { admin, isSuper, hid } = await cmoGuard();
  const d = await loadCmoIntegration(admin, hid, isSuper);
  const head = <Head code="CMO-005 · Competency Office" title="Cross-Workspace Integration" sub="Seamless integration, unified workflows and real-time competency intelligence." />;
  if (!d.provisioned) return <div className="max-w-[1400px] space-y-4">{head}<Provision module="Cross-Workspace Integration" /></div>;
  const k = d.kpis;
  const donutSegs = d.statusDonut.filter((s: any) => s.value > 0);

  return (
    <div className="max-w-[1400px] space-y-4">
      {head}

      {d.empty && <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-[12px] text-blue-800">The event backbone (<code>domain_events</code>) is provisioned but no events have been emitted yet. Volumes, the stream, flows and delivery status populate as producers emit events; the structural map and workspace catalogue below are meaningful regardless.</div>}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Events processed" value={k.processedToday} sub="today" tone="text-emerald-600" />
        <Kpi label="Success rate" value={k.successRate == null ? "—" : `${k.successRate}%`} sub="processed vs failed" tone={k.successRate != null && k.successRate < 90 ? "text-amber-600" : undefined} />
        <Kpi label="Pending events" value={k.pending} sub="awaiting dispatch" tone={k.pending ? "text-amber-600" : undefined} />
        <Kpi label="Failed" value={k.failedTotal} sub="failed + dead-letter" tone={k.failedTotal ? "text-rose-600" : undefined} />
        <Kpi label="Total events" value={k.totalWindow} sub="last 30 days" />
        <Kpi label="Active event types" value={k.activeEventTypes} sub="distinct · 30 days" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Business event stream" className="xl:col-span-2" right={<span className="text-[11px] text-gray-400">live · domain_events</span>}>
          {d.stream.length ? <div className="space-y-1">
            <div className="flex items-center text-[10px] text-gray-400 uppercase tracking-wide px-1"><span className="flex-1">Event type</span><span className="w-40">Subject</span><span className="w-28">Actor</span><span className="w-28">When</span><span className="w-20 text-right">Status</span></div>
            {d.stream.map((e: any, i: number) => (
              <div key={i} className="flex items-center px-1 py-1.5 text-[12px] border-b border-gray-50">
                <span className="flex-1 font-mono text-[11px] text-gray-800 truncate">{e.type}</span>
                <span className="w-40 text-gray-500 text-[11px] truncate">{e.subject ?? "—"}</span>
                <span className="w-28 text-gray-500 text-[11px] truncate">{e.actor ?? "system"}</span>
                <span className="w-28 text-gray-400 text-[11px] tabular-nums">{fmtT(e.when)}</span>
                <span className="w-20 text-right"><Pill text={e.status ?? "—"} tone={STATUS_TONE[e.status] ?? "slate"} /></span>
              </div>
            ))}
          </div> : <p className="text-sm text-gray-400 py-8 text-center">No business events emitted yet.</p>}
        </Card>

        <Card title="Delivery status" right={<span className="text-[11px] text-gray-400">{d.statusTotal} in window</span>}>
          {donutSegs.length ? <div className="flex items-center gap-3">
            <Donut segs={donutSegs.map((s: any) => ({ n: s.value, color: s.color }))} total={d.statusTotal} centre={d.statusTotal} sub="events" size={110} />
            <div className="flex-1 space-y-1 text-[11px]">{donutSegs.map((s: any) => <div key={s.label} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: s.color }} /><span className="text-gray-600 flex-1">{s.label}</span><span className="font-semibold text-gray-900 tabular-nums">{s.value}</span></div>)}</div>
          </div> : <p className="text-sm text-gray-400 py-8 text-center">No delivery data yet.</p>}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Top integration flows" className="xl:col-span-2" right={<span className="text-[11px] text-gray-400">by event type · 30 days</span>}>
          {d.flows.length ? <Bars rows={d.flows.map((f: any) => ({ label: f.label, n: f.n }))} /> : <p className="text-sm text-gray-400 py-8 text-center">No event flows recorded yet.</p>}
          <p className="text-[10px] text-gray-400 mt-2">Live counts of each business event type across the last 30 days (<code>domain_events.event_type</code>).</p>
        </Card>

        <Card title="Integration health monitor" right={<span className="text-[11px] text-gray-400">{d.liveWorkspaces}/{d.workspaces.length} live</span>}>
          <div className="space-y-1">
            {d.workspaces.map((w: any) => (
              <div key={w.name} className="flex items-center gap-2 text-[12px] border-b border-gray-50 py-1.5">
                <span className="shrink-0">{w.icon}</span>
                <span className="flex-1 text-gray-700 truncate">{w.name}</span>
                <span className="text-gray-400 tabular-nums text-[11px] w-10 text-right">{w.volume || ""}</span>
                {w.live ? <Pill text="live" tone="emerald" /> : <span className="text-[10px] text-gray-300 w-16 text-right">no events</span>}
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-2">Derived: a workspace shows <b>live</b> when recent events route to it (by event-type/subject mapping). Structural signal from event flow — not a per-workspace uptime metric.</p>
        </Card>
      </div>

      <Card title="Cross-workspace integration map" right={<span className="text-[11px] text-gray-400">structural</span>}>
        <div className="flex flex-col items-center">
          <div className="mb-3 w-20 h-20 rounded-2xl bg-teal-600 text-white flex flex-col items-center justify-center shadow-sm shrink-0">
            <span className="text-base font-bold leading-none">CMO</span>
            <span className="text-[9px] opacity-80 mt-0.5">at centre</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2 w-full">
            {d.workspaces.map((w: any) => (
              <div key={w.name} className={`rounded-xl border p-2.5 text-center ${w.live ? "border-teal-200 bg-teal-50/40" : "border-gray-100 bg-white"}`}>
                <div className="text-lg leading-none">{w.icon}</div>
                <p className="text-[11px] font-medium text-gray-700 mt-1 leading-tight">{w.name}</p>
                <p className="mt-1 text-[10px] tabular-nums">{w.live ? <span className="text-teal-600 font-semibold">{w.volume} events</span> : <span className="text-gray-300">—</span>}</p>
              </div>
            ))}
          </div>
        </div>
        <p className="text-[10px] text-gray-400 mt-3">The Competency Office sits at the centre of the Competen workspace mesh (CMO-000/005). The connections shown are <b>structural</b>; per-workspace event volume is live from <code>domain_events</code> routed by event type. Per-workspace routing configuration and no-code event subscriptions are the next phase.</p>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Core business events" className="xl:col-span-2" right={<span className="text-[11px] text-gray-400">event catalogue · reference</span>}>
          <div className="flex flex-wrap gap-1.5">
            {d.coreEvents.map((e: string) => <span key={e} className="text-[11px] rounded-full border border-gray-200 bg-gray-50 text-gray-600 px-2.5 py-1">{e}</span>)}
          </div>
          <p className="text-[10px] text-gray-400 mt-2">The CMO-005 event taxonomy competencies emit across the platform. Static reference; live occurrences appear in the stream and flows above as producers emit them.</p>
        </Card>

        <Card title="Recent integration alerts" right={<span className="text-[11px] text-gray-400">delivery failures</span>}>
          {d.alerts.length ? <div className="space-y-2">{d.alerts.map((a: any, i: number) => (
            <div key={i} className="flex items-start gap-2"><span className="w-2 h-2 rounded-full mt-1.5 shrink-0 bg-rose-500" /><div className="min-w-0"><p className="text-[12px] font-medium text-gray-800 leading-snug truncate font-mono">{a.type}</p><p className="text-[11px] text-gray-500">{a.subject ?? "—"} · {fmtT(a.when)} · {String(a.status).replace(/_/g, " ")}</p></div></div>
          ))}</div> : <div className="py-6 text-center"><p className="text-sm text-emerald-600">✓ No delivery failures</p><p className="text-[10px] text-gray-400 mt-1">No events in a failed or dead-letter state in the last 30 days.</p></div>}
        </Card>
      </div>

      <Foot>CMO-005 — live over <code>domain_events</code> (migration 102, the transactional event backbone): event volumes, the business-event stream, top flows, the delivery-status split and failure alerts are all real and tenant-scoped. The cross-workspace map and per-workspace health are <b>structural</b> — derived by routing event types/subjects to workspaces, never fabricated uptime. Per-workspace routing configuration, retry/replay controls and no-code event-subscription config are the next phase.</Foot>
    </div>
  );
}
