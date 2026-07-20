import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadPatientOps, fmtTime, ewsColor, STATE_TONE } from "@/lib/operations/patient-ops";

export const dynamic = "force-dynamic";

// Patient List (SSW-005 §1) — the real-time operational register of every
// patient on the unit. Every figure, badge and trend is computed once in the
// shared Patient Operations model (loadPatientOps) from live op_* data and
// sliced here. Fields the operational schema does not hold (patient age /
// diagnosis — those live in the Patient Care Engine / clinical record) are NOT
// fabricated; an honest note points to where they live.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200 p-5";

// Canonical clinical-state ordering for the filter chip row.
const STATE_ORDER = [
  "Critical", "High Risk", "Review Required", "Observation", "Stable",
  "Theatre", "Transfer Pending", "Discharge Ready", "Expected",
];

const firstName = (n: string | null) => (n ? n.split(" ").filter(Boolean)[0] ?? n : null);

// Inline PEWS sparkline (~60x18) built from the patient's ordered trend. No
// chart library — a simple bar sprite tinted by the latest value.
function Sparkline({ trend, value }: { trend: { v: number }[]; value: number | null }) {
  if (!trend || trend.length < 2) return null;
  const vals = trend.map(t => t.v);
  const max = Math.max(...vals, 6);
  const w = 60, h = 18, n = vals.length, bw = w / n;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={ewsColor(value)} aria-hidden>
      {vals.map((v, i) => {
        const bh = Math.max(1.5, (v / max) * (h - 2));
        return <rect key={i} x={i * bw + 0.75} y={h - bh} width={Math.max(1.5, bw - 1.5)} height={bh} rx={0.5} fill="currentColor" opacity={i === n - 1 ? 1 : 0.4} />;
      })}
    </svg>
  );
}

export default async function PatientList() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["assessor", "hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const po = await loadPatientOps(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));
  if (!po.ready) return (
    <div className="space-y-4"><h1 className="text-2xl font-bold text-gray-900">Patient List</h1>
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Coming online</p><p className="text-sm text-amber-800 mt-2">The Clinical Operations Engine tables aren&apos;t provisioned yet.</p></div></div>
  );

  const { active, summary, copilot } = po;
  const stable = active.filter(p => p.state === "Stable").length;

  // Summary KPI banner.
  const kpis: { label: string; n: number; tone: string }[] = [
    { label: "Total patients", n: summary.total, tone: "text-gray-900" },
    { label: "High risk", n: summary.highRisk, tone: summary.highRisk ? "text-red-600" : "text-gray-400" },
    { label: "Observation / review", n: summary.review, tone: summary.review ? "text-amber-600" : "text-gray-400" },
    { label: "Stable", n: stable, tone: "text-green-600" },
    { label: "Isolation", n: summary.isolation, tone: summary.isolation ? "text-fuchsia-600" : "text-gray-400" },
    { label: "Discharge ready", n: summary.dischargesExpected, tone: "text-teal-600" },
    { label: "Admissions expected", n: summary.admissionsExpected, tone: "text-sky-600" },
    { label: "Transfers pending", n: summary.transfersPending, tone: summary.transfersPending ? "text-sky-600" : "text-gray-400" },
    { label: "Theatre", n: summary.theatre, tone: summary.theatre ? "text-indigo-600" : "text-gray-400" },
    { label: "Unassigned", n: summary.unassigned, tone: summary.unassigned ? "text-red-600" : "text-gray-400" },
  ];

  // State filter chips — counts for each clinical state actually present.
  const stateCounts = new Map<string, number>();
  active.forEach(p => stateCounts.set(p.state, (stateCounts.get(p.state) ?? 0) + 1));
  const chips = STATE_ORDER.filter(s => stateCounts.has(s)).map(s => ({ state: s, n: stateCounts.get(s) ?? 0 }));

  // Action surfaces (rule 5 — every control is a real Link).
  const HREF = {
    assign: "/supervisor/operations?section=assignments",
    review: "/supervisor/clinical-safety",
    escalate: "/supervisor/operations?section=safety",
    transfer: "/supervisor/patient-flow",
    discharge: "/supervisor/patient-flow",
    flag: "/supervisor/clinical-safety",
  };
  const actionBar: { label: string; href: string; primary?: boolean }[] = [
    { label: "Assign Nurse", href: HREF.assign, primary: true },
    { label: "Request Review", href: HREF.review },
    { label: "Escalate Deterioration", href: HREF.escalate },
    { label: "Transfer Patient", href: HREF.transfer },
    { label: "Discharge Patient", href: HREF.discharge },
    { label: "Add Safety Flag", href: HREF.flag },
  ];

  return (
    <div className="space-y-5">
      {/* A) Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Patient List</h1>
        <p className="text-sm text-gray-500 mt-1">Real-time operational register of all patients</p>
      </div>

      {/* B) Summary banner */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {kpis.map(k => (
          <div key={k.label} className={card + " py-4"}>
            <p className={`text-3xl font-bold tabular-nums ${k.tone}`}>{k.n}</p>
            <p className="text-xs text-gray-500 mt-1 leading-tight">{k.label}</p>
          </div>
        ))}
      </div>

      {/* C) State filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs bg-gray-900 text-white rounded-full px-3 py-1 tabular-nums">All {active.length}</span>
        {chips.map(c => (
          <span key={c.state} className={`text-xs rounded-full px-3 py-1 tabular-nums ${STATE_TONE[c.state] ?? "bg-gray-100 text-gray-600"}`}>{c.state} {c.n}</span>
        ))}
        <span className="text-[11px] text-gray-400 ml-auto">Live view · shared Patient Operations model</span>
      </div>

      {/* D) Patient register table */}
      <div className={card + " p-0 overflow-hidden"}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                <th className="text-left font-medium px-4 py-2.5">Bed</th>
                <th className="text-left font-medium px-4 py-2.5">Patient</th>
                <th className="text-left font-medium px-4 py-2.5">Age</th>
                <th className="text-left font-medium px-4 py-2.5">Diagnosis</th>
                <th className="text-left font-medium px-4 py-2.5">Status</th>
                <th className="text-left font-medium px-4 py-2.5">PEWS</th>
                <th className="text-left font-medium px-4 py-2.5">Assigned nurse</th>
                <th className="text-left font-medium px-4 py-2.5">Last obs</th>
                <th className="text-left font-medium px-4 py-2.5">Next review</th>
                <th className="text-left font-medium px-4 py-2.5">Safety flags</th>
                <th className="text-right font-medium px-4 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {active.length === 0 && (
                <tr><td colSpan={11} className="px-4 py-8 text-center text-sm text-gray-400">No active patients on the register.</td></tr>
              )}
              {active.map(p => (
                <tr key={p.id} className="hover:bg-gray-50/60">
                  <td className="px-4 py-2.5 whitespace-nowrap text-gray-500 tabular-nums">{p.bed ?? "—"}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap font-medium text-gray-900">{p.label}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-gray-500 tabular-nums">{p.age != null ? `${p.age}y` : "—"}</td>
                  <td className="px-4 py-2.5 text-gray-600 max-w-[12rem] truncate" title={p.diagnosis ?? ""}>{p.diagnosis ?? "—"}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${STATE_TONE[p.state] ?? "bg-gray-100 text-gray-600"}`}>{p.state}</span>
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span className={`font-semibold tabular-nums ${ewsColor(p.pews)}`}>{p.pews ?? "—"}</span>
                      <Sparkline trend={p.pewsTrend} value={p.pews} />
                    </div>
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    {p.nurse ? <span className="text-gray-700">{firstName(p.nurse)}</span> : <span className="text-red-600 font-medium">Unassigned</span>}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-gray-500 tabular-nums">{fmtTime(p.lastObs)}</td>
                  <td className={`px-4 py-2.5 whitespace-nowrap tabular-nums ${p.overdueObs ? "text-red-600 font-medium" : "text-gray-500"}`}>{fmtTime(p.nextReview)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1 max-w-[16rem]">
                      {p.flags.length === 0 && <span className="text-[11px] text-gray-300">—</span>}
                      {p.flags.map((f, i) => (
                        <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 whitespace-nowrap">{f}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-right">
                    <div className="inline-flex items-center gap-2">
                      <Link href={HREF.assign} className="text-[11px] font-medium text-teal-700 hover:underline">Assign</Link>
                      <span className="text-gray-200">·</span>
                      <Link href={HREF.review} className="text-[11px] font-medium text-teal-700 hover:underline">Review</Link>
                      <span className="text-gray-200">·</span>
                      <Link href={HREF.escalate} className="text-[11px] font-medium text-teal-700 hover:underline">Escalate</Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2.5 border-t border-gray-100">
          <p className="text-[11px] text-gray-400">Age &amp; working diagnosis are operational-lite fields set at patient registration — shown as &ldquo;—&rdquo; until entered; the full clinical record lives in the Patient Care Engine.</p>
        </div>
      </div>

      {/* E) Bottom action bar */}
      <div className={card}>
        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-3">Register actions</p>
        <div className="flex flex-wrap gap-2">
          {actionBar.map(a => (
            <Link
              key={a.label}
              href={a.href}
              className={a.primary
                ? "text-sm rounded-lg bg-teal-600 text-white px-3.5 py-2 hover:bg-teal-700 transition-colors"
                : "text-sm rounded-lg border border-gray-200 text-gray-700 px-3.5 py-2 hover:border-teal-300 hover:text-teal-700 transition-colors"}
            >
              {a.label}
            </Link>
          ))}
        </div>
      </div>

      {/* F) Operational Copilot */}
      <div className={card}>
        <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-3">✨ Operational Copilot <span className="text-[10px] font-normal text-gray-400">rule-based, from live data</span></h3>
        <div className="grid sm:grid-cols-2 gap-2">
          {copilot.length === 0 && <p className="text-sm text-gray-400">No suggestions — the register is balanced and up to date.</p>}
          {copilot.map((c, i) => (
            <div key={i} className="flex items-center gap-2 text-sm rounded-lg border border-gray-100 px-3 py-2">
              <span className="text-gray-700 flex-1 truncate">{c.text}</span>
              <Link href={c.href} className="text-[11px] font-medium text-teal-700 shrink-0 hover:underline">{c.action} →</Link>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
