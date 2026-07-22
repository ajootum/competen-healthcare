import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadAiAnalytics } from "@/lib/super-admin/ai-analytics";
import AskPanel from "../_components/AskPanel";

export const dynamic = "force-dynamic";

// Intelligence Analytics (AIP-001.6) — measure AI usage, performance, safety and
// value. The most data-backed AIP module: usage, latency, cost, tokens, model/
// operation/tier breakdowns and the 7-day trend are live from plat_ai_requests.
// Recommendation acceptance, model accuracy and outcome tracking have no store
// yet → honest "—". Completes the AI & Intelligence Platform.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const fmt = (n: number) => n.toLocaleString();
const dash = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());
const ms = (n: number | null) => (n == null ? "—" : n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${n} ms`);
const money = (n: number | null | undefined) => (n == null ? "—" : `$${Number(n).toFixed(Number(n) < 1 ? 4 : 2)}`);

export default async function IntelligenceAnalytics() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const d = await loadAiAnalytics(admin);
  const k = d.kpis;

  const kpiCards = [
    { label: "Daily Active Users", value: dash(k.dau), icon: "👤", iconBg: "bg-blue-50" },
    { label: "AI Requests (24h)", value: dash(k.requests24h), icon: "📊", iconBg: "bg-violet-50" },
    { label: "Acceptance", value: k.acceptance == null ? "—" : `${k.acceptance}%`, icon: "✅", iconBg: "bg-gray-50", tone: "text-gray-400" },
    { label: "Accuracy", value: k.accuracy == null ? "—" : `${k.accuracy}%`, icon: "🎯", iconBg: "bg-gray-50", tone: "text-gray-400" },
    { label: "Avg Latency", value: ms(k.avgLatencyMs), icon: "⚡", iconBg: "bg-teal-50" },
    { label: "Knowledge Coverage", value: k.knowledgeCoverage == null ? "—" : `${k.knowledgeCoverage}%`, icon: "📚", iconBg: "bg-amber-50" },
    { label: "Est. Cost (24h)", value: money(k.cost24h), icon: "💵", iconBg: "bg-green-50" },
    { label: "Safety Escalations", value: dash(k.safetyEscalations), icon: "🛡️", iconBg: "bg-rose-50", tone: (k.safetyEscalations ?? 0) > 0 ? "text-rose-600" : undefined },
  ];

  return (
    <div data-wide className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Link href="/super-admin/ai" className="hover:text-teal-700">AI &amp; Intelligence</Link><span>/</span><span className="text-gray-600">Intelligence Analytics</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mt-0.5">Intelligence Analytics</h1>
        <p className="text-sm text-gray-500">Measure AI usage, performance, safety and value across the platform.</p>
      </div>

      {!d.ready && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="font-semibold">Usage telemetry off.</span> AI analytics activate once the runtime gateway records requests (migration 055). Knowledge coverage below is live regardless.
        </div>
      )}

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

      {/* Live telemetry generator — every ask records a real plat_ai_requests row
          that immediately feeds the analytics below (reload to see it land). */}
      <AskPanel
        title="Generate Live Telemetry"
        placeholder="Ask anything — the request itself becomes an analytics data point…"
        prompts={[
          "Which frameworks are in the core library?",
          "Summarise the knowledge base composition",
          "What competencies exist for infection control?",
        ]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Usage trend */}
        <div className={`${card} p-5 lg:col-span-2`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">AI Usage Trend <span className="text-[10px] text-gray-400">last 7 days</span></h2>
            <span className="text-[10px] text-gray-400">{d.wau} active users · 7d</span>
          </div>
          <div className="flex items-end gap-2 h-32">
            {d.trend.map((t: any) => (
              <div key={t.day} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full bg-teal-100 rounded-t relative" style={{ height: `${(t.n / d.trendMax) * 100}%`, minHeight: t.n > 0 ? "4px" : "0" }}>
                  <div className="absolute inset-x-0 -top-4 text-[9px] text-gray-500 text-center tabular-nums">{t.n || ""}</div>
                </div>
                <span className="text-[9px] text-gray-400">{t.day}</span>
              </div>
            ))}
          </div>
          {d.trendMax === 1 && <p className="text-[10px] text-gray-400 mt-2 text-center">No AI requests recorded in the last 7 days.</p>}
        </div>

        {/* Cost & consumption */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Cost &amp; Consumption</h2>
          <div className="space-y-2">
            {[
              ["Cost (24h)", money(d.cost.cost24h)],
              ["Cost (all-time)", money(d.cost.totalCost)],
              ["Tokens (24h)", d.cost.tokens24h == null ? "—" : fmt(d.cost.tokens24h)],
              ["Requests (all-time)", dash(d.cost.totalRequests)],
            ].map(([l, v]: any) => (
              <div key={l} className="flex items-center justify-between text-sm"><span className="text-gray-500">{l}</span><span className="tabular-nums font-medium text-gray-800">{v}</span></div>
            ))}
          </div>
          <Link href="/super-admin/platform-ops/ai-gateway" className="block text-center text-xs text-teal-700 hover:underline mt-3 pt-2 border-t border-gray-50">AI Gateway →</Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Usage by model */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Usage by Model <span className="text-[10px] text-gray-400">24h</span></h2>
          {d.byModel.length === 0 ? <p className="text-sm text-gray-400 py-4 text-center">No AI requests in 24h.</p> : (
            <div className="space-y-1.5">
              {d.byModel.map((m: any) => (
                <div key={m.label} className="flex items-center justify-between text-xs"><span className="font-mono text-gray-700 truncate">{m.label}</span><span className="tabular-nums text-gray-500 shrink-0 ml-2">{m.n} · {money(m.cost)}</span></div>
              ))}
            </div>
          )}
        </div>

        {/* Usage by operation */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Usage by Operation <span className="text-[10px] text-gray-400">24h</span></h2>
          {d.byOperation.length === 0 ? <p className="text-sm text-gray-400 py-4 text-center">No attributed operations.</p> : (
            <div className="space-y-1.5">
              {d.byOperation.map((o: any) => (
                <div key={o.label} className="flex items-center justify-between text-xs"><span className="text-gray-700 truncate">{o.label}</span><span className="tabular-nums text-gray-500 shrink-0 ml-2">{o.n} · {money(o.cost)}</span></div>
              ))}
            </div>
          )}
        </div>

        {/* Model performance */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Model Performance</h2>
          <div className="space-y-2 text-sm">
            {[
              ["Avg latency", ms(d.performance.avgLatencyMs)],
              ["Error rate", d.performance.errorRate == null ? "—" : `${d.performance.errorRate}%`],
              ["Refusal rate", d.performance.refusalRate == null ? "—" : `${d.performance.refusalRate}%`],
              ["Accuracy", "—"],
              ["Source grounding", "—"],
              ["Confidence calibration", "—"],
            ].map(([l, v]: any) => (
              <div key={l} className="flex items-center justify-between"><span className="text-gray-500">{l}</span><span className={`tabular-nums font-medium ${v === "—" ? "text-gray-400" : "text-gray-800"}`}>{v}</span></div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recommendation analytics */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Recommendation Analytics</h2>
          <div className="grid grid-cols-3 gap-2">
            {d.recommendation.map((r: any) => (
              <div key={r.label} className="rounded-lg border border-gray-100 p-3 text-center">
                <p className={`text-lg font-bold tabular-nums ${r.value == null ? "text-gray-300" : "text-gray-900"}`}>{dash(r.value)}</p>
                <p className="text-[9px] text-gray-500 mt-0.5 leading-tight">{r.label}</p>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-3">Generation is observable from the runtime gateway; the acceptance funnel (viewed → accepted → implemented) is stored as recommendation feedback is wired.</p>
        </div>

        {/* Responsible AI monitoring */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Responsible AI Monitoring</h2>
          <div className="grid grid-cols-2 gap-2">
            {d.responsible.map((r: any) => (
              <div key={r.label} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2">
                <span className="text-xs text-gray-600">{r.label}</span>
                <span className={`text-sm font-bold tabular-nums ${r.value == null ? "text-gray-300" : r.ok === false ? "text-rose-600" : "text-gray-900"}`}>{r.value == null ? "—" : r.value}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-3">Errors and refusals are captured live at the generate() choke point. Bias, privacy, override and drift monitoring are honest “—” until those detectors are wired.</p>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Intelligence Analytics measures usage, performance, safety and value. Usage, latency, cost, tokens and the model/operation/tier breakdowns are live from the AI runtime gateway (plat_ai_requests); knowledge coverage is live from the CKP knowledge base. Recommendation acceptance, model accuracy, source-grounding and outcome tracking show honest “—” until evaluation and feedback capture are wired — completing the responsible-AI measurement loop.</p>
    </div>
  );
}
