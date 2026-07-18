"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// Competency Passport Centre (spec): validation queue with status tabs, live
// KPI strip, per-nurse drill-down (timeline + CPU summary) and real actions —
// request evidence (notifies the learner), schedule reassessment, assign
// learning, export. Rule-derived insights; per-score approval stays in the
// educator workflow (passports update automatically once validated).

export type PassportRow = {
  id: string; name: string; department: string; avatarUrl: string | null; joined: string;
  status: "Flagged" | "Reassessment Due" | "Awaiting Validation" | "Evidence Incomplete" | "Expiring Soon" | "Healthy" | "No Passport Yet";
  reason: string; priority: "high" | "medium" | "low";
  health: number | null; competent: number; total: number;
  awaiting: number; expired: number; expSoon: number; evidence: number;
  due: string | null;
};

export type CentreKpis = {
  pending: number; awaitingEvidence: number; expiring: number;
  recentlyApproved: number; highRisk: number; avgReviewDays: number | null; health: number | null;
};

export type TimelineEvent = { at: string; label: string; chip: string; good: boolean };
export type CpuSummary = { name: string; pct: number; total: number; due: string | null };

const STATUS_CLS: Record<PassportRow["status"], string> = {
  "Flagged": "bg-red-50 text-red-600",
  "Reassessment Due": "bg-purple-50 text-purple-700",
  "Awaiting Validation": "bg-amber-50 text-amber-700",
  "Evidence Incomplete": "bg-rose-50 text-rose-600",
  "Expiring Soon": "bg-orange-50 text-orange-600",
  "Healthy": "bg-green-50 text-green-700",
  "No Passport Yet": "bg-gray-100 text-gray-500",
};
const PRIO_UI = {
  high:   { label: "High",   cls: "bg-red-50 text-red-600" },
  medium: { label: "Medium", cls: "bg-amber-50 text-amber-700" },
  low:    { label: "Low",    cls: "bg-gray-100 text-gray-500" },
};

const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("") || "?";

export default function PassportCentre({ rows, kpis, selectedId, timeline, cpus }: {
  rows: PassportRow[]; kpis: CentreKpis; selectedId: string | null;
  timeline: TimelineEvent[]; cpus: CpuSummary[];
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("All");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const sel = selectedId ? rows.find(r => r.id === selectedId) ?? null : null;

  const TABS = [
    { label: "All", test: () => true },
    { label: "Pending Validation", test: (r: PassportRow) => r.awaiting > 0 },
    { label: "Awaiting Evidence", test: (r: PassportRow) => r.evidence > 0 },
    { label: "Reassessment Due", test: (r: PassportRow) => r.expired > 0 },
    { label: "Expiring Soon", test: (r: PassportRow) => r.expSoon > 0 },
    { label: "Flagged", test: (r: PassportRow) => r.status === "Flagged" },
  ];
  const activeTab = TABS.find(t => t.label === tab) ?? TABS[0];
  const filtered = rows.filter(r => {
    if (!activeTab.test(r)) return false;
    const t = q.trim().toLowerCase();
    if (t && ![r.name, r.department, r.status, r.reason].some(s => s.toLowerCase().includes(t))) return false;
    return true;
  });

  async function requestEvidence(nurseId: string, nurseName: string) {
    setBusy(true); setNote(null);
    const res = await fetch("/api/passports/request-evidence", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nurse_id: nurseId }),
    });
    setNote(res.ok
      ? `Evidence request sent to ${nurseName.split(" ")[0]} — they've been notified.`
      : (await res.json().catch(() => ({}))).error ?? "Request failed");
    setBusy(false);
    router.refresh();
  }

  const KPI_TILES = [
    { icon: "📋", value: String(kpis.pending), label: "Reviews Pending", sub: "awaiting validation", tint: "bg-indigo-50" },
    { icon: "⏳", value: String(kpis.awaitingEvidence), label: "Awaiting Evidence", sub: "unverified entries", tint: "bg-amber-50" },
    { icon: "📅", value: String(kpis.expiring), label: "Expiring Soon", sub: "within 30 days", tint: "bg-orange-50" },
    { icon: "✅", value: String(kpis.recentlyApproved), label: "Recently Approved", sub: "validated this week", tint: "bg-green-50" },
    { icon: "🛑", value: String(kpis.highRisk), label: "High Risk Passports", sub: "require attention", tint: "bg-red-50" },
    { icon: "⏱️", value: kpis.avgReviewDays !== null ? `${kpis.avgReviewDays}d` : "—", label: "Avg. Review Time", sub: "decision → validated", tint: "bg-blue-50" },
    { icon: "🛡️", value: kpis.health !== null ? `${kpis.health}%` : "—", label: "Passport Health Score", sub: "organisation average", tint: "bg-teal-50" },
  ];

  const insights: string[] = [];
  if (kpis.highRisk > 0) insights.push(`${kpis.highRisk} passport${kpis.highRisk === 1 ? "" : "s"} carry critical gaps that may impact patient safety.`);
  if (kpis.expiring > 0) insights.push(`${kpis.expiring} competenc${kpis.expiring === 1 ? "y is" : "ies are"} expiring within 30 days.`);
  if (kpis.awaitingEvidence > 0) insights.push(`${kpis.awaitingEvidence} evidence item${kpis.awaitingEvidence === 1 ? "" : "s"} still need verification.`);
  if (kpis.pending > 0) insights.push(`${kpis.pending} passing decision${kpis.pending === 1 ? "" : "s"} await${kpis.pending === 1 ? "s" : ""} educator validation.`);

  const copilotPrompt = `I'm an assessor running the Competency Passport Centre. Live picture: ${kpis.pending} decisions pending validation, ${kpis.awaitingEvidence} evidence items unverified, ${kpis.expiring} competencies expiring within 30 days, ${kpis.highRisk} high-risk passports, organisation passport health ${kpis.health ?? "n/a"}%. Queue: ${rows.map(r => `${r.name}: ${r.status}`).join("; ")}. Advise me on the priority order and what to do for each clinician.`;

  const donut = [
    { label: "Pending Validation", n: rows.filter(r => r.awaiting > 0).length, color: "#6366f1" },
    { label: "Awaiting Evidence", n: rows.filter(r => r.evidence > 0).length, color: "#f59e0b" },
    { label: "Reassessment Due", n: rows.filter(r => r.expired > 0).length, color: "#a855f7" },
    { label: "Expiring Soon", n: rows.filter(r => r.expSoon > 0).length, color: "#fb923c" },
  ].filter(d => d.n > 0);
  const donutTotal = donut.reduce((s, d) => s + d.n, 0);
  const C = 2 * Math.PI * 40;
  const arcs = donut.reduce<((typeof donut)[number] & { offset: number; pct: number })[]>((list, d) => {
    const pct = donutTotal ? (d.n / donutTotal) * 100 : 0;
    const prev = list[list.length - 1];
    return [...list, { ...d, pct, offset: prev ? prev.offset + prev.pct : 0 }];
  }, []);

  return (
    <div className="max-w-[1500px]">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">🛂 Competency Passport Centre</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            Validate, approve and maintain the integrity of clinicians&apos; lifelong competency passports.
          </p>
        </div>
        <a href="/api/reports/passports"
          className="text-xs font-semibold text-gray-600 border border-gray-200 bg-white hover:border-indigo-300 px-3 py-2 rounded-lg transition-colors">
          ⬇ Export Report
        </a>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3 mb-5">
        {KPI_TILES.map(k => (
          <div key={k.label} className="bg-white border border-gray-100 rounded-2xl p-3.5">
            <span className={`w-8 h-8 rounded-xl ${k.tint} flex items-center justify-center text-base`}>{k.icon}</span>
            <p className="text-xl font-extrabold text-gray-900 mt-1.5 leading-none">{k.value}</p>
            <p className="text-[10px] font-semibold text-gray-700 mt-1 leading-tight">{k.label}</p>
            <p className="text-[9px] text-gray-400">{k.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px] gap-5 items-start">
        <div className="min-w-0 flex flex-col gap-5">
          {/* Validation queue */}
          <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
            <div className="px-4 pt-3 pb-2 border-b border-gray-100">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <h2 className="text-sm font-bold text-gray-900 flex-1">Passport Validation Queue</h2>
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search passports, clinicians…"
                  className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs w-52 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
              </div>
              <div className="flex flex-wrap gap-1">
                {TABS.map(t => {
                  const n = rows.filter(r => t.test(r)).length;
                  return (
                    <button key={t.label} onClick={() => setTab(t.label)}
                      className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                        tab === t.label ? "bg-indigo-600 text-white" : "text-gray-500 hover:bg-gray-50"
                      }`}>
                      {t.label} ({n})
                    </button>
                  );
                })}
              </div>
            </div>
            {filtered.length === 0 ? (
              <p className="px-5 py-10 text-center text-xs text-gray-400">
                {rows.length === 0 ? "No clinicians in your hospital yet." : "Nothing matches this view."}
              </p>
            ) : (
              <div className="divide-y divide-gray-50">
                {filtered.map(r => (
                  <div key={r.id}
                    className={`px-4 py-3 flex items-center gap-3 cursor-pointer transition-colors ${selectedId === r.id ? "bg-indigo-50/50" : "hover:bg-gray-50/60"}`}
                    onClick={() => router.push(`/assessor/passports?n=${r.id}`, { scroll: false })}>
                    {r.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- avatar from storage
                      <img src={r.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
                    ) : (
                      <span className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-bold flex items-center justify-center shrink-0">
                        {initials(r.name)}
                      </span>
                    )}
                    <div className="min-w-0 w-40 shrink-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{r.name}</p>
                      <p className="text-[10px] text-gray-400 truncate">Staff Nurse · {r.department}</p>
                    </div>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${STATUS_CLS[r.status]}`}>{r.status}</span>
                    <p className="text-[11px] text-gray-500 flex-1 min-w-0 truncate">{r.reason}</p>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${PRIO_UI[r.priority].cls}`}>{PRIO_UI[r.priority].label}</span>
                    {r.due && (
                      <span className="text-[10px] text-gray-400 shrink-0" suppressHydrationWarning>
                        {new Date(r.due).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                      </span>
                    )}
                    <span className={`text-[11px] font-semibold px-3 py-1.5 rounded-lg shrink-0 ${
                      selectedId === r.id ? "bg-indigo-600 text-white" : "text-indigo-700 border border-indigo-200"
                    }`}>Review</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Selected passport detail */}
          {sel && (
            <div className="bg-white border border-gray-100 rounded-2xl p-5">
              <h2 className="text-sm font-bold text-gray-900 mb-4">Recent Passport Activity</h2>
              <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)_minmax(0,1fr)] gap-5">
                {/* Profile */}
                <div>
                  <div className="flex items-center gap-3 mb-3">
                    {sel.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- avatar from storage
                      <img src={sel.avatarUrl} alt="" className="w-12 h-12 rounded-full object-cover" />
                    ) : (
                      <span className="w-12 h-12 rounded-full bg-indigo-100 text-indigo-700 text-sm font-bold flex items-center justify-center">
                        {initials(sel.name)}
                      </span>
                    )}
                    <div>
                      <p className="text-sm font-bold text-gray-900">{sel.name}</p>
                      <p className="text-[10px] text-gray-400">Staff Nurse · {sel.department}</p>
                      <p className="text-[9px] text-gray-300" suppressHydrationWarning>
                        Since {new Date(sel.joined).toLocaleDateString(undefined, { month: "short", year: "numeric" })}
                      </p>
                    </div>
                  </div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Passport Health Score</p>
                  {sel.health !== null ? (
                    <>
                      <p className={`text-3xl font-extrabold ${sel.health >= 80 ? "text-green-600" : sel.health >= 50 ? "text-amber-600" : "text-red-500"}`}>{sel.health}%</p>
                      <p className="text-[10px] text-gray-400">{sel.competent} of {sel.total} decided competencies validated</p>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden mt-1.5">
                        <div className={`h-full rounded-full ${sel.health >= 80 ? "bg-green-500" : sel.health >= 50 ? "bg-amber-400" : "bg-red-400"}`}
                          style={{ width: `${sel.health}%` }} />
                      </div>
                    </>
                  ) : <p className="text-[10px] text-gray-400">No decisions recorded yet.</p>}
                  <div className="flex flex-col gap-1.5 mt-4">
                    <button onClick={() => requestEvidence(sel.id, sel.name)} disabled={busy}
                      className="text-[11px] font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white py-2 rounded-lg transition-colors">
                      📎 Request Evidence
                    </button>
                    <div className="grid grid-cols-2 gap-1.5">
                      <Link href="/assessor/calendar" className="text-center text-[10px] font-semibold text-gray-600 border border-gray-200 hover:border-indigo-300 py-1.5 rounded-lg transition-colors">📅 Reassess</Link>
                      <Link href={`/assessor/assess?nurse=${sel.id}`} className="text-center text-[10px] font-semibold text-gray-600 border border-gray-200 hover:border-indigo-300 py-1.5 rounded-lg transition-colors">📝 Assess</Link>
                    </div>
                    {note && <p className="text-[10px] text-teal-700 bg-teal-50 border border-teal-100 rounded-lg px-2 py-1.5">{note}</p>}
                  </div>
                </div>

                {/* Timeline */}
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Timeline</p>
                  {timeline.length === 0 ? (
                    <p className="text-[10px] text-gray-400">No recorded activity yet.</p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {timeline.map((t, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${t.good ? "bg-green-400" : "bg-amber-400"}`} />
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] text-gray-700 leading-snug truncate">{t.label}</p>
                            <p className="text-[9px] text-gray-300" suppressHydrationWarning>
                              {new Date(t.at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                            </p>
                          </div>
                          <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded shrink-0 capitalize ${t.good ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>{t.chip}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* CPU summary */}
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">CPU Summary</p>
                  {cpus.length === 0 ? (
                    <p className="text-[10px] text-gray-400">No CPU decisions recorded yet.</p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {cpus.map(c => (
                        <div key={c.name} className="flex items-center gap-2">
                          <div className="relative w-8 shrink-0">
                            <svg viewBox="0 0 100 100" className="w-full -rotate-90">
                              <circle cx="50" cy="50" r="40" fill="none" stroke="#f3f4f6" strokeWidth="16" />
                              <circle cx="50" cy="50" r="40" fill="none" stroke={c.pct >= 80 ? "#10b981" : c.pct >= 50 ? "#f59e0b" : "#ef4444"} strokeWidth="16"
                                strokeDasharray={`${(c.pct / 100) * 2 * Math.PI * 40} ${2 * Math.PI * 40}`} />
                            </svg>
                            <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-gray-700">{c.pct}%</span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-semibold text-gray-800 truncate">{c.name}</p>
                            <p className="text-[9px] text-gray-400" suppressHydrationWarning>
                              {c.total} competenc{c.total === 1 ? "y" : "ies"}{c.due ? ` · due ${new Date(c.due).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}` : ""}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <p className="text-[10px] text-gray-300">
            Per-competency validation happens in the educator workflow — passports update automatically once
            assessments are validated. Bulk approve/reject and clinical-privilege registers aren&apos;t available yet.
          </p>
        </div>

        {/* Right rail */}
        <div className="flex flex-col gap-4">
          {/* Insights — rule-derived */}
          <div className="bg-violet-50 border border-violet-100 rounded-2xl p-4">
            <h2 className="text-xs font-bold text-violet-900 mb-0.5">✨ Passport Insights</h2>
            <p className="text-[9px] text-violet-900/50 mb-2">Rule-derived from live passports</p>
            <div className="flex flex-col gap-1.5 mb-2.5">
              {insights.length === 0
                ? <p className="text-[10px] text-violet-900/60">All passports healthy — nothing to flag.</p>
                : insights.map(t => <p key={t} className="text-[10px] text-violet-900/80 leading-snug">• {t}</p>)}
            </div>
            <Link href={`/dashboard/copilot?scenario=${encodeURIComponent(copilotPrompt)}`}
              className="block text-center text-xs font-semibold text-violet-700 border border-violet-200 bg-white hover:bg-violet-100 py-2 rounded-lg transition-colors">
              View all AI insights →
            </Link>
          </div>

          {/* Quick actions — real destinations */}
          <div className="bg-white border border-gray-100 rounded-2xl p-4">
            <h2 className="text-xs font-bold text-gray-800 mb-2.5">Quick Actions</h2>
            <div className="grid grid-cols-2 gap-2">
              {[
                { icon: "🖊️", label: "Validate Evidence", href: "/assessor/logbook" },
                { icon: "📅", label: "Schedule Reassessment", href: "/assessor/calendar" },
                { icon: "🎯", label: "Assign Learning", href: "/assessor/remediation" },
                { icon: "📝", label: "Conduct Assessment", href: "/assessor/assess" },
              ].map(a => (
                <Link key={a.href} href={a.href}
                  className="border border-gray-100 hover:border-indigo-300 rounded-xl p-2.5 text-center transition-colors group">
                  <p className="text-base">{a.icon}</p>
                  <p className="text-[9px] font-semibold text-gray-700 group-hover:text-indigo-700 leading-tight mt-0.5">{a.label}</p>
                </Link>
              ))}
            </div>
          </div>

          {/* Workload donut */}
          <div className="bg-white border border-gray-100 rounded-2xl p-4">
            <h2 className="text-xs font-bold text-gray-800 mb-3">My Workload</h2>
            {donutTotal === 0 ? (
              <p className="text-[10px] text-gray-400">Nothing outstanding across passports.</p>
            ) : (
              <>
                <div className="relative w-24 mx-auto">
                  <svg viewBox="0 0 100 100" className="w-full -rotate-90">
                    <circle cx="50" cy="50" r="40" fill="none" stroke="#f3f4f6" strokeWidth="14" />
                    {arcs.map(a => (
                      <circle key={a.label} cx="50" cy="50" r="40" fill="none" stroke={a.color} strokeWidth="14"
                        strokeDasharray={`${(a.pct / 100) * C} ${C}`} strokeDashoffset={-(a.offset / 100) * C} />
                    ))}
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <p className="text-lg font-extrabold text-gray-900 leading-none">{donutTotal}</p>
                    <p className="text-[8px] text-gray-400">items</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-col gap-1">
                  {arcs.map(d => (
                    <div key={d.label} className="flex items-center gap-2 text-[10px]">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: d.color }} />
                      <span className="text-gray-500 flex-1">{d.label}</span>
                      <span className="font-semibold text-gray-700">{d.n}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
