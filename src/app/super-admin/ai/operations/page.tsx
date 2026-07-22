import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadAiOperations } from "@/lib/super-admin/ai-operations";
import JobRunner from "../_components/JobRunner";

export const dynamic = "force-dynamic";

// AI Operations Centre (AIP-001.1) — the operational HQ for AI. Service health,
// agent & copilot registry, model registry, the AI job queue and review queue.
// Every metric is live from the AI runtime telemetry or an honest state.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
const dash = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());
const ms = (n: number | null) => (n == null ? "—" : n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${n} ms`);
const pct = (n: number | null) => (n == null ? "—" : `${n}%`);

const SVC_TONE = (ok: boolean | null) => (ok == null ? "bg-gray-100 text-gray-400" : ok ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700");
const JOB_TONE: Record<string, string> = { running: "bg-blue-50 text-blue-700", success: "bg-green-50 text-green-700", failed: "bg-rose-50 text-rose-700" };
const STATUS_TONE: Record<string, string> = { ok: "text-green-600", refusal: "text-amber-600", error: "text-rose-600", not_configured: "text-gray-400" };

export default async function AiOperationsCentre() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const d = await loadAiOperations(admin);
  const k = d.kpis;

  const kpiCards = [
    { label: "AI Health", value: pct(k.aiHealth), icon: "🛡️", iconBg: "bg-green-50", tone: k.aiHealth != null && k.aiHealth >= 95 ? "text-green-600" : k.aiHealth == null ? "text-gray-400" : "text-amber-600" },
    { label: "Running Agents", value: dash(k.runningAgents), icon: "🤖", iconBg: "bg-blue-50" },
    { label: "Models Online", value: dash(k.modelsOnline), icon: "🧠", iconBg: "bg-violet-50" },
    { label: "Queued Jobs", value: dash(k.queuedJobs), icon: "🗂️", iconBg: "bg-sky-50" },
    { label: "Failed Jobs", value: dash(k.failedJobs), icon: "⚠️", iconBg: "bg-rose-50", tone: (k.failedJobs ?? 0) > 0 ? "text-rose-600" : undefined },
    { label: "Inference Requests", value: dash(k.inferenceRequests), icon: "📊", iconBg: "bg-purple-50" },
    { label: "Avg Response", value: ms(k.avgResponseMs), icon: "⚡", iconBg: "bg-teal-50" },
    { label: "Knowledge Updates", value: dash(k.knowledgeUpdates), icon: "📚", iconBg: "bg-amber-50" },
  ];

  return (
    <div data-wide className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Link href="/super-admin/ai" className="hover:text-teal-700">AI &amp; Intelligence</Link><span>/</span><span className="text-gray-600">AI Operations Centre</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mt-0.5">AI Operations Centre</h1>
        <p className="text-sm text-gray-500">Operate, monitor and govern every AI service, agent, model and job.</p>
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* AI service health */}
        <div className={`${card} p-5 lg:col-span-2`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">AI Service Health</h2>
            <Link href="/super-admin/platform-ops/ai-gateway" className="text-xs text-teal-700 hover:underline">AI Gateway →</Link>
          </div>
          <div className="divide-y divide-gray-50">
            {d.services.map((sv: any) => (
              <div key={sv.name} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-800 leading-tight">{sv.name}</p>
                  <p className="text-[10px] text-gray-400 font-mono leading-tight">{sv.desc}</p>
                </div>
                <span className="text-[11px] text-gray-500 tabular-nums hidden sm:block truncate max-w-[45%] text-right">{sv.detail}</span>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded shrink-0 ${SVC_TONE(sv.ok)}`}>{sv.status}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Model registry */}
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">Model Registry</h2>
            <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${d.provider.configured ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>{d.provider.configured ? d.provider.provider : "no provider"}</span>
          </div>
          {d.models.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">No provider configured.</p> : (
            <div className="space-y-2.5">
              {d.models.map((m: any) => (
                <div key={m.tier}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="capitalize text-gray-600 text-xs font-semibold">{m.tier}</span>
                    <span className="tabular-nums text-[10px] text-gray-400">{m.requests} req · {m.tokens.toLocaleString()}t</span>
                  </div>
                  <span className="font-mono text-[11px] text-gray-800 truncate block">{m.model}</span>
                </div>
              ))}
            </div>
          )}
          <p className="text-[10px] text-gray-400 mt-3 pt-2 border-t border-gray-50">Tiers resolve per job; override with AI_MODEL_* env vars.</p>
        </div>
      </div>

      {/* Agents & copilots */}
      <div className={`${card} p-5`}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-900 text-[15px]">Agents &amp; Copilots <span className="text-[10px] text-gray-400">usage today · live</span></h2>
          <Link href="/super-admin/assistant" className="text-xs text-teal-700 hover:underline">Open Assistant →</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
              <th className="px-3 py-2 font-semibold">Agent / Copilot</th><th className="px-3 py-2 font-semibold">Model</th>
              <th className="px-3 py-2 font-semibold text-right">Requests</th><th className="px-3 py-2 font-semibold text-right">Accuracy</th><th className="px-3 py-2 font-semibold text-right">Escalations</th><th className="px-3 py-2 font-semibold text-right">Status</th>
            </tr></thead>
            <tbody>
              {d.agents.map((a: any) => (
                <tr key={a.key} className="border-b border-gray-50">
                  <td className="px-3 py-2"><span className="flex items-center gap-2"><span>{a.icon}</span><span className="text-gray-800 font-medium">{a.name}</span></span></td>
                  <td className="px-3 py-2 font-mono text-[11px] text-gray-500 truncate">{a.model ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">{a.usageToday.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-gray-300">—</td>
                  <td className="px-3 py-2 text-right text-gray-300">—</td>
                  <td className="px-3 py-2 text-right"><span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${a.status === "running" ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>{a.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-gray-400 mt-2">Copilots map to the real server-side AI operations recorded by the runtime gateway. Accuracy &amp; escalations are not yet metered — Intelligence Analytics wires evaluation later.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* AI job queue */}
        <div className={`${card} p-5 lg:col-span-2`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">AI Job Queue</h2>
            <Link href="/super-admin/platform-ops/monitoring" className="text-xs text-teal-700 hover:underline">Monitoring →</Link>
          </div>
          <div className="grid grid-cols-4 gap-2 mb-3">
            {[["Running", d.jobStates.running, "text-blue-600"], ["Completed 24h", d.jobStates.completed24h, "text-green-600"], ["Failed 24h", d.jobStates.failed24h, "text-rose-600"], ["Awaiting Review", d.jobStates.awaitingReview, "text-amber-600"]].map(([l, n, tone]: any) => (
              <div key={l} className="rounded-lg border border-gray-100 p-3 text-center">
                <p className={`text-xl font-bold tabular-nums ${n ? tone : "text-gray-900"}`}>{dash(n)}</p>
                <p className="text-[10px] text-gray-500 mt-0.5">{l}</p>
              </div>
            ))}
          </div>
          {!d.jobs.summary.ready ? <p className="text-sm text-gray-400 py-4 text-center">Job runner not ready — run migration 054.</p> : d.jobs.recent.length === 0 ? <p className="text-sm text-gray-400 py-4 text-center">No job runs yet.</p> : (
            <div className="divide-y divide-gray-50">
              {d.jobs.recent.slice(0, 6).map((r: any, i: number) => (
                <div key={i} className="flex items-center gap-3 py-2 text-sm">
                  <span className="text-gray-700 flex-1 truncate">{r.job_key}</span>
                  <span className="text-[10px] text-gray-400">{r.trigger}</span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${JOB_TONE[r.status] ?? "bg-gray-100 text-gray-500"}`}>{r.status}</span>
                  <span className="text-[10px] text-gray-400 w-14 text-right tabular-nums">{relTime(r.started_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Registry / sources counts */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Registries</h2>
          <div className="space-y-2">
            {[
              ["Agents & Copilots", d.counts.agents, "/super-admin/ai/studio"],
              ["Prompt Operations", d.counts.promptOperations, "/super-admin/platform-ops/ai-gateway"],
              ["Knowledge Sources", d.counts.knowledgeSources, "/super-admin/ckp/repository"],
              ["Pending Approvals", d.counts.pendingApprovals, "/super-admin/platform-ops/approvals"],
            ].map(([label, n, href]: any) => (
              <Link key={label} href={href} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 hover:border-teal-300 hover:bg-teal-50/40 transition-colors">
                <span className="text-sm text-gray-700">{label}</span>
                <span className="text-sm font-bold text-gray-900 tabular-nums">{dash(n)}</span>
              </Link>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-3">Prompt Library &amp; AI Policies as dedicated registries land with AI Studio. Prompt operations = distinct attributed operations in 24h.</p>
        </div>
      </div>

      {/* Real on-demand automation runner */}
      <JobRunner jobs={d.jobs.list} title="Run Automation Now" />

      {/* Recent AI requests / audit */}
      <div className={`${card} p-5`}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-900 text-[15px]">Recent AI Requests <span className="text-[10px] text-gray-400">audit trail</span></h2>
          <Link href="/super-admin/audit" className="text-xs text-teal-700 hover:underline">Full audit →</Link>
        </div>
        {d.recent.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">No AI requests recorded yet — usage appears here as soon as a copilot runs.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                <th className="px-3 py-2 font-semibold">Operation</th><th className="px-3 py-2 font-semibold">Model</th><th className="px-3 py-2 font-semibold">Tier</th>
                <th className="px-3 py-2 font-semibold text-right">Tokens</th><th className="px-3 py-2 font-semibold text-right">Latency</th><th className="px-3 py-2 font-semibold text-right">Status</th><th className="px-3 py-2 font-semibold text-right">When</th>
              </tr></thead>
              <tbody>
                {d.recent.map((r: any, i: number) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="px-3 py-2 text-gray-700">{r.operation ?? <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-gray-600">{r.model}</td>
                    <td className="px-3 py-2 text-gray-500 capitalize">{r.tier}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-600">{(r.tokens ?? 0).toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-500">{r.latency == null ? "—" : `${r.latency}ms`}</td>
                    <td className={`px-3 py-2 text-right capitalize ${STATUS_TONE[r.status] ?? "text-gray-500"}`}>{r.status}</td>
                    <td className="px-3 py-2 text-right text-[11px] text-gray-400">{relTime(r.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The AI Operations Centre operates every AI capability. Service health, agent usage, the model registry and the job queue are live from the AI runtime gateway (plat_ai_requests), the job runner (plat_job_runs) and the approval engine. Services without a dedicated telemetry surface (vector DB, embeddings) show honest “Not instrumented” states; a standalone Prompt Library and AI Policy registry arrive with AI Studio &amp; Automation.</p>
    </div>
  );
}
