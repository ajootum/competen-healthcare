"use client";

import { useState } from "react";

// Report Writer client: configure → generate → read/copy/print.

const TYPES = [
  { key: "assessment_summary", label: "Assessment Summary" },
  { key: "department", label: "Department Report" },
  { key: "learner_progress", label: "Learner Progress Overview" },
  { key: "executive", label: "Executive Summary" },
];

export default function ReportWriterClient({ departments, recent }: {
  departments: string[]; recent: { who: string; type: string; at: string }[];
}) {
  const [reportType, setReportType] = useState("assessment_summary");
  const [department, setDepartment] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<{ title: string; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setBusy(true); setError(null);
    const res = await fetch("/api/ai/report", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ report_type: reportType, department: department || undefined, from: from || undefined, to: to || undefined }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok && d.answer) setReport({ title: d.title ?? "Report", text: d.answer });
    else setError(d.error ?? "Report generation failed");
    setBusy(false);
  }

  async function copy() {
    if (!report) return;
    try { await navigator.clipboard.writeText(report.text); setCopied(true); } catch { /* clipboard unavailable */ }
  }

  return (
    <div className="grid lg:grid-cols-[280px_minmax(0,1fr)] gap-4">
      <div className="space-y-3">
        <div className="bg-white border border-indigo-200 rounded-xl p-4 no-print">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2.5">Report Configuration</p>
          <div className="space-y-1.5 mb-3">
            {TYPES.map(t => (
              <label key={t.key} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border cursor-pointer text-xs transition-colors ${
                reportType === t.key ? "border-indigo-400 bg-indigo-50 text-indigo-800 font-semibold" : "border-gray-100 text-gray-600 hover:border-gray-300"}`}>
                <input type="radio" name="rtype" checked={reportType === t.key} onChange={() => setReportType(t.key)} className="accent-indigo-600" />
                {t.label}
              </label>
            ))}
          </div>
          <select value={department} onChange={e => setDepartment(e.target.value)}
            className="w-full text-xs border border-gray-200 rounded-lg px-2 py-2 bg-white text-gray-600 focus:outline-none focus:border-indigo-400 mb-2">
            <option value="">All departments</option>
            {departments.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <div className="flex items-center gap-1.5 mb-3">
            <input type="date" value={from} onChange={e => setFrom(e.target.value)}
              className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-600 focus:outline-none focus:border-indigo-400" />
            <span className="text-gray-300 text-xs">→</span>
            <input type="date" value={to} onChange={e => setTo(e.target.value)}
              className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-600 focus:outline-none focus:border-indigo-400" />
          </div>
          <p className="text-[9px] text-gray-400 mb-2.5">Window defaults to the last 30 days.</p>
          <button onClick={generate} disabled={busy}
            className="w-full text-xs font-bold text-white bg-indigo-600 rounded-lg px-4 py-2.5 hover:bg-indigo-700 disabled:opacity-50 transition-colors">
            {busy ? "Writing…" : "✨ Generate Report"}
          </button>
          {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4 no-print">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Recent Generations</p>
          {recent.length ? (
            <ul className="space-y-1">
              {recent.map((r, i) => (
                <li key={i} className="text-[10px] text-gray-500">
                  {r.who} · {r.type.replace(/_/g, " ")} · <span suppressHydrationWarning>{new Date(r.at).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-[10px] text-gray-400">Nothing generated yet.</p>}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5 min-h-[300px]">
        {report ? (
          <>
            <div className="flex items-center gap-2 mb-3 no-print">
              <p className="text-sm font-bold text-gray-900 flex-1">{report.title}</p>
              <button onClick={copy} className="text-[11px] font-semibold text-gray-600 border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-50">
                {copied ? "✓ Copied" : "Copy"}
              </button>
              <button onClick={() => window.print()} className="text-[11px] font-semibold text-gray-600 border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-50">
                ⬇ PDF
              </button>
            </div>
            <div className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed">{report.text}</div>
            <p className="text-[8px] text-gray-400 mt-3">Generated by Claude from live platform figures · audit-logged · review before circulation.</p>
          </>
        ) : (
          <div className="h-full flex items-center justify-center text-center py-16">
            <div>
              <p className="text-3xl mb-2">📝</p>
              <p className="text-sm text-gray-500">Configure a report on the left and press Generate.</p>
              <p className="text-[10px] text-gray-400 mt-1">The narrative is written from real assessment, evidence and decision figures for your hospital.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
