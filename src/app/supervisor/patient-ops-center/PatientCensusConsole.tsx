"use client";

import { useState } from "react";
import Link from "next/link";

// Patient Census + Patient Card drawer (SSW-003 §8 / §10). Interactive: tab
// filters, row selection opens the operational Patient Card drawer with the full
// per-patient record (already loaded — no round-trip). The operational registry
// holds no PHI, so identity fields (MRN, age, sex, attending team) show as honest
// states; everything operational (acuity, flags, obs, staff, status) is live.
/* eslint-disable @typescript-eslint/no-explicit-any */

const ACUITY_TONE: Record<string, string> = { critical: "bg-rose-50 text-rose-700", high: "bg-orange-50 text-orange-700", moderate: "bg-amber-50 text-amber-700", stable: "bg-green-50 text-green-700", low: "bg-green-50 text-green-700" };
const FLAG_TONE: Record<string, string> = { rose: "bg-rose-50 text-rose-600 border-rose-100", amber: "bg-amber-50 text-amber-600 border-amber-100", purple: "bg-purple-50 text-purple-600 border-purple-100", gray: "bg-gray-50 text-gray-500 border-gray-100" };
const OBS_TONE: Record<string, string> = { rose: "text-rose-600", amber: "text-amber-600", green: "text-green-600" };
const STATUS_TONE: Record<string, string> = { admitted: "text-gray-700", discharge_pending: "text-blue-600", transfer_pending: "text-violet-600", expected: "text-amber-600", discharged: "text-gray-400" };
const tc = (s: string) => (s ?? "").replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
const fmt = (iso?: string | null) => iso ? new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : "—";
const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };

export default function PatientCensusConsole({ records, tabs }: { records: any[]; tabs: { key: string; label: string; n: number }[] }) {
  const [tab, setTab] = useState("all");
  const [selId, setSelId] = useState<string | null>(records[0]?.id ?? null);
  const filtered = tab === "all" ? records : records.filter((r) => r.groups.includes(tab));
  const sel = records.find((r) => r.id === selId) ?? null;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      {/* Census table */}
      <div className="xl:col-span-2 bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <h2 className="text-sm font-bold text-gray-900 mr-1">Patient Census</h2>
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`text-xs font-medium px-2.5 py-1 rounded-lg border transition-colors ${tab === t.key ? "bg-teal-600 text-white border-teal-600" : "bg-white text-gray-600 border-gray-200 hover:border-teal-300"}`}>
              {t.label} <span className={tab === t.key ? "text-teal-100" : "text-gray-400"}>{t.n}</span>
            </button>
          ))}
        </div>
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-xs min-w-[640px]">
            <thead>
              <tr className="text-[10px] uppercase text-gray-400 text-left border-b border-gray-100">
                <th className="py-1.5 px-1.5 font-semibold">Patient</th>
                <th className="py-1.5 px-1.5 font-semibold">Bed</th>
                <th className="py-1.5 px-1.5 font-semibold">Acuity</th>
                <th className="py-1.5 px-1.5 font-semibold">Safety Flags</th>
                <th className="py-1.5 px-1.5 font-semibold">Obs Status</th>
                <th className="py-1.5 px-1.5 font-semibold">Staff</th>
                <th className="py-1.5 px-1.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-gray-400">No patients in this view.</td></tr>}
              {filtered.map((r) => (
                <tr key={r.id} onClick={() => setSelId(r.id)}
                  className={`border-b border-gray-50 cursor-pointer transition-colors ${selId === r.id ? "bg-teal-50/60" : "hover:bg-gray-50"}`}>
                  <td className="py-2 px-1.5">
                    <p className="font-medium text-gray-800">{r.label}</p>
                    <p className="text-[10px] text-gray-400">{r.ref ?? "no ref"}</p>
                  </td>
                  <td className="py-2 px-1.5 text-gray-600">{r.bed ?? "—"}</td>
                  <td className="py-2 px-1.5"><span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${ACUITY_TONE[r.acuity] ?? "bg-gray-100 text-gray-600"}`}>{tc(r.acuity)}</span></td>
                  <td className="py-2 px-1.5">
                    <div className="flex flex-wrap gap-1">
                      {r.flags.length === 0 && <span className="text-gray-300">None</span>}
                      {r.flags.slice(0, 2).map((f: any, i: number) => <span key={i} className={`text-[9px] px-1.5 py-0.5 rounded border ${FLAG_TONE[f.tone]}`}>{f.label}</span>)}
                      {r.flags.length > 2 && <span className="text-[9px] text-gray-400">+{r.flags.length - 2}</span>}
                    </div>
                  </td>
                  <td className="py-2 px-1.5"><span className={`font-medium ${OBS_TONE[r.obsStatus.tone]}`}>{r.obsStatus.label}</span>{r.obsStatus.detail && <span className="block text-[9px] text-gray-400">{r.obsStatus.detail}</span>}</td>
                  <td className="py-2 px-1.5 text-gray-600">{r.nurse ?? "—"}</td>
                  <td className={`py-2 px-1.5 font-medium ${STATUS_TONE[r.status] ?? "text-gray-600"}`}>{tc(r.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Patient Card drawer */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        {!sel ? <p className="text-sm text-gray-400 text-center py-10">Select a patient to view their operational card.</p> : (
          <>
            <div className="flex items-start justify-between gap-2 mb-3 pb-3 border-b border-gray-100">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-gray-900">{sel.label}</h3>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${ACUITY_TONE[sel.acuity] ?? "bg-gray-100 text-gray-600"}`}>{tc(sel.acuity)}</span>
                </div>
                <p className="text-[11px] text-gray-400">{sel.ref ?? "no EMR ref"} · {sel.bed ?? "no bed"}</p>
              </div>
            </div>

            <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1.5">Current Status</p>
            <div className="space-y-1 text-xs mb-3">
              {[["Status", tc(sel.status)], ["Admitted", fmt(sel.admittedAt)], ["Responsible nurse", sel.nurse ?? "Unassigned"], ["Attending team", "— (EMR)"], ["Next review", fmt(sel.nextReview)]].map(([l, v]: any) => (
                <div key={l} className="flex justify-between gap-2"><span className="text-gray-500">{l}</span><span className="text-gray-800 font-medium text-right">{v}</span></div>
              ))}
            </div>

            <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1.5">Safety Flags</p>
            <div className="flex flex-wrap gap-1 mb-3">
              {sel.flags.length === 0 ? <span className="text-xs text-gray-400">None recorded.</span> : sel.flags.map((f: any, i: number) => <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded border ${FLAG_TONE[f.tone]}`}>{f.label}</span>)}
            </div>

            <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1.5">Acuity &amp; Observations</p>
            <div className="grid grid-cols-2 gap-2 mb-3">
              {[["Acuity", tc(sel.acuity)], ["EWS score", sel.ews ?? "—"], ["Obs status", sel.obsStatus.label], ["Last obs", relTime(sel.lastObs) || "—"]].map(([l, v]: any) => (
                <div key={l} className="rounded-lg border border-gray-100 p-2"><p className="text-sm font-bold text-gray-900">{v}</p><p className="text-[9px] text-gray-500 uppercase">{l}</p></div>
              ))}
            </div>

            <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1.5">Recent Activity</p>
            <div className="space-y-1.5 mb-3">
              {sel.activity.length === 0 ? <p className="text-xs text-gray-400">No recent operational activity.</p> : sel.activity.map((a: any, i: number) => (
                <div key={i} className="flex items-start gap-2 text-[11px]">
                  <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${a.tone === "rose" ? "bg-rose-500" : a.tone === "amber" ? "bg-amber-500" : "bg-gray-300"}`} />
                  <span className="text-gray-600 flex-1">{a.text}</span>
                  <span className="text-gray-400 shrink-0">{relTime(a.at)}</span>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2 pt-3 border-t border-gray-100">
              <Link href="/supervisor/patient-list" className="text-[11px] text-center font-medium text-teal-700 border border-teal-200 rounded-lg px-2 py-1.5 hover:bg-teal-50">Update status</Link>
              <Link href="/supervisor/patient-flow" className="text-[11px] text-center font-medium text-teal-700 border border-teal-200 rounded-lg px-2 py-1.5 hover:bg-teal-50">Transfer</Link>
              <Link href="/supervisor/clinical-safety" className="text-[11px] text-center font-medium text-rose-700 border border-rose-200 rounded-lg px-2 py-1.5 hover:bg-rose-50">Escalate</Link>
              <Link href="/supervisor/operations?section=care" className="text-[11px] text-center font-medium text-gray-700 border border-gray-200 rounded-lg px-2 py-1.5 hover:bg-gray-50">Add task</Link>
            </div>
            <p className="text-[10px] text-gray-400 mt-2">Identity fields (MRN, age, sex, attending team) arrive via EMR integration — the operational registry holds no PHI.</p>
          </>
        )}
      </div>
    </div>
  );
}
