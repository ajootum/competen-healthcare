import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadPatientOps, fmtTime, titleCase, ewsColor, STATE_TONE } from "@/lib/operations/patient-ops";

export const dynamic = "force-dynamic";

// Clinical Safety (SSW-005 Patient Operations §Clinical Safety) — the central
// safety command centre. Every figure is derived once in loadPatientOps from
// live op_* data (alerts, escalations, observations, PEWS/EWS scores) and sliced
// here. The AI prioritises the alert queue by severity only; it does not make
// clinical decisions. No safety signal is fabricated.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200 p-5";
const SAFETY = "/supervisor/operations?section=safety";

const SEV_TONE: Record<string, string> = {
  critical: "bg-red-100 text-red-700", emergency: "bg-red-100 text-red-700",
  high: "bg-orange-100 text-orange-700", urgent: "bg-orange-100 text-orange-700",
  moderate: "bg-amber-100 text-amber-700", medium: "bg-amber-100 text-amber-700",
  low: "bg-yellow-100 text-yellow-700", routine: "bg-gray-100 text-gray-500", informational: "bg-gray-100 text-gray-500",
};
const sevTone = (s: string) => SEV_TONE[s] ?? "bg-gray-100 text-gray-600";

// Inline PEWS sparkline (~60x18) — no chart library, stroke follows text colour.
function Sparkline({ trend, colorClass }: { trend: { v: number }[]; colorClass: string }) {
  const w = 60, h = 18;
  if (!trend || trend.length === 0) return <span className="text-[10px] text-gray-300">no trend</span>;
  const vals = trend.map(t => t.v);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const step = vals.length > 1 ? w / (vals.length - 1) : 0;
  const xy = (v: number, i: number) => {
    const x = vals.length > 1 ? i * step : w / 2;
    const y = h - 1 - ((v - min) / range) * (h - 2);
    return [x, y] as const;
  };
  const pts = vals.map((v, i) => xy(v, i).map(n => n.toFixed(1)).join(",")).join(" ");
  const [lx, ly] = xy(vals[vals.length - 1], vals.length - 1);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={colorClass} aria-hidden="true">
      {vals.length > 1
        ? <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        : null}
      <circle cx={lx} cy={ly} r="1.9" fill="currentColor" />
    </svg>
  );
}

// Compliance progress bar.
function Bar({ pct, tone }: { pct: number | null; tone: string }) {
  return (
    <div className="h-2 bg-gray-100 rounded-full overflow-hidden mt-2">
      {pct != null && <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />}
    </div>
  );
}

export default async function ClinicalSafety() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["assessor", "hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const po = await loadPatientOps(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));
  if (!po.ready) return (
    <div className="space-y-4"><h1 className="text-2xl font-bold text-gray-900">Clinical Safety</h1>
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Coming online</p><p className="text-sm text-amber-800 mt-2">The Clinical Operations Engine tables aren&apos;t provisioned yet.</p></div></div>
  );

  const { safetyBanner: sb, alertQueue, deteriorating, compliance, summary } = po;

  const kpis = [
    { label: "Active alerts", n: sb.incidents, tone: sb.incidents ? "text-red-600" : "text-gray-400" },
    { label: "PEWS escalations", n: sb.pewsAlerts, tone: sb.pewsAlerts ? "text-orange-600" : "text-gray-400" },
    { label: "Overdue obs", n: sb.overdueObs, tone: sb.overdueObs ? "text-amber-600" : "text-gray-400" },
    { label: "High-risk", n: summary.highRisk, tone: summary.highRisk ? "text-orange-600" : "text-gray-400" },
    { label: "Rapid response", n: sb.rapidResponse, tone: sb.rapidResponse ? "text-red-600" : "text-gray-400" },
    { label: "Falls", n: sb.falls, tone: sb.falls ? "text-amber-600" : "text-gray-400" },
    { label: "Pressure injury", n: sb.pressure, tone: sb.pressure ? "text-amber-600" : "text-gray-400" },
    { label: "Medication", n: sb.medication, tone: sb.medication ? "text-amber-600" : "text-gray-400" },
    { label: "Isolation", n: sb.isolation, tone: sb.isolation ? "text-sky-600" : "text-gray-400" },
  ];

  const actions = ["Acknowledge", "Escalate", "Assign Reviewer", "Record Intervention", "Close Alert", "Open Incident"];

  return (
    <div className="space-y-5">
      {/* A · Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Clinical Safety</h1>
        <p className="text-sm text-gray-500 mt-1">Monitor safety alerts &amp; risks · central safety command centre</p>
      </div>

      {/* B · Safety command banner */}
      <div className="grid grid-cols-3 sm:grid-cols-3 lg:grid-cols-9 gap-3">
        {kpis.map(k => (
          <div key={k.label} className={card + " py-4 text-center"}>
            <p className={`text-2xl font-bold tabular-nums ${k.tone}`}>{k.n}</p>
            <p className="text-[10px] text-gray-500 mt-1 leading-tight">{k.label}</p>
          </div>
        ))}
      </div>

      {/* C · Active safety alert queue */}
      <div className={card}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900">Active Safety Alerts <span className="text-gray-400 font-normal">({alertQueue.length})</span></h3>
          <Link href={SAFETY} className="text-[11px] font-medium text-teal-700 hover:underline">Open safety console →</Link>
        </div>
        {alertQueue.length === 0 ? (
          <p className="text-sm text-gray-400">No active safety alerts.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                  <th className="py-2 pr-3 font-medium">Patient</th>
                  <th className="py-2 pr-3 font-medium">Type</th>
                  <th className="py-2 pr-3 font-medium">Severity</th>
                  <th className="py-2 pr-3 font-medium">Time</th>
                  <th className="py-2 pr-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {alertQueue.map((a: any, i: number) => (
                  <tr key={i} className="border-b border-gray-50 last:border-0">
                    <td className="py-2 pr-3 text-gray-800">{a.patient}</td>
                    <td className="py-2 pr-3 text-gray-600">{a.type}</td>
                    <td className="py-2 pr-3"><span className={`text-[10px] px-1.5 py-0.5 rounded ${sevTone(a.severity)}`}>{titleCase(String(a.severity ?? "—"))}</span></td>
                    <td className="py-2 pr-3 text-gray-500 tabular-nums">{fmtTime(a.at)}</td>
                    <td className="py-2 pr-3 text-right"><Link href={SAFETY} className="text-[11px] font-medium text-teal-700 hover:underline">{a.action} →</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* D · Deterioration tracker + E · Compliance */}
      <div className="grid lg:grid-cols-3 gap-4">
        <div className={card + " lg:col-span-2"}>
          <h3 className="font-semibold text-gray-900 mb-3">Deterioration Tracker <span className="text-gray-400 font-normal">(PEWS ≥ 5 · {deteriorating.length})</span></h3>
          {deteriorating.length === 0 ? (
            <p className="text-sm text-gray-400">No deteriorating patients — all monitored PEWS scores are below 5.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                    <th className="py-2 pr-3 font-medium">Patient</th>
                    <th className="py-2 pr-3 font-medium">State</th>
                    <th className="py-2 pr-3 font-medium text-center">PEWS</th>
                    <th className="py-2 pr-3 font-medium">Trend</th>
                    <th className="py-2 pr-3 font-medium">Next review</th>
                    <th className="py-2 pr-3 font-medium text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {deteriorating.map((p: any) => {
                    const inProgress = p.escalations.length > 0;
                    return (
                      <tr key={p.id} className="border-b border-gray-50 last:border-0">
                        <td className="py-2 pr-3 text-gray-800">{p.bed ? <span className="text-gray-500">{p.bed} · </span> : null}{p.label}</td>
                        <td className="py-2 pr-3"><span className={`text-[10px] px-1.5 py-0.5 rounded ${STATE_TONE[p.state] ?? "bg-gray-100 text-gray-600"}`}>{p.state}</span></td>
                        <td className={`py-2 pr-3 text-center font-bold tabular-nums ${ewsColor(p.pews)}`}>{p.pews ?? "—"}</td>
                        <td className="py-2 pr-3"><Sparkline trend={p.pewsTrend} colorClass={ewsColor(p.pews)} /></td>
                        <td className="py-2 pr-3 text-gray-500 tabular-nums">{fmtTime(p.nextReview)}</td>
                        <td className="py-2 pr-3 text-right">
                          <Link href={SAFETY} className={`text-[11px] font-medium hover:underline ${inProgress ? "text-amber-700" : "text-teal-700"}`}>
                            {inProgress ? "In Progress" : "Not escalated"} →
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* E · Safety compliance */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Safety Compliance</h3>
          <div className="space-y-4">
            <div>
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-gray-600">Observation compliance</span>
                <span className="text-lg font-bold tabular-nums text-gray-900">{compliance.observation == null ? "—" : `${compliance.observation}%`}</span>
              </div>
              <Bar pct={compliance.observation} tone="bg-teal-500" />
            </div>
            <div>
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-gray-600">Competency-validated care</span>
                <span className="text-lg font-bold tabular-nums text-gray-900">{compliance.validated == null ? "—" : `${compliance.validated}%`}</span>
              </div>
              <Bar pct={compliance.validated} tone="bg-indigo-500" />
            </div>
            <div className="flex items-center justify-between pt-3 border-t border-gray-100">
              <span className="text-sm text-gray-600">Isolation patients</span>
              <span className="text-lg font-bold tabular-nums text-sky-600">{compliance.isolationPatients}</span>
            </div>
          </div>
        </div>
      </div>

      {/* F · Actions bar */}
      <div className={card}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold text-gray-400 uppercase mr-1">Safety actions</span>
          {actions.map(a => (
            <Link key={a} href={SAFETY} className="text-xs font-medium text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-100 rounded-lg px-3 py-1.5 transition-colors">{a}</Link>
          ))}
        </div>
        <p className="text-[11px] text-gray-400 mt-3">AI prioritises the alert queue by severity only — it does not make clinical decisions. Every action is recorded in the operational safety register.</p>
      </div>
    </div>
  );
}
