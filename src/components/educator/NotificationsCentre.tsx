"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// Educator Notifications Centre (COMPETEN Educator Notifications Developer
// Specification v2.0 + approved mockup). Summary cards, category tabs, list
// with priority/status columns, right-side detail drawer, search + filters,
// recent activity and analytics — every figure from live records.
//
// Honest departures from the mockup (no backing store — labelled, not faked):
// status is Unread/Read (Pending/Open/Completed lifecycle isn't tracked);
// Archived tab is disabled (no archived column); avg response time needs
// read-timestamps; linked course/learner/attachments aren't stored on
// notifications, so drawer actions beyond Open/Mark-read are omitted.

export type Notif = {
  id: string; type: string; title: string; body: string | null;
  href: string | null; read: boolean; created_at: string;
};

export type ActivityItem = { id: string; label: string; sub: string; when: string };

type Priority = "high" | "important" | "info" | "success";

const PRIORITY_OF = (type: string): Priority => {
  if (["logbook_rejected", "logbook_escalated"].includes(type)) return "high";
  if (["logbook_changes_requested", "logbook_pending", "credential_submitted", "assessment_scheduled", "assessment_cancelled", "message", "audit_finding", "capa_assigned", "appeal_submitted", "appeal_resolved"].includes(type)) return "important";
  if (["logbook_verified", "decisions_issued", "credential_added", "assessment_submitted", "osce_completed"].includes(type)) return "success";
  return "info";
};

const PRIORITY_UI: Record<Priority, { label: string; chip: string; border: string }> = {
  high:      { label: "High",   chip: "bg-red-100 text-red-700",     border: "border-l-red-400" },
  important: { label: "Medium", chip: "bg-amber-100 text-amber-700", border: "border-l-amber-400" },
  info:      { label: "Info",   chip: "bg-blue-100 text-blue-700",   border: "border-l-blue-300" },
  success:   { label: "Done",   chip: "bg-green-100 text-green-700", border: "border-l-green-400" },
};

const TYPE_ICON: Record<string, string> = {
  logbook_pending: "📖", logbook_verified: "✅", logbook_rejected: "❌",
  logbook_changes_requested: "✏️", logbook_escalated: "⬆️", decisions_issued: "🧠",
  credential_added: "🏅", credential_submitted: "🏅",
  assessment_scheduled: "📅", assessment_cancelled: "🚫",
  senior_assessor_granted: "⭐", senior_assessor_revoked: "⭐",
  evidence_requested: "📎", assessment_submitted: "📝", message: "💬", osce_completed: "🩺",
  audit_finding: "📋", capa_assigned: "🛠️",
  report_ready: "📊", appeal_submitted: "⚖️", appeal_resolved: "⚖️",
};

const ACTION_LABEL: Record<string, string> = {
  logbook_pending: "Review", logbook_verified: "View", logbook_rejected: "Review",
  logbook_changes_requested: "Review", logbook_escalated: "Review",
  decisions_issued: "View", credential_added: "View", credential_submitted: "Review",
  assessment_scheduled: "View", assessment_cancelled: "View",
  senior_assessor_granted: "Open", senior_assessor_revoked: "Open",
  evidence_requested: "Open", assessment_submitted: "View", osce_completed: "View",
  audit_finding: "View", capa_assigned: "Open", report_ready: "Open",
  appeal_submitted: "Review", appeal_resolved: "View",
};

// Spec category ← live notification types. Categories with no producing
// feature yet stay empty until those modules ship.
const CATEGORY_TYPES: Record<string, string[]> = {
  Teaching: [],
  Assessments: ["assessment_scheduled", "assessment_cancelled", "assessment_submitted", "decisions_issued", "osce_completed"],
  Learners: ["credential_added", "credential_submitted", "senior_assessor_granted", "senior_assessor_revoked"],
  Evidence: ["logbook_pending", "logbook_verified", "logbook_rejected", "logbook_changes_requested", "logbook_escalated", "evidence_requested"],
  Courses: [],
  Quality: ["audit_finding", "capa_assigned", "appeal_submitted", "appeal_resolved", "report_ready"],
  AI: [],
  Messages: ["message"],
};

const CATEGORY_CHIP: Record<string, string> = {
  Assessments: "bg-purple-50 text-purple-700", Learners: "bg-blue-50 text-blue-700",
  Evidence: "bg-teal-50 text-teal-700", Quality: "bg-amber-50 text-amber-700",
  Messages: "bg-pink-50 text-pink-700", Teaching: "bg-indigo-50 text-indigo-700",
  Courses: "bg-orange-50 text-orange-700", AI: "bg-violet-50 text-violet-700",
  Other: "bg-gray-100 text-gray-500",
};

const CATEGORY_EMPTY: Record<string, string> = {
  Teaching: "Class, virtual-classroom and simulation-session notifications arrive when the teaching scheduler ships.",
  Courses: "Course publishing and module-update notifications arrive when the course editor ships.",
  AI: "AI risk and recommendation notifications arrive when AI alerting is wired to the notification stream.",
};

const categoryOf = (type: string): string =>
  Object.entries(CATEGORY_TYPES).find(([, types]) => types.includes(type))?.[0] ?? "Other";

const ACTIONABLE = new Set(["logbook_pending", "logbook_escalated", "logbook_changes_requested", "credential_submitted", "capa_assigned", "appeal_submitted", "evidence_requested"]);

const fmtAgo = (iso: string, now: number) => {
  const mins = Math.max(1, Math.round((now - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? "Yesterday" : `${days} d ago`;
};

export default function NotificationsCentre({ items, validatedToday, pendingValidations, activity }: {
  items: Notif[];
  validatedToday: number;
  pendingValidations: number;
  activity: ActivityItem[];
}) {
  const router = useRouter();
  const [now] = useState(() => Date.now());
  const [tab, setTab] = useState("All");
  const [q, setQ] = useState("");
  const [priority, setPriority] = useState<"all" | Priority>("all");
  const [status, setStatus] = useState<"all" | "unread" | "read">("all");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const unread = items.filter(n => !n.read).length;
  const highPriority = items.filter(n => PRIORITY_OF(n.type) === "high").length;
  const awaitingAction = items.filter(n => !n.read && ACTIONABLE.has(n.type)).length;
  const aiCount = items.filter(n => categoryOf(n.type) === "AI").length;

  const tabs = ["All", ...Object.keys(CATEGORY_TYPES)];
  const tabCount = (t: string) => t === "All" ? items.length : items.filter(n => categoryOf(n.type) === t).length;

  const filtered = useMemo(() => {
    let rows = items;
    if (tab !== "All") rows = rows.filter(n => categoryOf(n.type) === tab);
    if (priority !== "all") rows = rows.filter(n => PRIORITY_OF(n.type) === priority);
    if (status !== "all") rows = rows.filter(n => status === "unread" ? !n.read : n.read);
    const term = q.trim().toLowerCase();
    if (term) rows = rows.filter(n => n.title.toLowerCase().includes(term) || (n.body ?? "").toLowerCase().includes(term));
    return [...rows].sort((a, b) => sort === "newest"
      ? b.created_at.localeCompare(a.created_at)
      : a.created_at.localeCompare(b.created_at));
  }, [items, tab, priority, status, q, sort]);

  const selected = items.find(n => n.id === selectedId) ?? null;

  async function markRead(ids: string[] | "all") {
    setBusy(true);
    await fetch("/api/notifications", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ids === "all" ? { all: true } : { ids }),
    });
    router.refresh();
    setBusy(false);
  }

  // Analytics — computed from live rows; response time needs read timestamps
  // which aren't stored, so it stays an honest dash.
  const weekAgo = now - 7 * 86400000;
  const thisWeek = items.filter(n => new Date(n.created_at).getTime() >= weekAgo).length;
  const readRate = items.length ? Math.round((items.filter(n => n.read).length / items.length) * 100) : null;
  const staleUnread = items.filter(n => !n.read && new Date(n.created_at).getTime() < weekAgo).length;
  const weeklyTrend = [3, 2, 1, 0].map(w => {
    const from = now - (w + 1) * 7 * 86400000;
    const to = now - w * 7 * 86400000;
    return items.filter(n => { const t = new Date(n.created_at).getTime(); return t >= from && t < to; }).length;
  });
  const trendMax = Math.max(1, ...weeklyTrend);

  const SUMMARY = [
    { icon: "📩", tint: "bg-purple-50", label: "Unread Notifications", value: unread },
    { icon: "❗", tint: "bg-red-50", label: "High Priority", value: highPriority },
    { icon: "⏳", tint: "bg-amber-50", label: "Awaiting Action", value: awaitingAction, sub: `${pendingValidations} in validation queue` },
    { icon: "✅", tint: "bg-green-50", label: "Completed Today", value: validatedToday, sub: "validations signed off" },
    { icon: "✨", tint: "bg-violet-50", label: "AI Recommendations", value: aiCount, sub: aiCount === 0 ? "none yet — AI alerting pending" : undefined },
  ];

  return (
    <div className={`grid grid-cols-1 gap-5 items-start ${selected ? "xl:grid-cols-[minmax(0,1fr)_300px]" : ""}`}>
      <div className="min-w-0">
        {/* Header */}
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <span className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center text-lg shrink-0">🔔</span>
          <div className="mr-auto">
            <h1 className="text-xl font-bold text-gray-900">Notifications</h1>
            <p className="text-gray-400 text-sm">Educator Operations Centre</p>
          </div>
          <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 focus-within:border-purple-400 transition-colors">
            <span className="text-gray-400 text-sm">🔍</span>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search notifications…"
              className="w-44 text-sm outline-none placeholder:text-gray-300 bg-transparent" aria-label="Search notifications" />
          </div>
          <select value={priority} onChange={e => setPriority(e.target.value as typeof priority)}
            className="bg-white border border-gray-200 rounded-xl px-2.5 py-2 text-xs text-gray-600" aria-label="Filter by priority">
            <option value="all">Priority: All</option>
            <option value="high">High</option>
            <option value="important">Medium</option>
            <option value="info">Info</option>
            <option value="success">Done</option>
          </select>
          <select value={status} onChange={e => setStatus(e.target.value as typeof status)}
            className="bg-white border border-gray-200 rounded-xl px-2.5 py-2 text-xs text-gray-600" aria-label="Filter by status">
            <option value="all">Status: All</option>
            <option value="unread">Unread</option>
            <option value="read">Read</option>
          </select>
          <span className="relative bg-white border border-gray-200 rounded-xl w-10 h-10 flex items-center justify-center">
            🔔
            {unread > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </span>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3 mb-5">
          {SUMMARY.map(c => (
            <div key={c.label} className={`${c.tint} border border-gray-100 rounded-2xl p-4`}>
              <p className="text-lg">{c.icon}</p>
              <p className="text-[11px] font-semibold text-gray-600 mt-1.5 leading-tight">{c.label}</p>
              <p className="text-2xl font-extrabold text-gray-900 leading-tight">{c.value}</p>
              {c.sub && <p className="text-[9px] text-gray-400 mt-0.5">{c.sub}</p>}
            </div>
          ))}
        </div>

        {/* Category tabs */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 mb-3">
          {tabs.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                tab === t ? "bg-purple-600 text-white" : "bg-white border border-gray-200 text-gray-600 hover:border-purple-300"
              }`}>
              {t} ({tabCount(t)})
            </button>
          ))}
          <span title="Archiving isn't available yet — notifications have no archived state"
            className="shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold bg-gray-50 text-gray-300 cursor-default select-none">
            Archived <span className="text-[8px] font-bold uppercase tracking-wider bg-gray-100 text-gray-400 rounded px-1 py-0.5 ml-0.5">soon</span>
          </span>
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between mb-2">
          <select value={sort} onChange={e => setSort(e.target.value as typeof sort)}
            className="bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-600" aria-label="Sort order">
            <option value="newest">Sort by: Newest</option>
            <option value="oldest">Sort by: Oldest</option>
          </select>
          {unread > 0 && (
            <button onClick={() => markRead("all")} disabled={busy}
              className="text-xs font-semibold text-purple-700 border border-purple-200 bg-white hover:bg-purple-50 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-40">
              ✓ Mark all as read
            </button>
          )}
        </div>

        {/* Notification list */}
        <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
          <div className="hidden sm:grid grid-cols-[70px_minmax(0,1fr)_92px_76px_64px_80px] gap-2 px-4 py-2.5 border-b border-gray-100 bg-gray-50/50">
            {["Priority", "Notification", "Category", "Time", "Status", "Action"].map(h => (
              <p key={h} className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">{h}</p>
            ))}
          </div>
          {filtered.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-2xl mb-2">🧭</p>
              <p className="text-sm font-semibold text-gray-700">
                {items.length === 0 ? "No notifications yet" : `No ${tab === "All" ? "" : tab.toLowerCase() + " "}notifications match`}
              </p>
              <p className="text-xs text-gray-400 mt-1 max-w-sm mx-auto">
                {CATEGORY_EMPTY[tab] ?? (items.length === 0
                  ? "Events land here as validations, evidence and schedules move."
                  : "Try clearing the search or filters.")}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {filtered.map(n => {
                const pr = PRIORITY_UI[PRIORITY_OF(n.type)];
                const cat = categoryOf(n.type);
                const isSel = n.id === selectedId;
                return (
                  <div key={n.id}
                    onClick={() => setSelectedId(isSel ? null : n.id)}
                    className={`grid grid-cols-1 sm:grid-cols-[70px_minmax(0,1fr)_92px_76px_64px_80px] gap-2 items-center px-4 py-3 border-l-4 cursor-pointer transition-colors ${pr.border} ${isSel ? "bg-purple-50/60" : "hover:bg-gray-50/60"}`}>
                    <span className={`justify-self-start text-[9px] font-bold px-2 py-0.5 rounded ${pr.chip}`}>{pr.label}</span>
                    <div className="min-w-0">
                      <p className={`text-[13px] leading-snug truncate ${n.read ? "text-gray-600" : "font-semibold text-gray-900"}`}>
                        {TYPE_ICON[n.type] ?? "🔔"} {n.title}
                      </p>
                      {n.body && <p className="text-[11px] text-gray-400 truncate">{n.body}</p>}
                    </div>
                    <span className={`justify-self-start text-[9px] font-semibold px-2 py-0.5 rounded ${CATEGORY_CHIP[cat] ?? CATEGORY_CHIP.Other}`}>{cat}</span>
                    <span className="text-[10px] text-gray-400" suppressHydrationWarning>{fmtAgo(n.created_at, now)}</span>
                    <span className={`justify-self-start text-[9px] font-bold px-2 py-0.5 rounded ${n.read ? "bg-gray-100 text-gray-400" : "bg-amber-50 text-amber-700"}`}>
                      {n.read ? "Read" : "Unread"}
                    </span>
                    {n.href ? (
                      <Link href={n.href} onClick={e => e.stopPropagation()}
                        className="text-center text-[10px] font-semibold text-purple-700 border border-purple-200 rounded-lg px-2 py-1 hover:bg-purple-50 transition-colors">
                        {ACTION_LABEL[n.type] ?? "Open"}
                      </Link>
                    ) : (
                      <span className="text-center text-[10px] text-gray-300">—</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <p className="text-[9px] text-gray-300 mt-1.5">
          Status reflects read state — pending/open/completed lifecycle isn&apos;t tracked on notifications yet. Showing the latest {items.length}.
        </p>

        {/* Bottom row: recent activity + analytics */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-5">
          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-gray-900">Recent Activity</h2>
              <Link href="/educator/validations" className="text-[11px] font-semibold text-purple-600 hover:underline">View queue →</Link>
            </div>
            {activity.length === 0 ? (
              <p className="text-xs text-gray-400">No validations signed off yet — your recent educator actions appear here.</p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {activity.map(a => (
                  <div key={a.id} className="flex items-start gap-2.5">
                    <span className="text-sm shrink-0 mt-0.5">✅</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold text-gray-800 leading-snug truncate">{a.label}</p>
                      <p className="text-[9px] text-gray-400 truncate">{a.sub}</p>
                    </div>
                    <span className="text-[9px] text-gray-300 shrink-0" suppressHydrationWarning>{fmtAgo(a.when, now)}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[9px] text-gray-300 mt-2.5">Course publishing and feedback events join this feed when those modules ship.</p>
          </div>

          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <h2 className="text-sm font-bold text-gray-900 mb-3">Notification Analytics</h2>
            <div className="grid grid-cols-4 gap-2 mb-3">
              {[
                { label: "This Week", v: String(thisWeek), sub: "notifications" },
                { label: "Read Rate", v: readRate !== null ? `${readRate}%` : "—", sub: "all time" },
                { label: "Unread >7d", v: String(staleUnread), sub: "needs attention", warn: staleUnread > 0 },
                { label: "Avg. Response", v: "—", sub: "needs read timestamps" },
              ].map(s => (
                <div key={s.label} className="bg-gray-50 rounded-xl p-2.5">
                  <p className="text-[9px] font-semibold text-gray-400 leading-tight">{s.label}</p>
                  <p className={`text-lg font-extrabold leading-tight ${s.warn ? "text-red-600" : "text-gray-900"}`}>{s.v}</p>
                  <p className="text-[8px] text-gray-400">{s.sub}</p>
                </div>
              ))}
            </div>
            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">4-week volume</p>
            <div className="flex items-end gap-2 h-14">
              {weeklyTrend.map((v, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full bg-purple-100 rounded-t" style={{ height: `${Math.max(6, (v / trendMax) * 100)}%` }}>
                    <div className="sr-only">{v}</div>
                  </div>
                  <span className="text-[8px] text-gray-400">Wk {i + 1} · {v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Detail drawer */}
      {selected && (() => {
        const pr = PRIORITY_UI[PRIORITY_OF(selected.type)];
        const cat = categoryOf(selected.type);
        return (
          <div className="bg-white border border-gray-100 rounded-2xl p-5 xl:sticky xl:top-6">
            <div className="flex items-start justify-between gap-2 mb-3">
              <h2 className="text-sm font-bold text-gray-900 leading-snug">{TYPE_ICON[selected.type] ?? "🔔"} {selected.title}</h2>
              <button onClick={() => setSelectedId(null)} aria-label="Close details"
                className="text-gray-300 hover:text-gray-600 text-sm shrink-0">✕</button>
            </div>
            <span className={`inline-block text-[9px] font-bold px-2 py-0.5 rounded ${pr.chip}`}>{pr.label} priority</span>
            <div className="mt-4 flex flex-col gap-2.5 text-[11px]">
              {selected.body && (
                <div>
                  <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Description</p>
                  <p className="text-gray-700 leading-snug mt-0.5">{selected.body}</p>
                </div>
              )}
              <div className="flex justify-between"><span className="text-gray-400">Category</span><span className={`text-[9px] font-semibold px-2 py-0.5 rounded ${CATEGORY_CHIP[cat] ?? CATEGORY_CHIP.Other}`}>{cat}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Received</span><span className="text-gray-700" suppressHydrationWarning>{new Date(selected.created_at).toLocaleString()}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Status</span>
                <span className={`text-[9px] font-bold px-2 py-0.5 rounded ${selected.read ? "bg-gray-100 text-gray-400" : "bg-amber-50 text-amber-700"}`}>{selected.read ? "Read" : "Unread"}</span>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-2">
              {selected.href && (
                <Link href={selected.href}
                  className="block text-center text-xs font-semibold bg-purple-600 text-white hover:bg-purple-700 py-2 rounded-lg transition-colors">
                  {ACTION_LABEL[selected.type] ?? "Open"} →
                </Link>
              )}
              {!selected.read && (
                <button onClick={() => markRead([selected.id])} disabled={busy}
                  className="text-xs font-semibold text-purple-700 border border-purple-200 bg-white hover:bg-purple-50 py-2 rounded-lg transition-colors disabled:opacity-40">
                  ✓ Mark as read
                </button>
              )}
            </div>
            <p className="text-[9px] text-gray-300 mt-3 leading-snug">
              Linked course, learner and attachment records aren&apos;t stored on notifications yet, so reviewer assignment, messaging and evidence download live on the linked page.
            </p>
          </div>
        );
      })()}
    </div>
  );
}
