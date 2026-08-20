import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadAiStudio } from "@/lib/super-admin/ai-studio";
import JobRunner from "../_components/JobRunner";
import AskPanel from "../_components/AskPanel";
import { requireHqCapability } from "@/lib/hq/context";

export const dynamic = "force-dynamic";

// AI Studio & Automation (AIP-001.5) — the governed low-code environment. Builders
// for prompts, agents, workflows and decision trees; the tool & connector registry;
// the automation registry; and the governed publishing lifecycle. Inventories the
// real automation primitives with live counts; honest states where no builder
// persistence exists yet.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const relTime = (iso?: string | null) => { if (!iso) return "never"; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
const dash = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());
const JOB_TONE: Record<string, string> = { running: "bg-[var(--cmp-surface-information)] text-blue-700", success: "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]", failed: "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]" };

export default async function AiStudioAutomation() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  await requireHqCapability("hq.platform.ai.view");

  const d = await loadAiStudio(admin);
  const k = d.kpis;

  const kpiCards = [
    { label: "AI Agents", value: dash(k.agents), icon: "🤖", iconBg: "bg-[var(--cmp-surface-error)]" },
    { label: "Automations", value: dash(k.automations), icon: "⚙️", iconBg: "bg-violet-50" },
    { label: "Active Automations", value: dash(k.activeAutomations), icon: "▶️", iconBg: "bg-[var(--cmp-surface-success)]" },
    { label: "Prompt Ops", value: dash(k.promptOps), icon: "✍️", iconBg: "bg-[var(--cmp-surface-information)]" },
    { label: "Connected Tools", value: dash(k.connectedTools), icon: "🧰", iconBg: "bg-teal-50" },
    { label: "Workflows", value: dash(k.workflows), icon: "🔀", iconBg: "bg-[var(--cmp-surface-information)]" },
    { label: "Failed Automations", value: dash(k.failedAutomations), icon: "⚠️", iconBg: "bg-[var(--cmp-surface-error)]", tone: (k.failedAutomations ?? 0) > 0 ? "text-[var(--cmp-text-error)]" : undefined },
    { label: "Pending Approvals", value: dash(k.pendingApprovals), icon: "🚦", iconBg: "bg-[var(--cmp-surface-warning)]", tone: (k.pendingApprovals ?? 0) > 0 ? "text-[var(--cmp-text-warning)]" : undefined },
  ];

  return (
    <div data-wide className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Link href="/super-admin/ai" className="hover:text-teal-700">AI &amp; Intelligence</Link><span>/</span><span className="text-gray-600">AI Studio &amp; Automation</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mt-0.5">AI Studio &amp; Automation</h1>
        <p className="text-sm text-gray-500">Build governed copilots, prompts, workflows and automations — without touching application code.</p>
      </div>

      {/* KPI ribbon */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        {kpiCards.map(c => (
          <div key={c.label} className={`${card} p-4`}>
            <div className="flex items-start justify-between">
              <span className="text-[11px] font-semibold text-gray-500 leading-tight">{c.label}</span>
              <span className={`w-7 h-7 rounded-lg ${c.iconBg} flex items-center justify-center text-sm shrink-0`}>{c.icon}</span>
            </div>
            <p className={`text-2xl font-bold mt-1.5 tabular-nums ${(c as any).tone ?? "text-gray-900"}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Builders */}
      <div className={`${card} p-5`}>
        <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Builders</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {d.builders.map((b: any) => {
            const Wrap: any = b.soon || !b.href ? "div" : Link;
            return (
              <Wrap key={b.name} {...(b.soon || !b.href ? {} : { href: b.href })} className={`flex items-start gap-2.5 rounded-lg border border-gray-100 p-3 ${b.soon ? "opacity-60" : "hover:border-teal-300 hover:bg-teal-50/40 transition-colors"}`}>
                <span className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center text-sm shrink-0">{b.icon}</span>
                <div className="min-w-0"><p className="text-sm font-medium text-gray-800 leading-tight">{b.name}{b.soon && <span className="text-[9px] text-[var(--cmp-text-warning)] ml-1">soon</span>}</p><p className="text-[10px] text-gray-500 leading-tight">{b.desc}</p></div>
              </Wrap>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Tool & connector registry */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Tool &amp; Connector Registry</h2>
          <div className="divide-y divide-gray-50">
            {d.connectors.map((c: any) => (
              <Link key={c.name} href={c.href} className="flex items-center gap-3 py-2.5 hover:bg-gray-50/60 -mx-2 px-2 rounded transition-colors">
                <div className="min-w-0 flex-1"><p className="text-sm font-medium text-gray-800 leading-tight">{c.name}</p><p className="text-[10px] text-gray-500 leading-tight">{c.desc}</p></div>
                <span className="text-sm font-bold text-gray-900 tabular-nums shrink-0">{dash(c.count)}</span>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded shrink-0 ${c.count != null ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]" : "bg-gray-100 text-gray-600"}`}>{c.count != null ? "connected" : "n/a"}</span>
              </Link>
            ))}
          </div>
        </div>

        {/* Automation registry */}
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">Automation Registry</h2>
            <Link href="/super-admin/platform-ops/monitoring" className="text-xs text-teal-700 hover:underline">Run &amp; monitor →</Link>
          </div>
          {!d.automationsReady ? <p className="text-sm text-gray-500 py-4 text-center">Job runner not ready — run migration 054.</p> : (
            <div className="divide-y divide-gray-50">
              {d.automations.map((a: any) => (
                <div key={a.key} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-800 leading-tight">{a.name}</p>
                    <p className="text-[10px] text-gray-500 leading-tight">{a.category} · <span className="font-mono">{a.schedule}</span>{a.runnable ? "" : " · external"}</p>
                  </div>
                  {a.last ? <span className={`text-[10px] font-semibold px-2 py-0.5 rounded shrink-0 ${JOB_TONE[a.last.status] ?? "bg-gray-100 text-gray-600"}`}>{a.last.status}</span> : <span className="text-[10px] text-gray-500 shrink-0">no runs</span>}
                  <span className="text-[10px] text-gray-500 w-14 text-right shrink-0">{relTime(a.last?.started_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Workflow catalogue */}
        <div className={`${card} p-5 lg:col-span-2`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">Workflow Catalogue</h2>
            <Link href="/super-admin/platform-ops/approvals" className="text-xs text-teal-700 hover:underline">Approvals →</Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {d.workflows.map((w: any) => (
              <div key={w.key} className="flex items-center gap-2.5 rounded-lg border border-gray-100 p-2.5">
                <span className="text-base shrink-0">{w.icon}</span>
                <div className="min-w-0 flex-1"><p className="text-sm font-medium text-gray-800 leading-tight truncate">{w.name}</p><p className="text-[10px] text-gray-500">{w.steps} step{w.steps === 1 ? "" : "s"}</p></div>
                {w.pending > 0 && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)] shrink-0">{w.pending} pending</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Agent catalogue */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Agent Catalogue</h2>
          <div className="space-y-1.5">
            {d.agentCatalogue.map((a: any) => (
              <div key={a.name} className="flex items-center gap-2.5">
                <span className="w-7 h-7 rounded-lg bg-gray-50 flex items-center justify-center text-sm shrink-0">{a.icon}</span>
                <div className="min-w-0"><p className="text-sm font-medium text-gray-800 leading-tight truncate">{a.name}</p><p className="text-[10px] text-gray-500 leading-tight truncate">{a.desc}</p></div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Real interactive canvases: run automations + test the grounded assistant */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <JobRunner jobs={d.automations} title="Workflow Automation — Run Now" />
        <AskPanel
          title="Testing Playground"
          placeholder="Test the grounded assistant with any prompt…"
          prompts={[
            "Which competencies cover medication safety?",
            "Test: summarise the core framework library",
            "What happens if I ask about unapproved content?",
          ]}
        />
      </div>

      {/* Publishing lifecycle */}
      <div className={`${card} p-5`}>
        <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Governed Publishing Lifecycle</h2>
        <div className="flex flex-wrap items-center gap-1.5">
          {d.stages.map((s: string, i: number) => (
            <div key={s} className="flex items-center gap-1.5">
              <span className="text-[11px] font-medium text-gray-700 bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1.5">{s}</span>
              {i < d.stages.length - 1 && <span className="text-gray-500 text-xs">→</span>}
            </div>
          ))}
        </div>
        <p className="text-[10px] text-gray-500 mt-3">Every AI asset moves through this governed lifecycle before production — with safety and clinical/operational review, governance approval and monitoring. Human-in-the-loop at each gate.</p>
      </div>

      <p className="text-[11px] text-gray-500 pb-4">AI Studio inventories the real automation primitives — the copilot catalogue (agents), the job registry (automations), the workflow/approval catalogue and the connector engines — each with live counts. Builders open the closest real authoring surface today; a dedicated builder-persistence layer (draft agents, prompt versions, test-run history) is the next Studio phase, so those specific counts show honest states until then. No AI asset reaches production outside the governed publishing lifecycle.</p>
    </div>
  );
}
