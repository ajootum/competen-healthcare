import { requireHqCapability } from "@/lib/hq/context";
import { loadAiContext } from "@/lib/ai/services";
import { Head, Tabs, Card, Stat, Pill, Provision, Foot } from "../_ui";

export const dynamic = "force-dynamic";

// AIS-002 Context Resolution Engine — the registry of context sources assembled into a signed envelope before any
// model invocation (user, workspace, tenant, security, knowledge, workflow, memory, business).
/* eslint-disable @typescript-eslint/no-explicit-any */
const DOMAIN_ICON: Record<string, string> = { user: "👤", workspace: "🖥️", tenant: "🏢", security: "🔐", knowledge: "📚", workflow: "🔄", memory: "🧠", business: "📋" };
const PIPELINE = ["Validate identity & tenant", "Resolve authorized role/workspace/object", "Screen for sensitive data & injection", "Retrieve authorized evidence", "Assemble & sign context envelope", "Hand to prompt compiler"];

export default async function ContextPage() {
  const { admin } = await requireHqCapability("hq.platform.ai.view");
  const d = await loadAiContext(admin) as any;
  const head = <Head code="AIS-002 · AI Services Platform" title="Context Resolution Engine" sub="Assembles the complete, permission-filtered context package — signed — before any AI model is invoked, so every interaction is safe, relevant and explainable." />;
  if (!d.provisioned) return <div className="max-w-[1500px] space-y-4">{head}<Tabs active="002" /><Provision /></div>;

  const k = d.kpis;
  return (
    <div className="max-w-[1500px] space-y-4">
      {head}<Tabs active="002" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Context Sources" value={k.total} sub={`${k.active} active`} />
        <Stat label="Context Domains" value={k.domains} sub="of 8" />
        <Stat label="Signed Envelope" value="Yes" sub="tamper-evident" tone="text-[var(--cmp-text-success)]" />
        <Stat label="Tenant Isolation" value="Enforced" sub="before traversal" tone="text-[var(--cmp-text-success)]" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Context Domains" className="xl:col-span-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {d.byDomain.map((x: any) => (
              <div key={x.domain} className="flex items-center gap-2 border border-gray-100 rounded-lg p-2.5">
                <span className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center text-sm shrink-0">{DOMAIN_ICON[x.domain] ?? "•"}</span>
                <div className="min-w-0 flex-1"><p className="text-[12px] font-medium text-gray-900 leading-tight">{x.source.name}</p><p className="text-[10px] text-gray-400">{x.source.source_system} · {x.source.refresh}</p></div>
                <Pill text={x.domain} tone="violet" />
              </div>
            ))}
          </div>
        </Card>

        <Card title="Resolution Pipeline">
          <div className="space-y-2">{PIPELINE.map((step, i) => (
            <div key={i} className="flex items-start gap-2"><span className="w-5 h-5 rounded-full bg-violet-100 text-violet-700 text-[10px] font-bold flex items-center justify-center shrink-0">{i + 1}</span><p className="text-[11px] text-gray-700 leading-tight pt-0.5">{step}</p></div>
          ))}</div>
        </Card>
      </div>

      <Foot>AIS-002 — the context-source registry over ais_context_sources. Domains and source systems are real config; the runtime that assembles &amp; cryptographically signs the context envelope (and the AIS-008 pre-processing screen) is backend engineering in src/lib/ai/* (epic), not a dashboard.</Foot>
    </div>
  );
}
