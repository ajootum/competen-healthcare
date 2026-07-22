import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { aiStatus } from "@/lib/ai/config";
import { loadAiGovernance } from "@/lib/ai/gateway";

export const dynamic = "force-dynamic";

// AI Runtime Gateway console (PFS-000 §15) — provider/model config, live usage
// analytics (requests, tokens, cost, latency) and governance. Usage is metered
// at the shared generate() choke point; honest states before RUN-ME-055.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const fmt = (n: number) => n.toLocaleString();
const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
const money = (n: number) => `$${(n ?? 0).toFixed(n < 1 ? 4 : 2)}`;
const STATUS_TONE: Record<string, string> = { ok: "text-green-600", refusal: "text-amber-600", error: "text-rose-600", not_configured: "text-gray-400" };

export default async function AiGatewayConsole() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const status = aiStatus();
  const gov = await loadAiGovernance(admin);
  const s = gov.summary;
  const hourlyLimit = Number(process.env.AI_HOURLY_LIMIT ?? 30);

  const health = !status.configured ? "Not configured" : s.errors24h > 0 ? "Degraded" : "Operational";
  const healthTone = !status.configured ? "text-gray-400" : s.errors24h > 0 ? "text-amber-600" : "text-green-600";
  const healthBg = !status.configured ? "bg-gray-50" : s.errors24h > 0 ? "bg-amber-50" : "bg-green-50";

  const kpis = [
    { label: "Gateway", value: health, icon: status.configured ? "✨" : "🚫", iconBg: healthBg, tone: healthTone, sub: status.provider ? `${status.provider} provider` : "no provider key" },
    { label: "Requests (24h)", value: s.ready ? fmt(s.requests24h) : "—", icon: "🧠", iconBg: "bg-purple-50", sub: s.ready ? `${s.errors24h} errors · ${s.refusals24h} refusals` : "telemetry off", muted: !s.ready },
    { label: "Tokens (24h)", value: s.ready ? fmt(s.tokens24h) : "—", icon: "🔤", iconBg: "bg-sky-50", sub: "input + output", muted: !s.ready },
    { label: "Est. Cost (24h)", value: s.ready ? money(s.cost24h) : "—", icon: "💵", iconBg: "bg-violet-50", sub: "from list pricing", muted: !s.ready },
    { label: "Avg Latency", value: s.avgLatencyMs == null ? "—" : `${s.avgLatencyMs} ms`, icon: "⏱️", iconBg: "bg-teal-50", sub: "per generation", muted: s.avgLatencyMs == null },
    { label: "Rate Limit", value: `${hourlyLimit}/hr`, icon: "🚦", iconBg: "bg-amber-50", sub: "per user (quota.ts)" },
  ];

  const tiers = status.models ? [["cheap", status.models.cheap], ["reasoning", status.models.reasoning], ["heavy", status.models.heavy], ["embedding", status.models.embedding]] : [];

  return (
    <div data-wide className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Link href="/super-admin/platform-ops" className="hover:text-teal-700">Platform Operations</Link><span>/</span><span className="text-gray-600">AI Runtime Gateway</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mt-0.5">AI Runtime Gateway</h1>
        <p className="text-sm text-gray-500">Provider governance, model routing, token accounting and usage analytics.</p>
      </div>

      {!s.ready && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="font-semibold">Usage telemetry off.</span> Run <code className="font-mono text-[12px] bg-amber-100 px-1 rounded">supabase/RUN-ME-055-ai-gateway.sql</code> to record AI usage. Provider config below is live; requests/tokens/cost activate after.
        </div>
      )}
      {!status.configured && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
          No AI provider key detected. Set <code className="font-mono text-[12px] bg-gray-100 px-1 rounded">ANTHROPIC_API_KEY</code> (or OpenAI/Gemini) to enable generation.
        </div>
      )}

      {/* KPI ribbon */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map(k => (
          <div key={k.label} className={`${card} p-4`}>
            <div className="flex items-start justify-between">
              <span className="text-[11px] font-semibold text-gray-500 leading-tight">{k.label}</span>
              <span className={`w-7 h-7 rounded-lg ${k.iconBg} flex items-center justify-center text-sm shrink-0`}>{k.icon}</span>
            </div>
            <p className={`text-2xl font-bold mt-1.5 tabular-nums ${(k as any).muted ? "text-gray-400" : (k as any).tone ?? "text-gray-900"}`}>{k.value}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{k.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Model routing */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Model Routing</h2>
          {tiers.length === 0 ? <p className="text-sm text-gray-400">No provider configured.</p> : (
            <div className="space-y-2">
              {tiers.map(([tier, model]) => (
                <div key={tier} className="flex items-center justify-between text-sm">
                  <span className="capitalize text-gray-600">{tier}</span>
                  <span className="font-mono text-[11px] text-gray-800 truncate ml-2">{model}</span>
                </div>
              ))}
            </div>
          )}
          <p className="text-[10px] text-gray-400 mt-3 pt-2 border-t border-gray-50">Tiers resolve per job (cheap / reasoning / heavy) via lib/ai/config; override with AI_MODEL_* env vars.</p>
        </div>

        {/* Usage by model */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Usage by Model <span className="text-[10px] text-gray-400">24h</span></h2>
          {!s.ready || gov.byModel.length === 0 ? <p className="text-sm text-gray-400 py-4 text-center">{s.ready ? "No AI requests in 24h." : "Telemetry off."}</p> : (
            <div className="space-y-1.5">
              {gov.byModel.map((m: any) => (
                <div key={m.label} className="flex items-center justify-between text-xs">
                  <span className="font-mono text-gray-700 truncate">{m.label}</span>
                  <span className="tabular-nums text-gray-500 shrink-0 ml-2">{m.n} · {fmt(m.tokens)}t · {money(m.cost)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Usage by operation */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Usage by Operation <span className="text-[10px] text-gray-400">24h</span></h2>
          {!s.ready || gov.byOperation.length === 0 ? <p className="text-sm text-gray-400 py-4 text-center">{s.ready ? "No attributed operations." : "Telemetry off."}</p> : (
            <div className="space-y-1.5">
              {gov.byOperation.map((o: any) => (
                <div key={o.label} className="flex items-center justify-between text-xs">
                  <span className="text-gray-700 truncate">{o.label}</span>
                  <span className="tabular-nums text-gray-500 shrink-0 ml-2">{o.n} · {money(o.cost)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent requests */}
      <div className={`${card} p-5`}>
        <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Recent AI Requests</h2>
        {!s.ready || gov.recent.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">{s.ready ? "No AI requests recorded yet." : "Run the migration to record usage."}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                <th className="px-3 py-2 font-semibold">Operation</th><th className="px-3 py-2 font-semibold">Model</th><th className="px-3 py-2 font-semibold">Tier</th>
                <th className="px-3 py-2 font-semibold text-right">Tokens</th><th className="px-3 py-2 font-semibold text-right">Latency</th><th className="px-3 py-2 font-semibold text-right">Cost</th><th className="px-3 py-2 font-semibold text-right">Status</th><th className="px-3 py-2 font-semibold text-right">When</th>
              </tr></thead>
              <tbody>
                {gov.recent.map((r: any, i: number) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="px-3 py-2 text-gray-700">{r.operation ?? <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-gray-600">{r.model}</td>
                    <td className="px-3 py-2 text-gray-500 capitalize">{r.tier}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-600">{fmt(r.tokens ?? 0)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-500">{r.latency == null ? "—" : `${r.latency}ms`}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-600">{r.cost == null ? "—" : money(Number(r.cost))}</td>
                    <td className={`px-3 py-2 text-right capitalize ${STATUS_TONE[r.status] ?? "text-gray-500"}`}>{r.status}</td>
                    <td className="px-3 py-2 text-right text-[11px] text-gray-400">{relTime(r.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Every server-side generation routes through one gateway (lib/ai/client → generate), which records model, tokens, latency, status and estimated cost. Per-user rate limiting is live ({hourlyLimit}/hr, lib/ai/quota); token budgets, response caching and per-tenant AI policies are the next governance layer. Cost is estimated from provider list pricing and excludes prompt-cache discounts.</p>
    </div>
  );
}
