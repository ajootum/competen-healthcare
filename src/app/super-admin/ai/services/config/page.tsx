import { requireHqCapability } from "@/lib/hq/context";
import { loadAiConfig } from "@/lib/ai/services";
import { Head, Tabs, Card, Stat, Pill, Provision, Foot } from "../_ui";

export const dynamic = "force-dynamic";

// AIS-010 AI Configuration & No-Code Integration — how AI behaviour is configured without code, composing with WCE.
/* eslint-disable @typescript-eslint/no-explicit-any */
const CAT_ICON: Record<string, string> = { copilot: "💬", model: "🧠", safety: "🛡️", routing: "🔀", feature: "✨", knowledge: "📚" };

export default async function ConfigPage() {
  const { admin } = await requireHqCapability("hq.platform.ai.view");
  const d = await loadAiConfig(admin) as any;
  const head = <Head code="AIS-010 · AI Services Platform" title="AI Configuration & No-Code Integration" sub="Enable, customise and govern AI behaviour without code — copilot, model routing, safety, features and knowledge settings, resolved with WCE inheritance." />;
  if (!d.provisioned) return <div className="max-w-[1500px] space-y-4">{head}<Tabs active="010" /><Provision /></div>;

  const k = d.kpis;
  return (
    <div className="max-w-[1500px] space-y-4">
      {head}<Tabs active="010" />
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <Stat label="Config Items" value={k.total} sub={`${k.active} active`} />
        <Stat label="Inherited" value={k.inherited} sub="from platform" tone="text-[var(--cmp-text-information)]" />
        <Stat label="Local Overrides" value={k.local} sub="tenant-specific" tone="text-[var(--cmp-text-warning)]" />
        <Stat label="Categories" value={k.categories} sub="config domains" />
        <Stat label="Override %" value={`${k.total ? Math.round((k.local / k.total) * 100) : 0}%`} sub="local vs total" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {d.byCategory.map((g: any) => (
          <Card key={g.category} title={`${CAT_ICON[g.category] ?? "⚙️"} ${g.category.charAt(0).toUpperCase() + g.category.slice(1)}`} right={<span className="text-[11px] text-gray-400">{g.items.length}</span>}>
            <div className="space-y-1.5">
              {g.items.map((i: any) => (
                <div key={i.id} className="flex items-center gap-2 text-[12px]">
                  <div className="min-w-0 flex-1"><p className="text-gray-800 leading-tight truncate">{i.name}</p><p className="text-[10px] text-gray-400 font-mono">{i.config_key}</p></div>
                  <span className="text-gray-700 font-medium text-[11px] text-right truncate max-w-[40%]">{i.value}</span>
                  <Pill text={i.source} tone={i.source === "inherited" ? "blue" : "amber"} />
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      <Foot>AIS-010 — AI configuration over ais_config (copilot / model / safety / routing / feature / knowledge). Settings, values and inherited-vs-local source are real; the no-code editors compose with the platform Workspace Configuration Engine (Platform → Enterprise → Org → Unit → Role → User precedence) and the Draft→Validate→Publish→Rollback pipeline (next phase).</Foot>
    </div>
  );
}
