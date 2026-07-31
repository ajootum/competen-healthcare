import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadGovernanceAI } from "@/lib/cgr/ai-agents";
import { Kpi } from "../_kit";

// CGR-023 — Competency Governance AI Agent & Autonomous Assurance. The governed-AI view: the 5 governance agents
// mapped to their live surfaces, real AI activity over the governed gateway, the model registry, and the
// human-in-the-loop boundary. AI platform operations cross-link to AIS. Super-admin.
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

// The 5 governance agents (§5) grounded in the LIVE surfaces they operate over.
const AGENTS = [
  { name: "Governance Assistant", fn: "Summaries, meeting support, governance queries", href: "/super-admin/cgr/ai", live: true },
  { name: "Competency Risk", fn: "Detect emerging risk, prioritise interventions", href: "/super-admin/cgr/risk", live: true },
  { name: "Change Impact", fn: "Analyse proposed changes, estimate blast radius", href: "/super-admin/cgr/change-control", live: true },
  { name: "Evidence Intelligence", fn: "Monitor evidence currency, flag outdated", href: "/super-admin/cgr/knowledge", live: false },
  { name: "Regulatory Monitoring", fn: "Monitor standards, recommend reviews", href: "/super-admin/cgr/standards", live: false },
];
const CANNOT = ["approve competencies", "alter clinical requirements", "accept organisational risk", "override governance decisions"];

function Bars({ rows, max, tone }: { rows: { label: string; count: number; hi?: boolean }[]; max: number; tone?: string }) {
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2">
          <span className="text-[11px] text-gray-600 flex-1 min-w-0 truncate font-mono">{r.label}</span>
          <div className="w-24 h-2 rounded bg-gray-50 overflow-hidden"><div className={`h-full rounded ${r.hi ? "bg-[var(--cmp-color-success)]" : tone ?? "bg-gray-300"}`} style={{ width: `${(r.count / max) * 100}%` }} /></div>
          <span className="text-[11px] font-bold text-gray-600 tabular-nums w-8 text-right">{r.count}</span>
        </div>
      ))}
    </div>
  );
}

export default async function GovernanceAIAgentsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles = (profile?.roles?.length ? profile.roles : [profile?.role]) as (string | null)[];
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const d = await loadGovernanceAI(admin) as any;
  const k = d.kpis;
  const opMax = Math.max(1, ...d.operations.map((o: any) => o.count));
  const provMax = Math.max(1, ...d.providers.map((p: any) => p.count));
  const liveAgents = AGENTS.filter((a) => a.live).length;

  return (
    <div className="max-w-[1400px]">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-[var(--cmp-text-success)] uppercase tracking-widest mb-0.5">CGR-023 · Competency Governance</p>
          <h1 className="text-xl font-bold text-gray-900">AI Agent &amp; Autonomous Assurance</h1>
          <p className="text-gray-400 text-sm mt-0.5">How AI continuously supports governance while accountable professionals keep authority — governed agents, explainable recommendations, and a strict human-in-the-loop boundary.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Link href="/super-admin/ai/services" className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 border border-[var(--cmp-color-success)] bg-[var(--cmp-surface-success)] rounded-lg px-3 py-2">AI services →</Link>
          <Link href="/super-admin/cgr" className="text-xs font-semibold text-gray-500 hover:text-emerald-700 border border-gray-200 rounded-lg px-3 py-2">← CGR</Link>
        </div>
      </div>

      {/* Governance agents — always shown, grounded in live surfaces */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Governance AI agents (§5)</p>
          <span className="text-[10px] text-gray-400">{liveAgents} of {AGENTS.length} live</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
          {AGENTS.map((a) => (
            <Link key={a.name} href={a.href} className="border border-gray-100 rounded-lg p-3 hover:border-[var(--cmp-color-success)] hover:shadow-sm transition-all group">
              <div className="flex items-center justify-between mb-1">
                <span className={`text-[9px] font-bold uppercase rounded px-1.5 py-0.5 ${a.live ? "text-emerald-700 bg-[var(--cmp-surface-success)] border border-[var(--cmp-color-success)]" : "text-gray-500 bg-gray-50 border border-gray-100"}`}>{a.live ? "Live" : "Assist"}</span>
              </div>
              <p className="text-[12px] font-bold text-gray-800 group-hover:text-emerald-700 leading-tight">{a.name}</p>
              <p className="text-[10px] text-gray-400 leading-snug mt-0.5">{a.fn}</p>
            </Link>
          ))}
        </div>
      </div>

      {!d.provisioned ? (
        <div className="bg-white border border-gray-200 rounded-xl p-6 text-center"><p className="text-sm text-gray-400">No governed AI activity recorded yet. As governance copilots and agents run through the AI gateway, activity and model health appear here. The agent map above is grounded in the live surfaces each operates over.</p></div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Kpi label="Governed requests" value={k.requests} sub="through the gateway" />
            <Kpi label="Success rate" value={k.successRate == null ? "—" : `${k.successRate}%`} sub="status ok" tone={k.successRate == null ? "text-gray-900" : k.successRate >= 95 ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-warning)]"} />
            <Kpi label="Governance share" value={k.governanceShare == null ? "—" : `${k.governanceShare}%`} sub="of AI activity" tone="text-[var(--cmp-text-success)]" />
            <Kpi label="Tokens" value={k.tokens > 9999 ? `${Math.round(k.tokens / 1000)}k` : k.tokens} sub="total consumed" />
            <Kpi label="Active models" value={k.activeModels} sub="in the registry" />
            <Kpi label="Avg latency" value={k.avgLatency == null ? "—" : `${k.avgLatency}ms`} sub="per request" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Operations */}
            <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">AI activity by operation <span className="font-normal normal-case text-gray-300">— governance highlighted</span></p>
              {d.operations.length === 0 ? <p className="text-[12px] text-gray-400">No AI requests recorded.</p> : <Bars rows={d.operations.map((o: any) => ({ label: o.op, count: o.count, hi: o.governance }))} max={opMax} />}
            </div>

            {/* Providers + tiers */}
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Providers &amp; tiers</p>
              {d.providers.length === 0 ? <p className="text-[12px] text-gray-400">—</p> : <Bars rows={d.providers.map((p: any) => ({ label: p.provider, count: p.count }))} max={provMax} tone="bg-indigo-400" />}
              <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-gray-100">
                {d.tiers.map((t: any) => <span key={t.tier} className="text-[10px] text-gray-600 bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5 capitalize">{t.tier} <span className="font-semibold">{t.count}</span></span>)}
              </div>
            </div>
          </div>

          {/* Model registry + boundary */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Model registry (§8)</p>
                {d.models.defaultModel && <span className="text-[10px] text-gray-400">default: {d.models.defaultModel}</span>}
              </div>
              <div className="grid grid-cols-4 gap-2">
                {(["active", "preview", "deprecated", "retired"] as const).map((s) => (
                  <div key={s} className="border border-gray-100 rounded-lg p-2 text-center">
                    <p className={`text-lg font-bold tabular-nums ${s === "active" ? "text-[var(--cmp-text-success)]" : s === "retired" || s === "deprecated" ? "text-gray-400" : "text-gray-900"}`}>{d.models.status[s]}</p>
                    <p className="text-[10px] text-gray-500 capitalize">{s}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Human-in-the-loop boundary (§7)</p>
              <p className="text-[11px] text-gray-500 mb-2">Autonomous assurance may monitor evidence, surveil risk, prepare reports and identify trends. It does <span className="font-semibold text-gray-700">not</span> autonomously:</p>
              <div className="flex flex-wrap gap-1.5">
                {CANNOT.map((c) => <span key={c} className="text-[10px] font-semibold text-[var(--cmp-text-error)] bg-[var(--cmp-surface-error)] border border-[var(--cmp-color-error)] rounded px-1.5 py-0.5">✕ {c}</span>)}
              </div>
            </div>
          </div>

          <p className="text-[11px] text-gray-400 leading-relaxed">Every figure is real — the AI activity is the governed gateway request log (all AI runs through it), and the model registry is live. The agent map is grounded in the surfaces each agent operates over: the Governance Assistant is the live <Link href="/super-admin/cgr/ai" className="text-[var(--cmp-text-success)] hover:underline">governance copilot</Link>, Change Impact the <Link href="/super-admin/cgr/change-control" className="text-[var(--cmp-text-success)] hover:underline">blast-radius engine</Link>, and Risk the <Link href="/super-admin/cgr/risk" className="text-[var(--cmp-text-success)] hover:underline">escalation engine</Link>. Model management and AI operations are owned by the <Link href="/super-admin/ai/services" className="text-[var(--cmp-text-success)] hover:underline">AI Services platform</Link>. Per the CGR mandate every recommendation is explainable (evidence, reasoning, confidence) and a human always approves.</p>
        </div>
      )}
    </div>
  );
}
