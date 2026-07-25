import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadPatientSafetyCentre } from "@/lib/operations/patient-safety-centre";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import QualityTabs from "../QualityTabs";
import { Kpi, StackedTrend, TrendLegend, Row, Rag, NextPhase, CrossLink } from "../widgets";

export const dynamic = "force-dynamic";

// Patient Safety Centre (UMG-QS-007) — aligned to the high-fidelity spec + mockup. A proactive, real-time
// patient-safety command centre: 10-KPI ribbon, real-time Safety Surveillance tiles, Safety Events donut,
// High-Risk Patient Monitoring, 6-month severity trend, Safety Improvement Projects, rule-based AI insights,
// Never Events and Learning From Events. Manager LENS over the operational safety stores (op_incidents /
// op_safety_alerts / op_observations / op_escalations / op_patients / op_quality_actions) — no store forked.
/* eslint-disable @typescript-eslint/no-explicit-any */
const card = "bg-white rounded-xl border border-gray-200";
const IPSG = [
  "Identify Patients Correctly", "Improve Effective Communication", "Improve Medication Safety",
  "Ensure Correct Procedure / Site / Patient", "Reduce Risk of Healthcare-Associated Infection",
  "Reduce Risk of Patient Harm from Falls",
];
const DATA_SOURCES = ["Incident Management", "Clinical Indicators", "Audit & Compliance", "CAPA Centre", "Patient Operations", "IPC System"];

// Multi-segment donut (prefix-sum arcs — no render-scope mutation).
function SegDonut({ segments, total }: { segments: { n: number; color: string }[]; total: number }) {
  const sum = segments.reduce((a, s) => a + s.n, 0) || 1;
  const active = segments.filter(s => s.n > 0);
  const grad = active.length
    ? `conic-gradient(${active.map((s, i) => { const before = active.slice(0, i).reduce((a, x) => a + x.n, 0); return `${s.color} ${(before / sum) * 360}deg ${((before + s.n) / sum) * 360}deg`; }).join(", ")})`
    : "conic-gradient(#f1f5f9 0deg 360deg)";
  return <div className="relative w-[132px] h-[132px] shrink-0" style={{ background: grad, borderRadius: "9999px" }}><div className="absolute inset-[18px] bg-white rounded-full flex flex-col items-center justify-center"><span className="text-2xl font-bold text-gray-900 tabular-nums leading-none">{total}</span><span className="text-[10px] text-gray-400">Events</span></div></div>;
}

function Tile({ icon, tint, label, n }: { icon: string; tint: string; label: string; n: number | null }) {
  return (
    <div className="border border-gray-100 rounded-xl p-3 flex flex-col gap-1">
      <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm ${tint}`}>{icon}</span>
      <span className="text-xl font-bold text-gray-900 tabular-nums leading-none">{n == null ? "—" : n}</span>
      <span className="text-[10px] text-gray-500 leading-tight">{label}</span>
    </div>
  );
}

const scoreTone = (s: number | null) => (s == null ? "text-gray-400" : s >= 85 ? "text-emerald-600" : s >= 70 ? "text-amber-600" : "text-rose-600");
const scoreWord = (s: number | null) => (s == null ? "—" : s >= 85 ? "Good" : s >= 70 ? "Fair" : "Needs focus");
const riskTone = (s: number) => (s >= 8 ? "bg-rose-500 text-white" : s >= 7 ? "bg-orange-400 text-white" : "bg-amber-300 text-amber-900");
const aiTint: Record<string, string> = { red: "bg-rose-50 text-rose-600", amber: "bg-amber-50 text-amber-600", purple: "bg-violet-50 text-violet-600" };

export default async function PatientSafetyCentre() {
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
    loadPatientSafetyCentre(admin, hid, isSuper) as Promise<any>,
    loadUnitDepartments(admin, hid, isSuper).catch(() => []),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="w-9 h-9 rounded-lg bg-rose-50 flex items-center justify-center text-lg">🛡️</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Patient Safety Centre <span className="text-gray-300 font-medium text-lg">(UMG-QS-007)</span></h1><p className="text-sm text-gray-500">Proactively monitor, prevent and improve patient safety across the unit.</p></div></div>
        <div className="flex items-center gap-2">
          <UnitFilters departments={departments} />
          <Link href="/unit-manager/quality/patient-safety" className="text-xs border border-gray-200 rounded-lg px-3 py-2 text-gray-600 hover:bg-gray-50">↻ Refresh</Link>
          <Link href="/supervisor/quality-safety" className="text-xs bg-rose-600 text-white rounded-lg px-3 py-2 hover:bg-rose-700 font-medium">+ Report Event</Link>
        </div>
      </div>
      <QualityTabs />
    </>
  );

  if (!d.provisioned) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Safety operations not provisioned</p><p className="text-sm text-amber-800 mt-1">Apply migration 073 (op_incidents / op_quality_actions) to enable the Patient Safety Centre.</p></div></div>;

  const rb = d.ribbon;
  const KPIS = [
    { icon: "🛡️", tint: "bg-emerald-50 text-emerald-600", label: "Overall Safety Score", value: rb.safetyScore == null ? "—" : `${rb.safetyScore}%`, sub: scoreWord(rb.safetyScore), tone: scoreTone(rb.safetyScore) },
    { icon: "⚠️", tint: "bg-rose-50 text-rose-600", label: "Safety Events", value: rb.events, sub: "last 30 days" },
    { icon: "🚨", tint: "bg-rose-50 text-rose-600", label: "Serious Events", value: rb.serious, sub: "high / critical", tone: rb.serious ? "text-rose-600" : undefined },
    { icon: "🛟", tint: "bg-sky-50 text-sky-600", label: "Near Misses", value: rb.nearMisses, sub: "reported (no harm)" },
    { icon: "🤕", tint: "bg-amber-50 text-amber-600", label: "Falls", value: rb.falls, sub: "incidents · 30d" },
    { icon: "💊", tint: "bg-orange-50 text-orange-600", label: "Medication Errors", value: rb.medErrors, sub: "incidents · 30d" },
    { icon: "🦠", tint: "bg-emerald-50 text-emerald-600", label: "HAI", value: rb.hai, sub: "infections · 30d" },
    { icon: "🩹", tint: "bg-amber-50 text-amber-600", label: "Pressure Injuries", value: rb.pressure, sub: "incidents · 30d" },
    { icon: "🆔", tint: "bg-sky-50 text-sky-600", label: "ID Compliance", value: rb.idCompliance == null ? "—" : `${rb.idCompliance}%`, sub: rb.idCompliance == null ? "next-phase" : "" },
    { icon: "📈", tint: "bg-violet-50 text-violet-600", label: "Deterioration Detected", value: rb.deterioration == null ? "—" : `${rb.deterioration}%`, sub: "concern → escalation" },
  ];

  return (
    <div className="space-y-4">
      {header}

      {/* KPI ribbon */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {KPIS.map((k, i) => <Kpi key={i} icon={k.icon} tint={k.tint} label={k.label} value={k.value} sub={k.sub} tone={k.tone} />)}
      </div>

      {/* Row: Surveillance · Events donut · IPSG · High-risk patients */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className={`${card} p-4`}>
          <p className="font-semibold text-gray-900 text-sm mb-3">Safety Surveillance Centre <span className="text-[10px] text-gray-400">(Real-time)</span></p>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-3 gap-2.5">
            {d.surveillance.map((t: any, i: number) => <Tile key={i} icon={t.icon} tint={t.tint} label={t.label} n={t.n} />)}
          </div>
        </div>

        <div className={`${card} p-4`}>
          <p className="font-semibold text-gray-900 text-sm mb-3">Safety Events Overview</p>
          {d.donut.length ? (
            <div className="flex items-center gap-4">
              <SegDonut segments={d.donut} total={d.counts.incidents} />
              <div className="flex-1 space-y-1.5">{d.donut.map((c: any, i: number) => <Row key={i} color={c.color} label={c.label} v={`${c.n} (${c.pct}%)`} />)}</div>
            </div>
          ) : <p className="text-xs text-gray-400 py-8 text-center">No safety events recorded.</p>}
        </div>

        <div className={`${card} p-4`}>
          <p className="font-semibold text-gray-900 text-sm mb-3">IPSG Compliance</p>
          <div className="space-y-2">{IPSG.map((g, i) => <div key={i} className="flex items-center justify-between gap-2"><span className="text-[11px] text-gray-600 leading-tight">{i + 1}. {g}</span><Rag tone="gray" label="—" /></div>)}</div>
          <NextPhase>IPSG goal compliance needs a dedicated assessment store (next-phase). The underlying safety signals (medication, falls, HAI) are live in the ribbon + trend above.</NextPhase>
        </div>

        <div className={`${card} p-4`}>
          <p className="font-semibold text-gray-900 text-sm mb-3">High-Risk Patient Monitoring</p>
          {d.riskList.length ? (
            <div className="space-y-2">
              {d.riskList.map((p: any, i: number) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0"><p className="text-xs font-medium text-gray-800 truncate">{p.label}</p><p className="text-[10px] text-gray-400">{p.riskType}</p></div>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded tabular-nums ${riskTone(p.score)}`}>{p.score}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-gray-400 py-8 text-center">No high-risk patients flagged.</p>}
        </div>
      </div>

      {/* Row: Trend · Improvement projects · Alerts (next-phase) · AI insights */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className={`${card} p-4`}>
          <p className="font-semibold text-gray-900 text-sm mb-1">Safety Events Trend <span className="text-[10px] text-gray-400">(6 months)</span></p>
          <StackedTrend months={d.trend.months} series={d.trend.series} meta={d.trend.meta} />
          <TrendLegend meta={d.trend.meta} totals={d.trend.totals} />
        </div>

        <div className={`${card} p-4`}>
          <p className="font-semibold text-gray-900 text-sm mb-3">Safety Improvement Projects</p>
          {d.projects.length ? (
            <div className="space-y-3">
              {d.projects.map((p: any, i: number) => (
                <div key={i}>
                  <div className="flex items-center justify-between gap-2 mb-0.5"><span className="text-xs text-gray-700 truncate">{p.title}</span><Rag tone={p.tone} label={p.status.replace(/_/g, " ")} /></div>
                  <div className="w-full h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full bg-rose-500" style={{ width: `${p.progress}%` }} /></div>
                  <p className="text-[10px] text-gray-400 mt-0.5">{p.owner}{p.due ? ` · due ${p.due}` : ""}</p>
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-gray-400 py-6 text-center">No improvement projects yet.</p>}
          <div className="mt-3"><CrossLink href="/unit-manager/capa">Open CAPA & Improvement Centre</CrossLink></div>
        </div>

        <div className={`${card} p-4`}>
          <p className="font-semibold text-gray-900 text-sm mb-3">Safety Alerts &amp; Bulletins</p>
          <NextPhase>External safety alerts &amp; bulletins (MoH / WHO / manufacturer recalls) need a bulletins store — next-phase. Internal escalations are live in the surveillance tiles.</NextPhase>
        </div>

        <div className={`${card} p-4`}>
          <p className="font-semibold text-gray-900 text-sm mb-3">AI Patient Safety Intelligence <span className="text-[9px] font-semibold uppercase tracking-wider text-violet-500 bg-violet-50 rounded px-1 py-0.5">rule-based</span></p>
          {d.ai.length ? (
            <div className="space-y-2.5">
              {d.ai.map((a: any, i: number) => (
                <div key={i} className="flex items-start gap-2">
                  <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs shrink-0 ${aiTint[a.tone]}`}>◆</span>
                  <div><p className="text-[11px] text-gray-700 leading-snug">{a.text}</p><p className="text-[9px] text-gray-400 mt-0.5">{a.basis}</p></div>
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-gray-400 py-6 text-center">No safety signals above threshold.</p>}
        </div>
      </div>

      {/* Row: Huddles (next-phase) · Rounds (next-phase) · Never events · Learning */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className={`${card} p-4`}>
          <p className="font-semibold text-gray-900 text-sm mb-2">Safety Huddles</p>
          <NextPhase>Daily safety-huddle tracking (completed / planned / missed) needs a huddle store — next-phase.</NextPhase>
        </div>
        <div className={`${card} p-4`}>
          <p className="font-semibold text-gray-900 text-sm mb-2">Clinical Safety Rounds</p>
          <NextPhase>Leadership safety-round scheduling &amp; completion needs a rounds store — next-phase.</NextPhase>
        </div>
        <div className={`${card} p-4`}>
          <p className="font-semibold text-gray-900 text-sm mb-2">Never Events Register</p>
          <div className={`rounded-lg p-3 mb-2 flex items-center gap-3 ${d.neverEvents.thisYear ? "bg-rose-50" : "bg-emerald-50"}`}>
            <span className={`text-2xl font-bold tabular-nums ${d.neverEvents.thisYear ? "text-rose-600" : "text-emerald-600"}`}>{d.neverEvents.thisYear}</span>
            <span className="text-[11px] text-gray-600">Never Events this year (sentinel)</span>
          </div>
          {d.neverEvents.list.length ? d.neverEvents.list.map((n: any, i: number) => (
            <div key={i} className="flex items-center justify-between gap-2 py-1 border-t border-gray-50"><span className="text-[11px] text-gray-700 truncate">{n.title}</span><span className="text-[10px] text-gray-400 shrink-0">{n.at}</span></div>
          )) : <p className="text-[11px] text-emerald-600">No sentinel events on record — well done.</p>}
        </div>
        <div className={`${card} p-4`}>
          <p className="font-semibold text-gray-900 text-sm mb-2">Learning From Events</p>
          {d.learning.length ? (
            <div className="space-y-2">
              {d.learning.map((l: any, i: number) => (
                <div key={i} className="border-t border-gray-50 pt-2 first:border-0 first:pt-0"><p className="text-[11px] font-medium text-gray-700 truncate">{l.title}</p><p className="text-[10px] text-gray-500 leading-snug line-clamp-2">{l.lesson}</p><p className="text-[9px] text-gray-400 mt-0.5">{l.at}</p></div>
              ))}
            </div>
          ) : <p className="text-xs text-gray-400 py-6 text-center">Lessons appear as incidents are closed with corrective actions.</p>}
        </div>
      </div>

      {/* Footer — data sources */}
      <div className={`${card} p-3 flex flex-wrap items-center gap-x-4 gap-y-1`}>
        <span className="text-[11px] font-semibold text-gray-500">Data Sources:</span>
        {DATA_SOURCES.map((s, i) => <span key={i} className="text-[11px] text-gray-400">◇ {s}</span>)}
      </div>
    </div>
  );
}
