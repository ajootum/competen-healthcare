"use client";

import { useState } from "react";
import Link from "next/link";

// Incident Inbox & Triage Queue (UMG-QS-002 §2.2) — client shell that filters the live open-incident inbox by
// real status/severity tab. Rows come from the server loader (op_incidents); tabs map to REAL states (no
// fabricated "awaiting triage"/"escalated" states the store doesn't have). Report/act happens in the source.
/* eslint-disable @typescript-eslint/no-explicit-any */
const sevTone = (s: string) => (s === "critical" ? "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]" : s === "high" ? "bg-[var(--cmp-surface-warning)] text-orange-700" : s === "medium" ? "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]" : "bg-[var(--cmp-surface-success)] text-emerald-700");
const statusTone = (s: string) => (s === "reported" ? "bg-[var(--cmp-surface-information)] text-[var(--cmp-text-information)]" : s === "investigating" ? "bg-indigo-100 text-indigo-700" : s === "awaiting_action" ? "bg-violet-100 text-violet-700" : "bg-gray-100 text-gray-600");
const statusLabel: Record<string, string> = { reported: "New", investigating: "Investigating", awaiting_action: "Awaiting Action", closed: "Closed" };

export default function IncidentInbox({ rows, counts }: { rows: any[]; counts: any }) {
  const [tab, setTab] = useState("all");
  const TABS = [
    { key: "all", label: "All", n: counts.all },
    { key: "new", label: "New", n: counts.new },
    { key: "investigating", label: "Investigating", n: counts.investigating },
    { key: "awaitingAction", label: "Awaiting Action", n: counts.awaitingAction },
    { key: "urgent", label: "Urgent", n: counts.urgent },
  ];
  const filtered = rows.filter(r => {
    if (tab === "all") return true;
    if (tab === "new") return r.status === "reported";
    if (tab === "investigating") return r.status === "investigating";
    if (tab === "awaitingAction") return r.status === "awaiting_action";
    if (tab === "urgent") return ["critical", "high"].includes(r.severity);
    return true;
  });

  return (
    <div>
      <div className="flex gap-1 border-b border-gray-100 mb-2 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`shrink-0 text-xs px-3 py-1.5 border-b-2 -mb-px font-medium transition-colors ${tab === t.key ? "border-rose-600 text-[var(--cmp-text-error)]" : "border-transparent text-gray-400 hover:text-gray-600"}`}>
            {t.label}{t.n ? <span className="ml-1.5 text-[10px] text-gray-400">{t.n}</span> : null}
          </button>
        ))}
      </div>
      {filtered.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-gray-400 border-b border-gray-100"><th className="py-1.5 font-medium">ID</th><th className="py-1.5 font-medium">Incident Title</th><th className="py-1.5 font-medium">Reported</th><th className="py-1.5 font-medium">Severity</th><th className="py-1.5 font-medium">Status</th><th className="py-1.5 font-medium">Reported By</th></tr></thead>
            <tbody>{filtered.slice(0, 20).map(r => (
              <tr key={r.id} className="border-b border-gray-50">
                <td className="py-2 text-gray-400 tabular-nums whitespace-nowrap">{r.ref}</td>
                <td className="py-2 text-gray-700 max-w-[240px] truncate" title={r.title}>{r.title}{r.nearMiss && <span className="ml-1 text-[9px] text-teal-600">near-miss</span>}</td>
                <td className="py-2 text-gray-400 tabular-nums whitespace-nowrap">{r.at}</td>
                <td className="py-2"><span className={`text-[10px] font-semibold rounded px-1.5 py-0.5 ${sevTone(r.severity)}`}>{r.severity}</span></td>
                <td className="py-2"><span className={`text-[10px] font-semibold rounded px-1.5 py-0.5 ${statusTone(r.status)}`}>{statusLabel[r.status] ?? r.status}</span></td>
                <td className="py-2 text-gray-500 truncate max-w-[120px]">{r.reportedBy}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p className="text-sm text-gray-400 py-6 text-center">No incidents in this queue.</p>}
      <div className="flex justify-end mt-2"><Link href="/supervisor/quality-safety" className="text-[11px] font-medium text-[var(--cmp-text-error)] hover:underline">View full inbox →</Link></div>
    </div>
  );
}
