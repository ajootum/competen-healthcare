import { requireHqContext } from "@/lib/hq/context";
import Link from "next/link";
import { loadAiControlPlane } from "@/lib/ai/services";
import { Head, Tabs, Card, Stat, Pill, Bars, Provision, Foot } from "./_ui";

export const dynamic = "force-dynamic";

// AIS-001 Global Copilot / AI Services Control Plane — the super-admin control surface over the platform's real AI
// runtime: live provider config, the model registry the gateway routes over, and telemetry from plat_ai_requests.
/* eslint-disable @typescript-eslint/no-explicit-any */
const fmtT = (t: string | null) => { if (!t) return ""; try { return new Date(t).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
// AIS-001..012 delivery status against this platform. 🟢 live · 🟡 registry/config (Phase 2) · 🔵 governance/eval (Phase 3) · 🔴 backend runtime epic.
const MODULE_MAP: [string, string, string, string][] = [
  ["001", "Global Copilot Platform", "live", "Copilot routes (/api/copilot) + AI Runtime Gateway"],
  ["002", "Context Resolution Engine", "live", "Phase 3: context-source registry (+ signing runtime backend)"],
  ["003", "Knowledge & Semantic Search", "live", "Phase 3: knowledge-source registry (+ RAG index backend)"],
  ["004", "Skills & Plugin Framework", "live", "Phase 2: ais_skills registry (+ invocation sandbox backend)"],
  ["005", "Action & Workflow Orchestrator", "live", "Phase 3: action registry (+ execution runtime backend)"],
  ["006", "Recommendation & Prediction", "live", "Phase 2: aggregation over adm_ai_recommendations + pa_predictions"],
  ["007", "Prompt & Conversation", "live", "Phase 2: ais_prompt_templates + ais_personas"],
  ["008", "Governance & Explainability", "live", "Phase 3: policy console + real gateway safety metrics"],
  ["009", "Model Mgmt & Provider Abstraction", "live", "Phase 1: ais_providers / ais_models registry"],
  ["010", "Configuration & No-Code", "live", "Phase 2: ais_config (+ composes with WCE)"],
  ["011", "Observability, Testing & Eval", "live", "Phase 1+3: plat_ai_requests telemetry + eval harness"],
  ["012", "Agent Framework", "live", "Phase 2: ais_agents registry (+ execution runtime backend)"],
];
const MOD_TONE: Record<string, { pill: string; dot: string; label: string }> = { live: { pill: "emerald", dot: "bg-[var(--cmp-color-success)]", label: "Live" }, phase2: { pill: "amber", dot: "bg-[var(--cmp-color-warning)]", label: "Phase 2" }, phase3: { pill: "blue", dot: "bg-[var(--cmp-color-information)]", label: "Phase 3" }, backend: { pill: "slate", dot: "bg-gray-400", label: "Backend epic" } };

export default async function AiControlPlanePage() {
  const { admin } = await requireHqContext("hq.platform.ai.view");
  const d = await loadAiControlPlane(admin) as any;
  const head = <Head code="AIS-001 · AI Services Platform" title="AI Services Control Plane" sub="The super-admin control surface over Competen's real AI runtime — provider configuration, the model registry the gateway routes over, and live usage telemetry." />;
  if (!d.provisioned) return <div className="max-w-[1500px] space-y-4">{head}<Tabs active="001" /><Provision /></div>;

  const k = d.kpis;
  return (
    <div className="max-w-[1500px] space-y-4">
      {head}<Tabs active="001" />

      <div className={`rounded-xl border p-3 flex items-center gap-3 ${d.aiConfigured ? "bg-[var(--cmp-surface-success)] border-[var(--cmp-color-success)]" : "bg-[var(--cmp-surface-warning)] border-[var(--cmp-color-warning)]"}`}>
        <span className={`w-2.5 h-2.5 rounded-full ${d.aiConfigured ? "bg-[var(--cmp-color-success)]" : "bg-[var(--cmp-color-warning)]"}`} />
        <p className="text-[13px] text-gray-800">{d.aiConfigured ? <>AI runtime <b>configured</b> — active provider <b className="capitalize">{d.activeProvider}</b>, default model <span className="font-mono">{d.defaultModel?.model_id ?? "—"}</span>.</> : <>AI runtime <b>not configured</b> — set a provider API key (ANTHROPIC_API_KEY) to enable generation. The registry &amp; telemetry below still work.</>}</p>
        {!k.telemetryReady && <span className="ml-auto text-[11px] text-[var(--cmp-text-warning)]">telemetry table not applied</span>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <Stat label="Requests (24h)" value={k.requests24h.toLocaleString()} sub={`${k.totalRequests.toLocaleString()} total`} />
        <Stat label="Tokens (24h)" value={k.tokens24h >= 1000 ? `${Math.round(k.tokens24h / 1000)}k` : k.tokens24h} sub="in + out" />
        <Stat label="Cost (24h)" value={`$${k.cost24h}`} sub={`$${k.totalCost} total`} tone="text-violet-700" />
        <Stat label="Errors (24h)" value={k.errors24h} sub="upstream" tone={k.errors24h ? "text-[var(--cmp-text-error)]" : undefined} />
        <Stat label="Refusals (24h)" value={k.refusals24h} sub="safety" tone={k.refusals24h ? "text-[var(--cmp-text-warning)]" : undefined} />
        <Stat label="Avg Latency" value={k.avgLatencyMs != null ? `${k.avgLatencyMs}ms` : "—"} sub="24h" />
        <Stat label="Active Providers" value={k.activeProviders} sub="registered" />
        <Stat label="Active Models" value={k.activeModels} sub="available" tone="text-[var(--cmp-text-success)]" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Providers" right={<Link href="/super-admin/ai/services/models" className="text-[11px] text-violet-600 hover:underline">Registry →</Link>}>
          <div className="space-y-2">{d.providers.map((p: any) => (
            <div key={p.code} className="flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${p.live ? "bg-[var(--cmp-color-success)]" : p.status === "active" ? "bg-[var(--cmp-color-information)]" : "bg-gray-300"}`} /><div className="min-w-0 flex-1"><p className="text-[12px] text-gray-800 leading-tight">{p.name}</p><p className="text-[10px] text-gray-400 font-mono">{p.code}</p></div>{p.live && <Pill text="configured" tone="emerald" />}<Pill text={p.status} tone={p.status === "active" ? "blue" : "slate"} /></div>
          ))}</div>
        </Card>

        <Card title="Usage by Model" className="xl:col-span-2" right={<span className="text-[11px] text-gray-400">last 24h</span>}>
          {d.byModel.length ? <Bars rows={d.byModel.map((m: any) => ({ label: m.label, n: m.n, extra: `${m.n} · $${m.cost}` }))} /> : <p className="text-sm text-gray-400 py-6 text-center">No AI calls in the last 24h — telemetry populates as the platform generates. Run the seed for demo data.</p>}
        </Card>
      </div>

      <Card title="AI Services Platform — Module Delivery Status" right={<span className="text-[11px] text-gray-400">AIS-001…012</span>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
          {MODULE_MAP.map(([code, name, state, detail]) => { const t = MOD_TONE[state]; return (
            <div key={code} className="flex items-start gap-2 border border-gray-100 rounded-lg p-2.5">
              <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${t.dot}`} />
              <div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><span className="text-[10px] text-gray-300 font-mono">AIS-{code}</span><p className="text-[12px] font-medium text-gray-900 leading-tight">{name}</p></div><p className="text-[10px] text-gray-400 mt-0.5">{detail}</p></div>
              <Pill text={t.label} tone={t.pill} />
            </div>
          ); })}
        </div>
        <p className="text-[10px] text-gray-400 mt-2">🟢 live now · 🟡 registry/config (Phase 2) · 🔵 governance/eval (Phase 3) · ⚪ backend runtime epic (extends src/lib/ai/*, not a dashboard).</p>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Usage by Operation" right={<span className="text-[11px] text-gray-400">last 24h</span>}>
          {d.byOperation.length ? <Bars rows={d.byOperation.map((o: any) => ({ label: o.label, n: o.n, extra: `${o.n} calls` }))} /> : <p className="text-sm text-gray-400 py-4 text-center">No operations recorded.</p>}
        </Card>
        <Card title="Recent AI Activity" right={<Link href="/super-admin/ai/services/observability" className="text-[11px] text-violet-600 hover:underline">Observability →</Link>}>
          {d.recent.length ? <div className="space-y-1">{d.recent.slice(0, 8).map((r: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-[11px]"><span className={`w-1.5 h-1.5 rounded-full shrink-0 ${r.status === "ok" ? "bg-[var(--cmp-color-success)]" : r.status === "refusal" ? "bg-[var(--cmp-color-warning)]" : "bg-[var(--cmp-color-error)]"}`} /><span className="text-gray-700 flex-1 truncate">{r.operation} · <span className="font-mono text-gray-400">{r.model}</span></span><span className="text-gray-400 tabular-nums">{r.tokens ?? "—"}t</span><span className="text-gray-400">{fmtT(r.at)}</span></div>
          ))}</div> : <p className="text-sm text-gray-400 py-4 text-center">No recent activity.</p>}
        </Card>
      </div>

      <Foot>AIS Phase 1 — a real control plane over the platform&apos;s AI runtime: provider config is live from aiStatus() (env), the model registry (ais_providers / ais_models) mirrors the AI Runtime Gateway&apos;s actual list pricing, and all telemetry aggregates the real plat_ai_requests written by generate(). Phases 2–3 (prompt/skill/agent registries, governance, eval) and the backend runtime epics are mapped above.</Foot>
    </div>
  );
}
