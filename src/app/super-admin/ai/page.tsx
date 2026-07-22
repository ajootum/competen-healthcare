import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadAiPlatform } from "@/lib/super-admin/ai";

export const dynamic = "force-dynamic";

// AI & Intelligence Platform (AIP-001) — the enterprise intelligence layer home.
// A command dashboard: the top KPI ribbon, the six module cards (each with live
// KPIs and its sub-modules), a copilot spotlight and the AI operations status.
// Every number is live from the AI runtime telemetry or an honest "—"; nothing
// is fabricated.
/* eslint-disable @typescript-eslint/no-explicit-any */

const ACCENT: Record<number, { badge: string; action: string }> = {
  1: { badge: "bg-blue-100 text-blue-700", action: "bg-blue-600 hover:bg-blue-700" },
  2: { badge: "bg-teal-100 text-teal-700", action: "bg-teal-600 hover:bg-teal-700" },
  3: { badge: "bg-violet-100 text-violet-700", action: "bg-violet-600 hover:bg-violet-700" },
  4: { badge: "bg-orange-100 text-orange-700", action: "bg-orange-600 hover:bg-orange-700" },
  5: { badge: "bg-rose-100 text-rose-700", action: "bg-rose-600 hover:bg-rose-700" },
  6: { badge: "bg-indigo-100 text-indigo-700", action: "bg-indigo-600 hover:bg-indigo-700" },
};
const TRUST = ["🔐 Secure & Compliant", "📎 Evidence Grounded", "🧑‍⚕️ Human-in-the-Loop", "🔍 Transparent & Explainable", "⚖️ Governed & Audited", "📈 Scalable & Reliable"];

const pct = (n: number | null) => (n == null ? "—" : `${n}%`);
const ms = (n: number | null) => (n == null ? "—" : n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${n} ms`);
const big = (n: number | null) => {
  if (n == null) return "—";
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
};

export default async function AiIntelligencePlatform() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const p = await loadAiPlatform(admin);
  const r = p.ribbon;
  const o = p.opsStatus;

  const ribbon = [
    { label: "AI Health", value: pct(r.aiHealth), icon: "🛡️", tone: r.aiHealth != null && r.aiHealth >= 95 ? "text-green-600" : r.aiHealth == null ? "text-gray-400" : "text-amber-600" },
    { label: "Running Agents", value: big(r.runningAgents), icon: "🤖" },
    { label: "Queued Jobs", value: big(r.queuedJobs), icon: "🗂️" },
    { label: "Failed Jobs", value: big(r.failedJobs), icon: "⚠️", tone: (r.failedJobs ?? 0) > 0 ? "text-rose-600" : undefined },
    { label: "Models Online", value: big(r.modelsOnline), icon: "🧠" },
    { label: "Inference Requests", value: big(r.inferenceRequests), icon: "📊" },
    { label: "Avg Response", value: ms(r.avgResponseMs), icon: "⚡" },
    { label: "Knowledge Updates", value: big(r.knowledgeUpdates), icon: "📚" },
  ];

  return (
    <div data-wide className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">AI &amp; Intelligence Platform</h1>
          <p className="text-sm text-gray-500">The enterprise intelligence layer powering every Competen engine — six modules.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium px-2.5 py-1 rounded-lg ${o.configured ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>{o.configured ? `● ${o.provider} configured` : "AI not configured"}</span>
          <span className="text-xs text-gray-400 tabular-nums">Updated {new Date(p.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
      </div>

      {/* KPI ribbon */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        {ribbon.map(c => (
          <div key={c.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-start justify-between">
              <span className="text-[11px] font-semibold text-gray-500 leading-tight">{c.label}</span>
              <span className="text-sm shrink-0">{c.icon}</span>
            </div>
            <p className={`text-2xl font-bold mt-1.5 tabular-nums ${(c as any).tone ?? "text-gray-900"}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Six module cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {p.modules.map((m: any) => {
          const ac = ACCENT[m.n] ?? ACCENT[1];
          return (
            <div key={m.n} className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col hover:border-teal-300 hover:shadow-sm transition-all">
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex items-start gap-2.5 min-w-0">
                  <span className={`w-7 h-7 rounded-lg ${ac.badge} flex items-center justify-center text-sm font-bold shrink-0`}>{m.n}</span>
                  <div className="min-w-0">
                    <h2 className="text-sm font-bold text-gray-900 leading-tight">{m.name}</h2>
                    <p className="text-[11px] text-gray-500 leading-tight mt-0.5">{m.desc}</p>
                  </div>
                </div>
                <Link href={m.href} className={`text-[11px] font-semibold text-white rounded-lg px-2.5 py-1.5 shrink-0 ${ac.action}`}>{m.action}</Link>
              </div>

              <div className="grid grid-cols-4 gap-2 mb-3">
                {m.kpis.map((k: any) => (
                  <div key={k.label} className="rounded-lg border border-gray-100 py-2 px-1 text-center">
                    <p className="text-base font-bold text-gray-900 tabular-nums leading-none">{k.value}</p>
                    <p className="text-[9px] text-gray-500 mt-1 leading-tight">{k.label}</p>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-1 mb-3">
                {m.subs.map((s: string) => <span key={s} className="text-[9px] text-gray-500 bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5">{s}</span>)}
              </div>

              <Link href={m.href} className="mt-auto text-xs font-semibold text-teal-700 hover:underline">Open {m.name.split(" ")[0]} workspace →</Link>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* AI Operations Status */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">AI Operations Status</h2>
            <Link href="/super-admin/ai/operations" className="text-xs text-teal-700 hover:underline">View all →</Link>
          </div>
          <div className="space-y-2 text-sm">
            {[
              ["Provider", o.configured ? `${o.provider}` : "Not configured", o.configured],
              ["Heavy model", o.models?.heavy ?? "—", true],
              ["Job runner", o.jobsReady ? "Ready" : "Not ready", o.jobsReady],
              ["Running jobs", o.running ?? "—", true],
              ["Failed jobs (24h)", o.failed24h ?? "—", (o.failed24h ?? 0) === 0],
              ["AI errors (24h)", o.errors24h ?? "—", (o.errors24h ?? 0) === 0],
              ["Refusals (24h)", o.refusals24h ?? "—", true],
              ["Avg latency", ms(o.avgLatencyMs), true],
              ["Pending approvals", o.pendingApprovals, true],
              ["Est. cost (24h)", o.cost24h != null ? `$${o.cost24h.toFixed(2)}` : "—", true],
            ].map(([label, value, ok]: any) => (
              <div key={label} className="flex items-center justify-between">
                <span className="text-gray-500">{label}</span>
                <span className={`tabular-nums font-medium ${ok === false ? "text-amber-600" : "text-gray-800"}`}>{String(value)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Copilot Spotlight */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">Copilot Spotlight</h2>
            <span className="text-[10px] text-gray-400">usage today · live from AI runtime</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {p.copilots.map((c: any) => (
              <div key={c.key} className="flex items-center gap-3 rounded-lg border border-gray-100 p-3">
                <span className="w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center text-base shrink-0">{c.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-800 leading-tight">{c.name}</p>
                  <p className="text-[10px] text-gray-500 leading-tight truncate">{c.desc}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-lg font-bold text-gray-900 tabular-nums leading-none">{c.usageToday.toLocaleString()}</p>
                  <p className="text-[9px] text-gray-400">requests</p>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-3">Copilots map to the real server-side AI operations recorded in the runtime gateway. Model accuracy is not yet metered — Intelligence Analytics will surface it once evaluation is wired.</p>
        </div>
      </div>

      {/* Trust / capability footer */}
      <div className="bg-white rounded-xl border border-gray-200 px-5 py-3 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
        {TRUST.map(t => <span key={t} className="text-[11px] font-medium text-gray-500">{t}</span>)}
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The AI &amp; Intelligence Platform is the enterprise intelligence layer above every Competen engine. The KPI ribbon, operations status and copilot usage are live from the AI runtime gateway (plat_ai_requests), the background job runner and the approval queue. Metrics the platform does not yet meter — recommendation acceptance, model accuracy, workforce/enterprise scores — show honest “—” states and are wired module by module.</p>
    </div>
  );
}
