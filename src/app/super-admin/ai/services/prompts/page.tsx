import { requireHqContext } from "@/lib/hq/context";
import { loadAiPrompts } from "@/lib/ai/services";
import { Head, Tabs, Card, Stat, Pill, Provision, Foot } from "../_ui";

export const dynamic = "force-dynamic";

// AIS-007 Prompt & Conversation Framework — the prompt-template + persona registry the copilot compiles from.
/* eslint-disable @typescript-eslint/no-explicit-any */
const CAT_COLORS = ["#8b5cf6", "#3b82f6", "#22c55e", "#f59e0b", "#14b8a6", "#ef4444", "#6366f1", "#a855f7"];

export default async function PromptsPage() {
  const { admin } = await requireHqContext("hq.platform.ai.view");
  const d = await loadAiPrompts(admin) as any;
  const head = <Head code="AIS-007 · AI Services Platform" title="Prompt & Conversation Framework" sub="The reusable prompt-template and persona registry the Global Copilot compiles from — system policy + persona + context + knowledge + request." />;
  if (!d.provisioned) return <div className="max-w-[1500px] space-y-4">{head}<Tabs active="007" /><Provision /></div>;

  const k = d.kpis, maxCat = Math.max(1, ...d.byCategory.map((c: any) => c.n));
  return (
    <div className="max-w-[1500px] space-y-4">
      {head}<Tabs active="007" />
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="Prompt Templates" value={k.templates} sub={`${k.active} active`} />
        <Stat label="Personas" value={k.personas} sub="behaviour packages" />
        <Stat label="Total Usage" value={k.usage.toLocaleString()} sub="compilations" tone="text-violet-700" />
        <Stat label="Workspaces" value={k.workspaces} sub="covered" />
        <Stat label="Categories" value={d.byCategory.length} sub="template types" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Prompt Templates" className="xl:col-span-2" right={<span className="text-[11px] text-gray-400">by usage</span>}>
          <div className="space-y-1">
            <div className="flex items-center text-[10px] text-gray-400 uppercase tracking-wide px-1"><span className="flex-1">Template</span><span className="w-24">Workspace</span><span className="w-24">Category</span><span className="w-20">Model</span><span className="w-16 text-right">Version</span><span className="w-20 text-right">Usage</span></div>
            {d.templates.map((t: any) => (
              <div key={t.id} className="flex items-center px-1 py-1.5 text-[12px] border-b border-gray-50"><span className="flex-1 text-gray-800 truncate">{t.name}</span><span className="w-24 text-gray-500 text-[11px]">{t.workspace}</span><span className="w-24 text-gray-500 text-[11px]">{t.category}</span><span className="w-20"><Pill text={t.model_hint} tone={t.model_hint === "heavy" ? "violet" : t.model_hint === "cheap" ? "emerald" : "blue"} /></span><span className="w-16 text-right text-gray-400 tabular-nums">v{t.version}</span><span className="w-20 text-right text-gray-900 tabular-nums font-semibold">{Number(t.usage).toLocaleString()}</span></div>
            ))}
          </div>
        </Card>

        <Card title="Templates by Category">
          <div className="space-y-2">{d.byCategory.map((c: any, i: number) => (
            <div key={c.label} className="flex items-center gap-2 text-[11px]"><span className="text-gray-600 flex-1 capitalize truncate">{c.label}</span><div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${(c.n / maxCat) * 100}%`, background: CAT_COLORS[i % CAT_COLORS.length] }} /></div><span className="text-gray-900 font-semibold tabular-nums w-6 text-right">{c.n}</span></div>
          ))}</div>
        </Card>
      </div>

      <Card title="Personas" right={<span className="text-[11px] text-gray-400">{d.personas.length} behaviour packages</span>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {d.personas.map((p: any) => (
            <div key={p.id} className="border border-gray-200 rounded-lg p-3">
              <div className="flex items-center justify-between"><p className="text-[13px] font-semibold text-gray-900">{p.name}</p><Pill text={p.workspace} tone="violet" /></div>
              <p className="text-[11px] text-gray-500 mt-0.5">{p.description}</p>
              <p className="text-[10px] text-gray-400 mt-1">Tone: {p.tone}</p>
            </div>
          ))}
        </div>
      </Card>

      <Foot>AIS-007 — the prompt &amp; persona registry over ais_prompt_templates + ais_personas. Templates and personas are real config the copilot compiles from (system policy + persona + context + knowledge + request); the visual prompt editor, A/B testing and conversation-memory tuning are the next phase.</Foot>
    </div>
  );
}
