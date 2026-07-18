"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// Notifications workspace (Nurse + Assessor Notification specs): category
// tabs, priority tiles, search, filters, day grouping, per-card actions and
// bulk mark-read — all derived from the real notifications store. Priority
// and category are derived from the notification type (no priority engine
// exists); settings, websockets, assign/archive/export/escalate and audit
// timelines have no backing yet and are omitted.

export type Notif = {
  id: string; type: string; title: string; body: string | null;
  href: string | null; read: boolean; created_at: string;
};

type Variant = "nurse" | "assessor";
type Priority = "high" | "important" | "info" | "success";

const PRIORITY_OF = (type: string): Priority => {
  if (["logbook_rejected", "logbook_escalated"].includes(type)) return "high";
  if (["logbook_changes_requested", "logbook_pending", "credential_submitted", "assessment_scheduled", "assessment_cancelled", "message", "audit_finding", "capa_assigned", "appeal_submitted", "appeal_resolved"].includes(type)) return "important";
  if (["logbook_verified", "decisions_issued", "credential_added", "assessment_submitted", "osce_completed"].includes(type)) return "success";
  return "info";
};

const PRIORITY_UI: Record<Priority, { label: string; chip: string; dot: string; border: string }> = {
  high:      { label: "High",    chip: "bg-red-100 text-red-700",     dot: "text-red-500",    border: "border-l-red-400" },
  important: { label: "Medium",  chip: "bg-amber-100 text-amber-700", dot: "text-amber-500",  border: "border-l-amber-400" },
  info:      { label: "Info",    chip: "bg-blue-100 text-blue-700",   dot: "text-blue-500",   border: "border-l-blue-300" },
  success:   { label: "Success", chip: "bg-green-100 text-green-700", dot: "text-green-500",  border: "border-l-green-400" },
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
  logbook_pending: "Review Now", logbook_verified: "View Logbook",
  logbook_rejected: "Fix & Resubmit", logbook_changes_requested: "Fix & Resubmit",
  logbook_escalated: "Review Escalation",
  decisions_issued: "View Passport", credential_added: "View Credentials",
  credential_submitted: "Review Credential", assessment_scheduled: "View Schedule",
  assessment_cancelled: "View Schedule",
  senior_assessor_granted: "Open Evidence Centre", senior_assessor_revoked: "Open Evidence Centre",
  evidence_requested: "Open Logbook", assessment_submitted: "View Feedback", osce_completed: "View Feedback",
  audit_finding: "View Feedback", capa_assigned: "Open CAPA Tracker",
  report_ready: "Open Report", appeal_submitted: "Review Appeal", appeal_resolved: "View Feedback",
};

const TABS: Record<Variant, { label: string; types: string[] | null; actionSet?: boolean }[]> = {
  nurse: [
    { label: "All", types: null },
    { label: "Action Required", types: ["logbook_changes_requested", "logbook_rejected", "assessment_scheduled", "evidence_requested"] },
    { label: "Learning", types: [] },
    { label: "Assessments", types: ["decisions_issued", "assessment_scheduled", "assessment_cancelled", "assessment_submitted", "osce_completed"] },
    { label: "Feedback", types: ["logbook_verified", "logbook_rejected", "logbook_changes_requested", "assessment_submitted", "audit_finding", "appeal_resolved"] },
    { label: "Updates", types: ["credential_added", "credential_submitted"] },
  ],
  assessor: [
    { label: "All", types: null },
    { label: "Action Required", types: ["logbook_pending", "logbook_escalated", "credential_submitted", "capa_assigned", "appeal_submitted"] },
    { label: "Approvals", types: ["credential_submitted"] },
    { label: "Learners", types: ["decisions_issued", "credential_added"] },
    { label: "Schedules", types: ["assessment_scheduled", "assessment_cancelled"] },
    { label: "Evidence", types: ["logbook_pending", "logbook_escalated"] },
  ],
};

const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  if (d >= today) return "Today";
  if (d >= yesterday) return "Yesterday";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
};

export default function NotificationsWorkspace({ items, variant, emptySummary }: {
  items: Notif[]; variant: Variant; emptySummary?: React.ReactNode;
}) {
  const router = useRouter();
  const [tab, setTab] = useState("All");
  const [q, setQ] = useState("");
  const [priority, setPriority] = useState<"all" | Priority>("all");
  const [status, setStatus] = useState<"all" | "unread" | "read">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState(30);
  const [busy, setBusy] = useState(false);

  const tabs = TABS[variant];
  const unreadTotal = items.filter(n => !n.read).length;

  const tabCount = (types: string[] | null) =>
    types === null ? items.length : items.filter(n => types.includes(n.type)).length;

  const filtered = useMemo(() => {
    const activeTab = tabs.find(t => t.label === tab) ?? tabs[0];
    return items.filter(n => {
      if (activeTab.types !== null && !activeTab.types.includes(n.type)) return false;
      if (priority !== "all" && PRIORITY_OF(n.type) !== priority) return false;
      if (status === "unread" && n.read) return false;
      if (status === "read" && !n.read) return false;
      const t = q.trim().toLowerCase();
      if (t && ![n.title, n.body ?? ""].some(s => s.toLowerCase().includes(t))) return false;
      return true;
    });
  }, [items, tabs, tab, priority, status, q]);

  const visible = filtered.slice(0, shown);
  const groups: { day: string; rows: Notif[] }[] = [];
  for (const n of visible) {
    const day = dayLabel(n.created_at);
    const g = groups[groups.length - 1];
    if (g && g.day === day) g.rows.push(n);
    else groups.push({ day, rows: [n] });
  }

  const prioritySummary = (["high", "important", "info", "success"] as Priority[])
    .map(p => ({ p, ...PRIORITY_UI[p], n: items.filter(x => PRIORITY_OF(x.type) === p).length }));

  async function markRead(ids: string[] | "all") {
    setBusy(true);
    await fetch("/api/notifications", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ids === "all" ? { all: true } : { ids }),
    });
    setSelected(new Set());
    router.refresh();
    setBusy(false);
  }

  const toggleSelect = (id: string) =>
    setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div>
      {/* Header row */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">🔔 Notifications</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            {variant === "assessor"
              ? "Assessment Operations Notification Centre"
              : "Your learning, assessments and professional updates."}
          </p>
        </div>
        {unreadTotal > 0 && (
          <button onClick={() => markRead("all")} disabled={busy}
            className="text-xs font-semibold text-gray-600 border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50 px-3 py-2 rounded-lg transition-colors">
            ✓ Mark all {unreadTotal} as read
          </button>
        )}
      </div>

      {/* Category tabs */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {tabs.map(t => {
          const n = tabCount(t.types);
          return (
            <button key={t.label} onClick={() => { setTab(t.label); setShown(30); }}
              className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                tab === t.label
                  ? variant === "assessor" ? "bg-indigo-600 border-indigo-600 text-white" : "bg-teal-600 border-teal-600 text-white"
                  : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}>
              {t.label}
              <span className={`text-[9px] font-bold rounded-full px-1.5 py-0.5 ${
                tab === t.label ? "bg-white/20 text-white" : "bg-gray-100 text-gray-500"
              }`}>{n}</span>
            </button>
          );
        })}
      </div>

      {/* Search + filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <input value={q} onChange={e => setQ(e.target.value)}
          placeholder="Search notifications…"
          className="flex-1 min-w-[180px] border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-200" />
        <select value={priority} onChange={e => setPriority(e.target.value as typeof priority)}
          className="border border-gray-200 rounded-lg px-2 py-2 text-xs bg-white text-gray-600 focus:outline-none">
          <option value="all">All priorities</option>
          <option value="high">High</option>
          <option value="important">Medium</option>
          <option value="info">Info</option>
          <option value="success">Success</option>
        </select>
        <select value={status} onChange={e => setStatus(e.target.value as typeof status)}
          className="border border-gray-200 rounded-lg px-2 py-2 text-xs bg-white text-gray-600 focus:outline-none">
          <option value="all">All status</option>
          <option value="unread">Unread</option>
          <option value="read">Read</option>
        </select>
      </div>

      {/* Priority tiles */}
      {items.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
          {prioritySummary.map(t => (
            <button key={t.p} onClick={() => setPriority(priority === t.p ? "all" : t.p)}
              className={`bg-white rounded-xl border p-3 text-left transition-colors ${
                priority === t.p ? "border-gray-400" : "border-gray-100 hover:border-gray-200"
              }`}>
              <p className={`text-lg font-extrabold leading-none ${t.dot}`}>{t.n}</p>
              <p className="text-[10px] font-semibold text-gray-500 mt-1">{t.label}{t.p === "high" ? " Priority" : ""}</p>
            </button>
          ))}
        </div>
      )}

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div className="bg-gray-900 text-white rounded-xl px-4 py-2.5 mb-3 flex items-center gap-3">
          <p className="text-xs font-semibold flex-1">{selected.size} selected</p>
          <button onClick={() => markRead([...selected])} disabled={busy}
            className="text-xs font-semibold bg-white text-gray-900 hover:bg-gray-100 disabled:opacity-50 px-3 py-1.5 rounded-lg transition-colors">
            ✓ Mark read
          </button>
          <button onClick={() => setSelected(new Set())} className="text-xs text-gray-300 hover:text-white">Clear</button>
        </div>
      )}

      {/* Feed */}
      {filtered.length === 0 ? (
        items.length === 0 && emptySummary ? <>{emptySummary}</> : (
          <div className="bg-white border border-gray-100 rounded-2xl p-10 text-center">
            <p className="text-3xl mb-2">🔔</p>
            <p className="text-sm font-semibold text-gray-700">
              {items.length === 0 ? "No notifications yet" : "Nothing matches these filters"}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {items.length === 0
                ? "Events land here as they happen — verifications, decisions, schedules and credentials."
                : "Clear the search or filters to see everything."}
            </p>
          </div>
        )
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map(g => (
            <div key={g.day}>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">{g.day}</p>
              <div className="flex flex-col gap-2">
                {g.rows.map(n => {
                  const pr = PRIORITY_UI[PRIORITY_OF(n.type)];
                  const action = n.href ? { label: ACTION_LABEL[n.type] ?? "View", href: n.href } : null;
                  return (
                    <div key={n.id}
                      className={`bg-white border border-gray-100 border-l-4 ${pr.border} rounded-xl px-4 py-3 flex items-start gap-3 ${n.read ? "" : "shadow-sm"}`}>
                      <input type="checkbox" checked={selected.has(n.id)} onChange={() => toggleSelect(n.id)}
                        className="mt-1.5 accent-gray-700 shrink-0" aria-label="Select notification" />
                      <span className="text-lg shrink-0">{TYPE_ICON[n.type] ?? "🔔"}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className={`text-sm ${n.read ? "text-gray-600" : "font-bold text-gray-900"}`}>{n.title}</p>
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${pr.chip}`}>{pr.label}</span>
                          {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-teal-500" />}
                        </div>
                        {n.body && <p className="text-xs text-gray-400 mt-0.5 leading-snug">{n.body}</p>}
                        <p className="text-[10px] text-gray-300 mt-1" suppressHydrationWarning>
                          {new Date(n.created_at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        {action && (
                          <Link href={action.href}
                            className={`text-[11px] font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                              variant === "assessor"
                                ? "bg-indigo-600 hover:bg-indigo-700 text-white"
                                : "bg-teal-600 hover:bg-teal-700 text-white"
                            }`}>
                            {action.label}
                          </Link>
                        )}
                        {!n.read && (
                          <button onClick={() => markRead([n.id])} disabled={busy}
                            className="text-[10px] text-gray-400 hover:text-gray-700 transition-colors">
                            Mark read
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {filtered.length > shown && (
            <button onClick={() => setShown(s => s + 30)}
              className="mx-auto text-xs font-semibold text-gray-500 border border-gray-200 bg-white hover:bg-gray-50 px-4 py-2 rounded-lg transition-colors">
              Load more ({filtered.length - shown} more)
            </button>
          )}
        </div>
      )}

      <p className="text-[10px] text-gray-300 mt-4">
        In-app only — email/SMS delivery, notification preferences and archive aren&apos;t configured yet.
        Priority is derived from the event type.
      </p>
    </div>
  );
}
