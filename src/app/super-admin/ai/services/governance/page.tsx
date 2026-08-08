import { requireHqContext } from "@/lib/hq/context";
import { loadAiGovConsole } from "@/lib/ai/services";
import { Head, Tabs, Card, Stat, Pill, Provision, Foot } from "../_ui";

export const dynamic = "force-dynamic";

// AIS-008 Governance, Security & Explainability — the AI policy console + real safety metrics from the gateway.
/* eslint-disable @typescript-eslint/no-explicit-any */
const CAT_ICON: Record<string, string> = { safety: "🛡️", privacy: "🔒", access: "🔑", content: "📝", model: "🧠", audit: "📜" };
const ENF_TONE: Record<string, string> = { enforce: "rose", monitor: "amber", advise: "slate" };
const fmtT = (t: string | null) => { if (!t) return ""; try { return new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };

export default async function GovernancePage() {
  const { admin } = await requireHqContext("hq.platform.ai.view");
  const d = await loadAiGovConsole(admin) as any;
  const head = <Head code="AIS-008 · AI Services Platform" title="AI Governance, Security & Explainability" sub="Policies, controls and oversight ensuring safe, transparent and trustworthy AI — with real safety telemetry from the AI Runtime Gateway." />;
  if (!d.provisioned) return <div className="max-w-[1500px] space-y-4">{head}<Tabs active="008" /><Provision /></div>;

  const k = d.kpis;
  return (
    <div className="max-w-[1500px] space-y-4">
      {head}<Tabs active="008" />
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <Stat label="Policies" value={k.policies} sub={`${k.enforced} enforced`} />
        <Stat label="Enforced" value={k.enforced} sub="hard controls" tone="text-[var(--cmp-text-error)]" />
        <Stat label="Monitored" value={k.monitored} sub="soft controls" tone="text-[var(--cmp-text-warning)]" />
        <Stat label="Refusals (24h)" value={k.refusals24h} sub="safety blocks" tone={k.refusals24h ? "text-[var(--cmp-text-warning)]" : undefined} />
        <Stat label="Errors (24h)" value={k.errors24h} sub="upstream" tone={k.errors24h ? "text-[var(--cmp-text-error)]" : undefined} />
        <Stat label="Safety Coverage" value={`${k.safetyCoverage}%`} sub="enforced share" tone="text-[var(--cmp-text-success)]" />
        <Stat label="Governance Score" value={`${k.governanceScore}/100`} sub="composite" tone="text-[var(--cmp-text-success)]" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {d.byCategory.map((g: any) => (
          <Card key={g.category} title={`${CAT_ICON[g.category] ?? "•"} ${g.category.charAt(0).toUpperCase() + g.category.slice(1)}`} right={<span className="text-[11px] text-gray-400">{g.items.length}</span>}>
            <div className="space-y-1.5">{g.items.map((p: any) => (
              <div key={p.id} className="flex items-center gap-2 text-[12px]"><div className="min-w-0 flex-1"><p className="text-gray-800 leading-tight">{p.name}</p><p className="text-[10px] text-gray-400">{p.scope}</p></div><Pill text={p.enforcement} tone={ENF_TONE[p.enforcement]} /></div>
            ))}</div>
          </Card>
        ))}
      </div>

      <Card title="Recent Safety Events" right={<span className="text-[11px] text-gray-400">{d.telemetryReady ? "from gateway telemetry" : "telemetry pending"}</span>}>
        {d.safetyEvents.length ? <div className="space-y-1.5">{d.safetyEvents.map((e: any, i: number) => (
          <div key={i} className="flex items-center gap-2 text-[12px]"><span className={`w-2 h-2 rounded-full shrink-0 ${e.status === "refusal" ? "bg-[var(--cmp-color-warning)]" : "bg-[var(--cmp-color-error)]"}`} /><span className="text-gray-700 flex-1 truncate">{e.operation ?? "—"} · <span className="font-mono text-gray-400">{e.model}</span></span><Pill text={e.status} tone={e.status === "refusal" ? "amber" : "rose"} /><span className="text-gray-400 text-[11px]">{fmtT(e.at)}</span></div>
        ))}</div> : <p className="text-sm text-gray-400 py-4 text-center">No safety events (refusals/errors) in the recent window. ✅</p>}
      </Card>

      <Foot>AIS-008 — governance over ais_policies + <strong>real safety telemetry</strong> from the AI Runtime Gateway (refusals &amp; errors are actual plat_ai_requests events, not seeded). Policy definitions and enforcement modes are real config; the runtime policy-enforcement engine (pre/post-processing controls, redaction, injection screening) is backend in src/lib/ai/* — the gateway already tracks refusals/errors. Explainability capture &amp; e-signature audit are the next phase.</Foot>
    </div>
  );
}
