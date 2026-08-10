import { requireHqCapability } from "@/lib/hq/context";
import { loadAiModelRegistry } from "@/lib/ai/services";
import { Head, Tabs, Card, Stat, Pill, Provision, Foot } from "../_ui";

export const dynamic = "force-dynamic";

// AIS-009 Model Management & Provider Abstraction — the registry the AI Runtime Gateway routes over. Pricing mirrors
// the gateway's real list pricing; configured-status is live from aiStatus(); usage joins from plat_ai_requests.
/* eslint-disable @typescript-eslint/no-explicit-any */
const TIER_TONE: Record<string, string> = { cheap: "emerald", reasoning: "blue", heavy: "violet" };
const STATUS_TONE: Record<string, string> = { active: "emerald", preview: "amber", deprecated: "slate", retired: "rose" };
const price = (n: any) => (n == null ? "—" : `$${n}`);

export default async function ModelsPage() {
  const { admin } = await requireHqCapability("hq.platform.ai.view");
  const d = await loadAiModelRegistry(admin) as any;
  const head = <Head code="AIS-009 · AI Services Platform" title="Model Management & Provider Abstraction" sub="Switch, combine and govern foundation models without changing application code — the registry the AI Runtime Gateway routes over, with real list pricing and live usage." />;
  if (!d.provisioned) return <div className="max-w-[1500px] space-y-4">{head}<Tabs active="009" /><Provision /></div>;

  const k = d.kpis;
  return (
    <div className="max-w-[1500px] space-y-4">
      {head}<Tabs active="009" />
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat label="Providers" value={k.providers} sub={`${k.activeProviders} active`} />
        <Stat label="Models" value={k.models} sub="registered" />
        <Stat label="Active Models" value={k.activeModels} sub="available" tone="text-[var(--cmp-text-success)]" />
        <Stat label="Preview" value={k.preview} sub="not GA" tone={k.preview ? "text-[var(--cmp-text-warning)]" : undefined} />
        <Stat label="Deprecated" value={k.deprecated} sub="phase-out" tone={k.deprecated ? "text-gray-500" : undefined} />
        <Stat label="Active Provider" value={<span className="capitalize text-lg">{d.activeProvider ?? "none"}</span>} sub={d.aiConfigured ? "configured" : "not configured"} tone={d.aiConfigured ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-warning)]"} />
      </div>

      {d.providers.map((p: any) => (
        <Card key={p.code} title={p.name} right={<div className="flex items-center gap-1.5">{p.live && <Pill text="configured" tone="emerald" />}<Pill text={p.status} tone={p.status === "active" ? "blue" : "slate"} /><span className="text-[11px] text-gray-400">{p.modelCount} models</span></div>}>
          {p.models.length ? (
            <div className="overflow-x-auto">
              <div className="min-w-[820px] space-y-1">
                <div className="flex items-center text-[10px] text-gray-400 uppercase tracking-wide px-2"><span className="w-44">Model</span><span className="flex-1">Capabilities</span><span className="w-20">Tier</span><span className="w-24 text-right">In / Out ($/1M)</span><span className="w-20 text-right">Context</span><span className="w-24 text-right">Usage (24h)</span><span className="w-20 text-right">Status</span></div>
                {p.models.map((m: any) => (
                  <div key={m.id} className="flex items-center px-2 py-1.5 rounded-lg border border-gray-100 text-[12px]">
                    <span className="w-44"><span className="text-gray-900 font-medium">{m.display_name}</span>{m.is_default && <span className="ml-1 text-[8px] text-violet-600 font-bold uppercase">default</span>}<br /><span className="text-[10px] text-gray-400 font-mono">{m.model_id}</span></span>
                    <span className="flex-1 flex flex-wrap gap-1">{(m.capabilities ?? []).slice(0, 4).map((c: string) => <span key={c} className="text-[9px] bg-gray-50 border border-gray-100 rounded px-1 py-0.5 text-gray-500">{c}</span>)}</span>
                    <span className="w-20"><Pill text={m.tier} tone={TIER_TONE[m.tier]} /></span>
                    <span className="w-24 text-right tabular-nums text-gray-700">{price(m.input_price)} / {price(m.output_price)}</span>
                    <span className="w-20 text-right tabular-nums text-gray-500">{m.context_window ? `${Math.round(m.context_window / 1000)}k` : "—"}</span>
                    <span className="w-24 text-right tabular-nums text-gray-700">{m.usage ? `${m.usage.n} · $${m.usage.cost}` : "—"}</span>
                    <span className="w-20 text-right"><Pill text={m.status} tone={STATUS_TONE[m.status]} /></span>
                  </div>
                ))}
              </div>
            </div>
          ) : <p className="text-sm text-gray-400 py-3 text-center">No models registered.</p>}
        </Card>
      ))}

      <Foot>AIS-009 — the model &amp; provider registry over ais_providers / ais_models. Pricing mirrors the AI Runtime Gateway&apos;s real list pricing (src/lib/ai/gateway.ts); the active provider is detected live from environment configuration (aiStatus()); usage joins the real plat_ai_requests telemetry. Model routing by task/risk/cost/latency and automatic fallback are the gateway runtime (next phase).</Foot>
    </div>
  );
}
