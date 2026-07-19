"use client";

import { useMemo, useState } from "react";
import type { PubResource, Bar, Activity, StatusKind, ApprovalKind } from "@/lib/publishing-tools";

// Publishing Tools workspace (client). Eight governance modules as tabs. The
// Publication Manager is a live table over the aggregated resources with search,
// type/status filters, pagination and a contextual right-hand panel. Modules
// that need a store we don't have yet (releases, scheduling, distribution) are
// honest scaffolds; Version Control, Approval Workflows, Archive & Lifecycle and
// Analytics surface the real derived data we do have.

const TABS = ["Publication Manager", "Release Management", "Version Control", "Approval Workflows", "Scheduling", "Distribution", "Archive & Lifecycle", "Analytics"] as const;
type Tab = typeof TABS[number];

const STATUS_CLS: Record<StatusKind, string> = {
  published: "bg-emerald-100 text-emerald-700", ready: "bg-teal-100 text-teal-700", draft: "bg-gray-100 text-gray-600",
  review: "bg-amber-100 text-amber-700", scheduled: "bg-blue-100 text-blue-700", archived: "bg-gray-100 text-gray-500", deprecated: "bg-rose-100 text-rose-700",
};
const APPROVAL_CLS: Record<ApprovalKind, string> = { approved: "text-emerald-600", review: "text-amber-600", none: "text-gray-400", archived: "text-gray-300" };
const CHECK_ICON = { done: "✓", warn: "!", pending: "○" } as const;
const CHECK_CLS = { done: "text-emerald-500", warn: "text-amber-500", pending: "text-gray-300" } as const;
const GOVERNANCE = ["Educator", "Senior Educator", "Curriculum Committee", "Quality Office", "Education Director", "Published"];

const relTime = (iso: string | null): string => {
  if (!iso) return "";
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
};
const fmtDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";

function Scaffold({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-8 text-center">
      <p className="text-4xl mb-2">{icon}</p>
      <p className="text-sm font-bold text-gray-700">{title}</p>
      <p className="text-[12px] text-gray-500 max-w-lg mx-auto mt-1">{body}</p>
      <p className="text-[10px] text-gray-400 mt-3">This module activates once its backing store is connected — no placeholder data is shown.</p>
    </div>
  );
}

function BarList({ bars, tint }: { bars: Bar[]; tint: (b: Bar) => string }) {
  const max = Math.max(1, ...bars.map(b => b.count));
  return (
    <div className="flex flex-col gap-2">
      {bars.map(b => (
        <div key={b.label} className="flex items-center gap-3">
          <span className="w-32 text-[12px] text-gray-600 truncate shrink-0">{b.label}</span>
          <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden"><div className={`h-full rounded-full ${tint(b)}`} style={{ width: `${(b.count / max) * 100}%` }} /></div>
          <span className="w-8 text-right text-[12px] font-semibold text-gray-700">{b.count}</span>
        </div>
      ))}
    </div>
  );
}

export default function Workspace({ resources, typeCounts, statusCounts, activity, aiConfigured }: {
  resources: PubResource[]; typeCounts: Bar[]; statusCounts: Bar[]; activity: Activity[]; aiConfigured: boolean;
}) {
  const [tab, setTab] = useState<Tab>("Publication Manager");
  const [q, setQ] = useState("");
  const [typeF, setTypeF] = useState("all");
  const [statusF, setStatusF] = useState("all");
  const [page, setPage] = useState(0);
  const [selId, setSelId] = useState<string | null>(resources[0]?.id ?? null);
  const PER = 10;

  const types = useMemo(() => [...new Set(resources.map(r => r.type))], [resources]);
  const statuses = useMemo(() => [...new Set(resources.map(r => r.status))], [resources]);

  const filtered = useMemo(() => resources.filter(r =>
    (typeF === "all" || r.type === typeF) &&
    (statusF === "all" || r.status === statusF) &&
    (!q || r.title.toLowerCase().includes(q.toLowerCase()) || r.owner.toLowerCase().includes(q.toLowerCase()))
  ), [resources, typeF, statusF, q]);

  const pages = Math.max(1, Math.ceil(filtered.length / PER));
  const pageClamped = Math.min(page, pages - 1);
  const shown = filtered.slice(pageClamped * PER, pageClamped * PER + PER);
  const sel = resources.find(r => r.id === selId) ?? null;
  const versioned = resources.filter(r => r.version);
  const archived = resources.filter(r => r.statusKind === "archived" || r.statusKind === "deprecated");

  const resetPage = () => setPage(0);

  return (
    <div>
      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-gray-200 mb-4">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`text-[13px] font-semibold px-3.5 py-2.5 whitespace-nowrap border-b-2 -mb-px transition-colors ${tab === t ? "border-violet-600 text-violet-700" : "border-transparent text-gray-500 hover:text-gray-800"}`}>
            {t}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-5">
        {/* Main */}
        <div className="min-w-0">
          {tab === "Publication Manager" && (
            <div className="rounded-2xl bg-white border border-gray-200 shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 p-3 flex-wrap border-b border-gray-100">
                <div className="relative flex-1 min-w-[180px]">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
                  <input value={q} onChange={e => { setQ(e.target.value); resetPage(); }} placeholder="Search resources or owners…"
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-[13px] focus:outline-none focus:border-violet-400" />
                </div>
                <select value={typeF} onChange={e => { setTypeF(e.target.value); resetPage(); }} className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-gray-700">
                  <option value="all">All Types</option>
                  {types.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <select value={statusF} onChange={e => { setStatusF(e.target.value); resetPage(); }} className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-gray-700">
                  <option value="all">All Statuses</option>
                  {statuses.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-[10px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-100">
                      <th className="px-4 py-2.5">Resource</th><th className="px-2 py-2.5">Type</th><th className="px-2 py-2.5">Status</th>
                      <th className="px-2 py-2.5">Version</th><th className="px-2 py-2.5">Approval</th><th className="px-2 py-2.5">Owner</th>
                      <th className="px-2 py-2.5">Created</th><th className="px-2 py-2.5">Deps</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map(r => (
                      <tr key={r.id} onClick={() => setSelId(r.id)}
                        className={`text-[12px] border-b border-gray-50 cursor-pointer transition-colors ${selId === r.id ? "bg-violet-50/60" : "hover:bg-gray-50"}`}>
                        <td className="px-4 py-2.5"><div className="flex items-center gap-2"><span className="text-base">{r.icon}</span><span className="font-medium text-gray-800 truncate max-w-[240px]">{r.title}</span></div></td>
                        <td className="px-2 py-2.5 text-gray-500">{r.type}</td>
                        <td className="px-2 py-2.5"><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${STATUS_CLS[r.statusKind]}`}>{r.status}</span></td>
                        <td className="px-2 py-2.5 text-gray-500">{r.version ?? "—"}</td>
                        <td className={`px-2 py-2.5 font-medium ${APPROVAL_CLS[r.approvalKind]}`}>{r.approval}</td>
                        <td className="px-2 py-2.5 text-gray-600 truncate max-w-[120px]">{r.owner}</td>
                        <td className="px-2 py-2.5 text-gray-400 whitespace-nowrap">{fmtDate(r.modified)}</td>
                        <td className="px-2 py-2.5 text-gray-300">{r.deps ?? "—"}</td>
                      </tr>
                    ))}
                    {shown.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-[12px] text-gray-400">No resources match your filters.</td></tr>}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between p-3 text-[12px] text-gray-500 border-t border-gray-100">
                <span>Showing {shown.length ? pageClamped * PER + 1 : 0}–{pageClamped * PER + shown.length} of {filtered.length}</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setPage(Math.max(0, pageClamped - 1))} disabled={pageClamped === 0} className="px-2 py-1 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50">‹</button>
                  <span className="px-2">Page {pageClamped + 1} / {pages}</span>
                  <button onClick={() => setPage(Math.min(pages - 1, pageClamped + 1))} disabled={pageClamped >= pages - 1} className="px-2 py-1 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50">›</button>
                </div>
              </div>
            </div>
          )}

          {tab === "Version Control" && (
            <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-5">
              <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-1">Versioned Resources</p>
              <p className="text-[11px] text-gray-400 mb-3">Current versions from the live records. Version comparison, branching and restore need the version-history store — {versioned.length} versioned asset{versioned.length === 1 ? "" : "s"} shown.</p>
              {versioned.length === 0 ? <p className="text-[12px] text-gray-400">No versioned resources yet.</p> : (
                <div className="flex flex-col divide-y divide-gray-100">
                  {versioned.map(r => (
                    <div key={r.id} className="flex items-center gap-3 py-2.5 cursor-pointer hover:bg-gray-50 -mx-2 px-2 rounded" onClick={() => setSelId(r.id)}>
                      <span className="text-base">{r.icon}</span>
                      <span className="flex-1 min-w-0 text-[13px] text-gray-800 truncate">{r.title}</span>
                      <span className="text-[11px] text-gray-400">{r.type}</span>
                      <span className="text-[11px] font-semibold text-violet-700 bg-violet-50 rounded px-1.5 py-0.5">v{r.version}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "Approval Workflows" && (
            <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-5">
              <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-3">Governance Workflow</p>
              <div className="flex items-center gap-1.5 overflow-x-auto pb-2 mb-4">
                {GOVERNANCE.map((step, i) => (
                  <div key={step} className="flex items-center gap-1.5 shrink-0">
                    <span className={`text-[11px] font-semibold rounded-full px-3 py-1.5 ${i === GOVERNANCE.length - 1 ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-gray-50 text-gray-600 border border-gray-200"}`}>{step}</span>
                    {i < GOVERNANCE.length - 1 && <span className="text-gray-300 text-xs">→</span>}
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 mb-2">The configurable multi-step approval store isn&apos;t connected yet — the chain above is the default governance sequence. Recent governance-related activity from the audit log:</p>
              {activity.length === 0 ? <p className="text-[12px] text-gray-400">No recorded activity yet.</p> : (
                <div className="flex flex-col gap-2">
                  {activity.slice(0, 8).map((a, i) => (
                    <div key={i} className="flex items-start gap-2.5 text-[12px]"><span className="text-gray-300 mt-0.5">•</span><span className="text-gray-700"><span className="font-medium">{a.actor}</span> {a.action}{a.entity ? <span className="text-gray-400"> — {a.entity}</span> : null} <span className="text-gray-300">· {relTime(a.when)}</span></span></div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "Archive & Lifecycle" && (
            <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-5">
              <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-1">Archived &amp; Retired</p>
              <p className="text-[11px] text-gray-400 mb-3">Resources currently in an archived or deprecated state. Retention policies and historical restore need the archive store.</p>
              {archived.length === 0 ? <p className="text-[12px] text-emerald-600">Nothing archived — every resource is active.</p> : (
                <div className="flex flex-col divide-y divide-gray-100">
                  {archived.map(r => (
                    <div key={r.id} className="flex items-center gap-3 py-2.5"><span className="text-base">{r.icon}</span><span className="flex-1 text-[13px] text-gray-800 truncate">{r.title}</span><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${STATUS_CLS[r.statusKind]}`}>{r.status}</span></div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "Analytics" && (
            <div className="flex flex-col gap-5">
              <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-5">
                <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-3">Publishable Resources by Type</p>
                <BarList bars={typeCounts} tint={() => "bg-violet-500"} />
              </div>
              <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-5">
                <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-3">Resources by Status</p>
                <BarList bars={statusCounts} tint={b => b.kind === "published" ? "bg-emerald-500" : b.kind === "review" ? "bg-amber-500" : b.kind === "archived" || b.kind === "deprecated" ? "bg-gray-400" : "bg-blue-400"} />
              </div>
              <p className="text-[10px] text-gray-400">Approval time, release success rate, rollback frequency and adoption metrics require the release &amp; publish-job store — shown once connected.</p>
            </div>
          )}

          {tab === "Release Management" && <Scaffold icon="📦" title="Release packages" body="Bundle multiple related assets — framework updates, assessments, pathways, policies and passports — into one governed deployment with release notes, impact analysis and rollback planning." />}
          {tab === "Scheduling" && <Scaffold icon="🗓️" title="Publication scheduling" body="Schedule future or conditional publication — publish next semester, after accreditation, or in timed windows — with automatic publish/unpublish and expiry dates." />}
          {tab === "Distribution" && <Scaffold icon="🌐" title="Distribution manager" body="Target exactly who receives each published resource — by hospital, department, unit, professional group, cohort, role or individual — with pilot rollouts and access permissions." />}
        </div>

        {/* Right rail — selected resource */}
        <div className="min-w-0">
          <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-4 sticky top-4">
            {!sel ? <p className="text-[12px] text-gray-400">Select a resource to view its publication detail.</p> : (
              <>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Selected Resource</p>
                <div className="flex items-start gap-2 mb-3">
                  <span className="text-lg">{sel.icon}</span>
                  <div className="min-w-0"><p className="text-[14px] font-bold text-gray-900 leading-tight">{sel.title}</p><p className="text-[11px] text-gray-400">{sel.type} · {sel.version ? `v${sel.version}` : "unversioned"}</p></div>
                </div>

                {/* Checklist */}
                <div className="rounded-xl border border-gray-100 p-3 mb-3">
                  <div className="flex items-center justify-between mb-2"><span className="text-[11px] font-bold text-gray-600">Publication Checklist</span><span className="text-[11px] font-bold text-violet-600">{sel.checklistPct}% Complete</span></div>
                  <div className="w-full bg-gray-100 rounded-full h-1.5 mb-2.5"><div className="h-full bg-violet-500 rounded-full" style={{ width: `${sel.checklistPct}%` }} /></div>
                  <div className="flex flex-col gap-1.5">
                    {sel.checklist.map(c => (
                      <div key={c.label} className="flex items-center gap-2 text-[12px] text-gray-600"><span className={`w-4 text-center font-bold ${CHECK_CLS[c.state]}`}>{CHECK_ICON[c.state]}</span>{c.label}</div>
                    ))}
                  </div>
                </div>

                {/* Approval progress */}
                <div className="rounded-xl border border-gray-100 p-3 mb-3">
                  <span className="text-[11px] font-bold text-gray-600 block mb-2">Approval Progress</span>
                  <div className="flex items-center gap-2 text-[12px]"><span className={`font-semibold ${APPROVAL_CLS[sel.approvalKind]}`}>{sel.approval}</span><span className="text-gray-300">·</span><span className="text-gray-500">{sel.status}</span></div>
                  <p className="text-[9px] text-gray-400 mt-1.5">Full multi-reviewer sign-off workflow store not connected — state derived from publication status.</p>
                </div>

                {/* Audit trail */}
                <div className="rounded-xl border border-gray-100 p-3 mb-3">
                  <span className="text-[11px] font-bold text-gray-600 block mb-2">Audit Trail</span>
                  {sel.audit.length === 0 ? <p className="text-[11px] text-gray-400">No audit events recorded for this resource.</p> : (
                    <div className="flex flex-col gap-1.5">
                      {sel.audit.map((a, i) => (
                        <div key={i} className="text-[11px] text-gray-600 leading-tight"><span className="font-medium">{a.actor}</span> {a.action} <span className="text-gray-300">· {relTime(a.when)}</span></div>
                      ))}
                    </div>
                  )}
                </div>

                {/* AI recommendations — honest, derived from checklist gaps */}
                <div className="rounded-xl border border-violet-100 bg-violet-50/50 p-3">
                  <span className="text-[11px] font-bold text-violet-700 block mb-1.5">✨ AI Recommendations {!aiConfigured && <span className="text-[8px] font-normal text-gray-400">(assistant offline)</span>}</span>
                  <ul className="flex flex-col gap-1 text-[11px] text-gray-600">
                    {sel.checklist.filter(c => c.state !== "done").map(c => <li key={c.label} className="flex gap-1.5"><span className="text-violet-400">→</span>Resolve: {c.label.toLowerCase()}</li>)}
                    {sel.checklist.every(c => c.state === "done") && <li className="flex gap-1.5"><span className="text-emerald-500">✓</span>Ready to publish — all checklist items complete.</li>}
                  </ul>
                </div>

                <p className="text-[9px] text-gray-400 mt-3">Dependency graph, distribution targets &amp; release notes populate once the release store is connected.</p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
