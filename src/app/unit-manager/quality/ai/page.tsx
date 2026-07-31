import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { loadAiQualityIntelligence } from "@/lib/operations/ai-quality-intelligence";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import QualityTabs from "../QualityTabs";
import { qcard, QHeader, NextPhase, CrossLink } from "../widgets";

export const dynamic = "force-dynamic";

// AI Quality Intelligence Centre (UMG-QS-011) — aligned to the spec. The AI layer over the Quality & Safety
// domain: composes the live clinical-indicator + M&M stores and derives an enterprise AI quality-risk index, a
// predictive engine (linear trend forecasts + breach prediction + confidence), emerging-risk detection, root-cause
// intelligence (from real M&M contributory factors + causes of death), a prioritised explainable recommendation
// engine, and a natural-language executive brief (Claude when configured, rule-based fallback). Explainable +
// human-in-the-loop. Model governance / drift monitoring are honest next-phase. Gate hospital_admin/super_admin.
/* eslint-disable @typescript-eslint/no-explicit-any */
const impactPill: Record<string, string> = { High: "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]", Medium: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]", Low: "bg-[var(--cmp-surface-success)] text-emerald-700" };
const sevPill: Record<string, string> = { high: "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]", medium: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]" };
const CAUSE_COLORS = ["#ef4444", "#8b5cf6", "#fb923c", "#3b82f6", "#10b981"];
const fmt = (v: any, unit: string) => (v == null ? "—" : unit === "percent" ? `${v}%` : unit === "rate_per_1000" ? `${v}/1k` : `${v}`);

function RiskRing({ score }: { score: number | null }) {
  const s = score ?? 0; const col = s >= 60 ? "#ef4444" : s >= 40 ? "#f59e0b" : "#10b981";
  const word = s >= 60 ? "High" : s >= 40 ? "Elevated" : "Contained";
  return <div className="flex flex-col items-center"><div className="relative" style={{ width: 128, height: 128 }}><div className="rounded-full w-full h-full" style={{ background: `conic-gradient(${col} ${s * 3.6}deg, #f1f5f9 0deg)` }} /><div className="absolute inset-[15px] bg-white rounded-full flex flex-col items-center justify-center"><span className="text-3xl font-bold tabular-nums" style={{ color: col }}>{score ?? "—"}</span><span className="text-[9px] text-gray-400">/ 100 risk</span></div></div><span className="text-[11px] font-medium mt-1.5" style={{ color: col }}>{word} risk</span></div>;
}

export default async function AiQualityIntelligenceCentre() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");
  const hid = profile?.hospital_id ?? null;

  const [d, departments] = await Promise.all([
    loadAiQualityIntelligence(admin, hid, isSuper) as Promise<any>,
    loadUnitDepartments(admin, hid, isSuper).catch(() => []),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <QHeader code="UMG-QS-011" title="AI Quality Intelligence Centre" subtitle="Predictive, explainable AI across the Quality & Safety domain" />
        <UnitFilters departments={departments} />
      </div>
      <QualityTabs />
    </>
  );

  if (!d.provisioned) return <div className="space-y-4">{header}<div className={`${qcard} p-8 text-center`}><p className="text-sm text-gray-500">No quality data available for AI analysis yet.</p><p className="text-xs text-gray-400 mt-1">Seed clinical indicators (QS-008) and M&amp;M cases (QS-009) — the AI layer analyses those live stores.</p></div></div>;

  const k = d.kpis;

  return (
    <div className="space-y-4">
      {header}

      {/* AI KPI ribbon */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { icon: "🧠", tint: "bg-fuchsia-50", label: "AI Quality-Risk Index", value: k.aiRiskIndex ?? "—", unit: "/100", tone: (k.aiRiskIndex ?? 0) >= 60 ? "text-[var(--cmp-text-error)]" : (k.aiRiskIndex ?? 0) >= 40 ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-success)]" },
          { icon: "🔮", tint: "bg-indigo-50", label: "Predicted Breaches", value: k.predictedBreaches, tone: k.predictedBreaches ? "text-[var(--cmp-text-error)]" : "text-[var(--cmp-text-success)]", sub: "next period" },
          { icon: "💡", tint: "bg-[var(--cmp-surface-warning)]", label: "AI Recommendations", value: k.recommendations, sub: "prioritised" },
          { icon: "📈", tint: "bg-[var(--cmp-surface-information)]", label: "Forecast Confidence", value: k.forecastConfidence != null ? `${k.forecastConfidence}%` : "—", sub: "mean model fit" },
          { icon: "⚠️", tint: "bg-[var(--cmp-surface-warning)]", label: "Emerging Risks", value: k.emergingRisks, tone: k.emergingRisks ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-success)]" },
          { icon: "🔗", tint: "bg-teal-50", label: "Data Sources", value: k.dataSources, sub: "live stores analysed" },
        ].map(kp => (
          <div key={kp.label} className={`${qcard} p-3`}>
            <div className="flex items-center gap-2 mb-1"><span className={`w-7 h-7 rounded-lg ${kp.tint} flex items-center justify-center text-sm shrink-0`}>{kp.icon}</span><span className="text-[10px] text-gray-500 leading-tight">{kp.label}</span></div>
            <p className={`text-xl font-bold tabular-nums ${kp.tone ?? "text-gray-900"}`}>{kp.value}{kp.unit && <span className="text-[11px] text-gray-400 font-normal">{kp.unit}</span>}</p>
            {kp.sub && <p className="text-[10px] text-gray-400">{kp.sub}</p>}
          </div>
        ))}
      </div>

      {/* Executive brief + risk ring */}
      <div className={`${qcard} p-5`}>
        <div className="flex items-start gap-5 flex-wrap">
          <RiskRing score={d.aiRiskIndex} />
          <div className="flex-1 min-w-[240px]">
            <div className="flex items-center gap-2 mb-1.5"><h3 className="font-semibold text-gray-900 text-sm">AI Executive Brief</h3><span className={`text-[9px] px-1.5 py-0.5 rounded ${d.narrativeSource === "ai" ? "bg-fuchsia-100 text-fuchsia-700" : "bg-gray-100 text-gray-500"}`}>{d.narrativeSource === "ai" ? "✨ Claude-generated" : "rule-based"}</span></div>
            <p className="text-sm text-gray-600 leading-relaxed">{d.narrative}</p>
            <p className="text-[10px] text-gray-300 mt-2">Explainable + human-in-the-loop — every prediction below shows its confidence and evidence. Model governance &amp; drift monitoring are next-phase.</p>
          </div>
        </div>
      </div>

      {/* Predictive engine · emerging risks */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={`${qcard} p-5 lg:col-span-2`}>
          <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900 text-sm">Predictive Quality Engine</h3><span className="text-[10px] text-gray-400">next-period forecast · trend regression</span></div>
          {d.predictions.length ? <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-left text-gray-400 border-b border-gray-100"><th className="py-1.5 font-medium">Metric</th><th className="py-1.5 font-medium text-right">Current</th><th className="py-1.5 font-medium text-right">Forecast</th><th className="py-1.5 font-medium">Trend</th><th className="py-1.5 font-medium">Outlook</th><th className="py-1.5 font-medium text-right">Conf.</th></tr></thead>
            <tbody>{d.predictions.map((p: any, i: number) => (
              <tr key={i} className="border-b border-gray-50"><td className="py-1.5 text-gray-700 max-w-[160px] truncate" title={p.name}>{p.name}<span className="block text-[9px] text-gray-400">{p.category}</span></td>
                <td className="py-1.5 text-right tabular-nums text-gray-600">{fmt(p.current, p.unit)}</td>
                <td className={`py-1.5 text-right tabular-nums font-semibold ${p.breach ? "text-[var(--cmp-text-error)]" : "text-gray-800"}`}>{fmt(p.forecast, p.unit)}</td>
                <td className="py-1.5">{p.dir === "up" ? "↑" : p.dir === "down" ? "↓" : "→"}</td>
                <td className="py-1.5">{p.breach ? <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]">Breach risk</span> : <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--cmp-surface-success)] text-emerald-700">On track</span>}</td>
                <td className="py-1.5 text-right tabular-nums text-gray-500">{p.confidence}%</td>
              </tr>
            ))}</tbody></table></div> : <p className="text-sm text-gray-400 py-6 text-center">Not enough trend history to forecast yet.</p>}
        </div>

        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Emerging Risks</h3>
          <div className="space-y-2">{d.emerging.map((e: any, i: number) => (
            <div key={i} className="flex items-start gap-2"><span className="mt-0.5">{e.severity === "high" ? "🔴" : "🟠"}</span><div className="flex-1 min-w-0"><p className="text-[11px] font-medium text-gray-700">{e.signal}</p><p className="text-[10px] text-gray-500">{e.detail}</p></div><span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${sevPill[e.severity]}`}>{e.severity}</span></div>
          ))}{!d.emerging.length && <p className="text-[11px] text-[var(--cmp-text-success)]">No emerging risk signals detected.</p>}</div>
        </div>
      </div>

      {/* Recommendations · root cause */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={`${qcard} p-5 lg:col-span-2`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Quality Recommendation Engine <span className="text-gray-300 font-normal text-[10px]">explainable · prioritised</span></h3>
          <div className="space-y-2">{d.recommendations.map((r: any, i: number) => (
            <div key={i} className="border border-gray-100 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1"><span className="text-xs font-semibold text-gray-800 flex-1">{r.action}</span><span className={`text-[9px] px-1.5 py-0.5 rounded ${impactPill[r.impact]}`}>{r.impact} impact</span><span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{r.effort} effort</span><span className="text-[9px] px-1.5 py-0.5 rounded bg-fuchsia-50 text-fuchsia-600">{r.confidence}%</span></div>
              <p className="text-[11px] text-gray-500"><span className="text-gray-400">Evidence:</span> {r.evidence}<span className="text-gray-300"> · {r.category}</span></p>
            </div>
          ))}{!d.recommendations.length && <p className="text-sm text-gray-400 py-4 text-center">No recommendations — all signals within tolerance.</p>}</div>
        </div>

        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-1">Root-Cause Intelligence</h3>
          <p className="text-[10px] text-gray-400 mb-2">Probable contributing factors (M&amp;M reviews)</p>
          {d.rootCauses.length ? <div className="space-y-1.5">{d.rootCauses.map((c: any, i: number) => { const max = Math.max(1, ...d.rootCauses.map((x: any) => x.n)); return (
            <div key={i} className="flex items-center gap-2 text-[11px]"><span className="w-28 truncate text-gray-600 shrink-0">{c.factor}</span><div className="flex-1 h-2 bg-gray-100 rounded overflow-hidden"><div className="h-full rounded" style={{ width: `${(c.n / max) * 100}%`, background: CAUSE_COLORS[i % CAUSE_COLORS.length] }} /></div><span className="tabular-nums text-gray-500 w-10 text-right">{c.weight}%</span></div>
          ); })}</div> : <p className="text-[11px] text-gray-400">No contributory-factor data.</p>}
          {d.causePatterns.length > 0 && <><p className="text-[10px] font-semibold text-gray-500 mt-3 mb-1">Cause patterns</p><div className="flex flex-wrap gap-1">{d.causePatterns.map((c: any, i: number) => <span key={i} className="text-[9px] bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5 text-gray-600">{c.label} {c.pct}%</span>)}</div></>}
          <CrossLink href="/unit-manager/quality/mortality">M&amp;M Centre →</CrossLink>
        </div>
      </div>

      <NextPhase>AI Quality Intelligence Centre (UMG-QS-011) composes the live clinical-indicator (QS-008) + M&amp;M (QS-009) stores. Live: the enterprise AI quality-risk index, the predictive engine (linear trend regression → next-period forecasts + breach prediction + confidence from model fit), emerging-risk detection, root-cause intelligence (from real M&amp;M contributory factors + causes of death), the explainable prioritised recommendation engine, and a natural-language executive brief (Claude-generated when an AI provider is configured, otherwise rule-based). Explainable + human-in-the-loop by design. Honest next-phase: trained ML models with a model registry + drift/bias monitoring + continuous-learning feedback (§13/§14/§15), the interactive AI copilot chat, and vector document retrieval — the current engine is transparent trend-regression + rules over the real data. Gate hospital_admin/super_admin.</NextPhase>
    </div>
  );
}
