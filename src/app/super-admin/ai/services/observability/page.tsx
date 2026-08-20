import { requireHqCapability } from "@/lib/hq/context";
import { loadAiObservability, loadAiEvals } from "@/lib/ai/services";
import { Head, Tabs, Card, Stat, Pill, Bars, Provision, Foot } from "../_ui";

export const dynamic = "force-dynamic";

// AIS-011 AI Observability, Testing & Evaluation — end-to-end telemetry over the real plat_ai_requests written by the
// AI Runtime Gateway's generate() choke point: volume, tokens, cost, latency, errors and refusals.
/* eslint-disable @typescript-eslint/no-explicit-any */
const STATUS_TONE: Record<string, string> = { ok: "emerald", refusal: "amber", error: "rose", not_configured: "slate" };

export default async function ObservabilityPage() {
  const { admin } = await requireHqCapability("hq.platform.ai.view");
  const [d, ev] = await Promise.all([loadAiObservability(admin), loadAiEvals(admin)]) as any[];
  const head = <Head code="AIS-011 · AI Services Platform" title="AI Observability, Testing & Evaluation" sub="End-to-end telemetry over every AI call the platform makes — volume, tokens, cost, latency, errors and refusals, from the real plat_ai_requests gateway log." />;
  if (!d.provisioned) return <div className="max-w-[1500px] space-y-4">{head}<Tabs active="011" /><Provision /></div>;

  const s = d.summary;
  const maxN = Math.max(1, ...d.trend.map((t: any) => t.n));
  const maxCost = Math.max(0.01, ...d.trend.map((t: any) => t.cost));
  return (
    <div className="max-w-[1500px] space-y-4">
      {head}<Tabs active="011" />
      {!s.ready && <div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-lg p-3 text-[12px] text-amber-800">Telemetry table not applied — apply migration 055 (ai-gateway). Every server-side AI call logs here automatically once ready.</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <Stat label="Requests (24h)" value={s.requests24h.toLocaleString()} sub={`${s.totalRequests.toLocaleString()} all-time`} />
        <Stat label="Tokens (24h)" value={s.tokens24h >= 1000 ? `${Math.round(s.tokens24h / 1000)}k` : s.tokens24h} sub="in + out" />
        <Stat label="Cost (24h)" value={`$${s.cost24h}`} sub={`$${s.totalCost} all-time`} tone="text-violet-700" />
        <Stat label="Avg Latency" value={s.avgLatencyMs != null ? `${s.avgLatencyMs}ms` : "—"} sub="24h" />
        <Stat label="Errors (24h)" value={s.errors24h} sub="upstream" tone={s.errors24h ? "text-[var(--cmp-text-error)]" : undefined} />
        <Stat label="Refusals (24h)" value={s.refusals24h} sub="safety" tone={s.refusals24h ? "text-[var(--cmp-text-warning)]" : undefined} />
        <Stat label="Success Rate" value={`${s.requests24h ? Math.round(((s.requests24h - s.errors24h - s.refusals24h) / s.requests24h) * 100) : 100}%`} sub="24h" tone="text-[var(--cmp-text-success)]" />
        <Stat label="Window Rows" value={d.windowRows.toLocaleString()} sub="last 7 days" />
      </div>

      <Card title="Request & Cost Trend" right={<span className="text-[11px] text-gray-500">last 7 days</span>}>
        {d.trend.some((t: any) => t.n) ? (
          <div className="flex items-end gap-2 h-32">{d.trend.map((t: any) => (
            <div key={t.d} className="flex-1 flex flex-col items-center gap-1" title={`${t.d}: ${t.n} calls · $${t.cost} · ${t.err} errors`}>
              <div className="w-full flex items-end justify-center gap-0.5" style={{ height: "104px" }}>
                <div className="w-2.5 bg-violet-500 rounded-t" style={{ height: `${(t.n / maxN) * 100}%` }} />
                <div className="w-2.5 bg-[var(--cmp-color-success)] rounded-t" style={{ height: `${(t.cost / maxCost) * 100}%` }} />
              </div>
              <span className="text-[8px] text-gray-500">{t.d}</span>
            </div>
          ))}</div>
        ) : <p className="text-sm text-gray-500 py-8 text-center">No telemetry in the last 7 days.</p>}
        <div className="flex gap-3 mt-1 text-[10px] text-gray-500"><span className="flex items-center gap-1"><span className="w-2 h-2 bg-violet-500 rounded-full" />Requests</span><span className="flex items-center gap-1"><span className="w-2 h-2 bg-[var(--cmp-color-success)] rounded-full" />Cost</span></div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="By Model">{d.byModel.length ? <Bars rows={d.byModel.map((m: any) => ({ label: m.label, n: m.n, extra: `${m.n} · $${m.cost}` }))} /> : <p className="text-sm text-gray-500 py-4 text-center">No data.</p>}</Card>
        <Card title="By Operation">{d.byOperation.length ? <Bars rows={d.byOperation.map((o: any) => ({ label: o.label, n: o.n, extra: `${o.tokens.toLocaleString()}t` }))} /> : <p className="text-sm text-gray-500 py-4 text-center">No data.</p>}</Card>
        <Card title="By Tier">{d.byTier.length ? <Bars rows={d.byTier.map((t: any) => ({ label: t.label, n: t.n, extra: `$${t.cost}` }))} /> : <p className="text-sm text-gray-500 py-4 text-center">No data.</p>}</Card>
      </div>

      <Card title="Recent Requests" right={<span className="text-[11px] text-gray-500">latest {d.recent.length}</span>}>
        {d.recent.length ? (
          <div className="overflow-x-auto"><div className="min-w-[760px] space-y-1">
            <div className="flex items-center text-[10px] text-gray-500 uppercase tracking-wide px-2"><span className="w-24">Operation</span><span className="flex-1">Model</span><span className="w-20">Tier</span><span className="w-20 text-right">Tokens</span><span className="w-20 text-right">Latency</span><span className="w-20 text-right">Cost</span><span className="w-20 text-right">Status</span></div>
            {d.recent.map((r: any, i: number) => (
              <div key={i} className="flex items-center px-2 py-1 text-[12px] border-b border-gray-50"><span className="w-24 text-gray-700">{r.operation ?? "—"}</span><span className="flex-1 text-gray-500 font-mono text-[11px] truncate">{r.model ?? "—"}</span><span className="w-20 text-gray-500">{r.tier ?? "—"}</span><span className="w-20 text-right tabular-nums text-gray-700">{r.tokens?.toLocaleString() ?? "—"}</span><span className="w-20 text-right tabular-nums text-gray-500">{r.latency != null ? `${r.latency}ms` : "—"}</span><span className="w-20 text-right tabular-nums text-gray-700">{r.cost != null ? `$${Number(r.cost).toFixed(4)}` : "—"}</span><span className="w-20 text-right"><Pill text={r.status} tone={STATUS_TONE[r.status]} /></span></div>
            ))}
          </div></div>
        ) : <p className="text-sm text-gray-500 py-6 text-center">No requests logged yet — telemetry appears here automatically as the platform generates.</p>}
      </Card>

      {ev.provisioned && ev.evals.length > 0 && (
        <Card title="Evaluation & Testing" right={<span className="text-[11px] text-gray-500">{ev.kpis.passing}/{ev.kpis.total} passing · avg {ev.kpis.avgScore}% · {ev.kpis.runs.toLocaleString()} runs</span>}>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
            {ev.evals.map((e: any) => (
              <div key={e.id} className="flex items-center gap-2 border border-gray-100 rounded-lg p-2.5">
                <span className={`w-2 h-2 rounded-full shrink-0 ${e.passed ? "bg-[var(--cmp-color-success)]" : "bg-[var(--cmp-color-error)]"}`} />
                <div className="min-w-0 flex-1"><p className="text-[12px] font-medium text-gray-900 leading-tight truncate">{e.name}</p><p className="text-[10px] text-gray-500">{e.eval_type} · {e.target} · {e.runs} runs</p></div>
                <span className={`text-[13px] font-bold tabular-nums ${Number(e.score) >= 90 ? "text-[var(--cmp-text-success)]" : Number(e.score) >= 80 ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-error)]"}`}>{e.score}%</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-500 mt-2">Eval definitions &amp; scores from ais_evals. The automated harness that runs these on schedule (LLM-judge quality, safety red-team, groundedness, prompt-regression) executes against the live models — backend engineering (epic).</p>
        </Card>
      )}

      <Foot>AIS-011 — observability over the real plat_ai_requests written by the AI Runtime Gateway&apos;s generate() choke point (one row per server-side AI call: model, tier, tokens, latency, cost, status). Aggregation reuses the gateway&apos;s own loadAiGovernance(). Automated eval harness, quality benchmarking and prompt-regression testing are the next phase (P3).</Foot>
    </div>
  );
}
