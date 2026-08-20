"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/* eslint-disable @typescript-eslint/no-explicit-any */
const DOMAINS = [
  { v: "professionalism", label: "Professionalism" }, { v: "communication", label: "Communication" }, { v: "teamwork", label: "Teamwork" },
  { v: "leadership", label: "Leadership" }, { v: "ethics", label: "Ethics" }, { v: "patient_centred", label: "Patient-Centred Care" },
  { v: "cultural", label: "Cultural Competence" }, { v: "accountability", label: "Accountability" },
];
const SCALES = [{ v: "bars", label: "BARS" }, { v: "likert5", label: "5-point Likert" }, { v: "likert3", label: "3-point" }, { v: "binary", label: "Binary" }, { v: "global", label: "Global rating" }];
const domLabel = (d: string) => DOMAINS.find(x => x.v === d)?.label ?? d;
const STATUS_TONE: Record<string, string> = { draft: "text-gray-500 bg-gray-50 border-gray-200", active: "text-teal-600 bg-teal-50 border-teal-200", archived: "text-gray-500 bg-gray-50 border-gray-200" };

export default function BehaviourManager({ assessments }: { assessments: any[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [scale, setScale] = useState("bars");
  const [open, setOpen] = useState<string | null>(null);
  const [domain, setDomain] = useState("professionalism");
  const [statement, setStatement] = useState("");
  const [pos, setPos] = useState("");
  const [neg, setNeg] = useState("");
  const [critical, setCritical] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const call = async (url: string, opts: RequestInit) => { setBusy(true); const r = await fetch(url, opts); setBusy(false); if (!r.ok) { const j = await r.json().catch(() => ({})); setErr(j.error ?? "Request failed."); return false; } setErr(null); router.refresh(); return true; };

  async function create() {
    if (!name.trim()) { setErr("Name the assessment."); return; }
    if (await call("/api/studio/behaviour", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, rating_scale: scale }) })) { setName(""); setScale("bars"); }
  }
  const setStatus = (id: string, status: string) => call(`/api/studio/behaviour?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
  const del = (id: string) => call(`/api/studio/behaviour?id=${id}`, { method: "DELETE" });
  const removeI = (iid: string) => call(`/api/studio/behaviour/indicators?id=${iid}`, { method: "DELETE" });
  async function addI(aid: string) {
    if (!statement.trim()) { setErr("Enter a behaviour statement."); return; }
    if (await call("/api/studio/behaviour/indicators", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assessment_id: aid, domain, statement, positive_anchor: pos, negative_anchor: neg, is_critical: critical }) })) { setStatement(""); setPos(""); setNeg(""); setCritical(false); }
  }

  const inp = "text-xs border border-gray-200 rounded-lg px-2.5 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-teal-400";

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <h2 className="font-semibold text-gray-900 text-sm mb-3">New behaviour assessment</h2>
        <div className="flex flex-col sm:flex-row gap-2">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Assessment name (e.g. Professionalism Framework)" className={`${inp} flex-1`} />
          <select value={scale} onChange={e => setScale(e.target.value)} className={`${inp} sm:w-44`}>{SCALES.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}</select>
          <button onClick={create} disabled={busy} className="text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 rounded-lg px-4 py-2 whitespace-nowrap">{busy ? "…" : "Create"}</button>
        </div>
        {err && <p className="text-[11px] text-[var(--cmp-text-critical)] mt-1">{err}</p>}
      </div>

      {assessments.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-6 text-center text-xs text-gray-500">No behaviour assessments yet — create one, then add observable behaviour indicators across the professional domains.</div>
      ) : assessments.map((a: any) => (
        <div key={a.id} className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setOpen(open === a.id ? null : a.id)} className="text-sm font-bold text-gray-900 hover:text-teal-700">{open === a.id ? "▾" : "▸"} {a.name}</button>
            <span className="text-[10px] font-semibold text-gray-500 bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5">{a.scaleLabel}</span>
            <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${STATUS_TONE[a.status] ?? STATUS_TONE.draft}`}>{a.status}</span>
            <div className="ml-auto flex items-center gap-2 text-xs text-gray-500">
              <span>{a.indicators.length} indicator{a.indicators.length === 1 ? "" : "s"} · {a.domains} domain{a.domains === 1 ? "" : "s"}</span>
              {a.critical > 0 && <span className="text-[var(--cmp-text-critical)]">{a.critical} critical</span>}
              <button onClick={() => del(a.id)} disabled={busy} className="text-gray-500 hover:text-red-500" title="Delete">✕</button>
            </div>
          </div>

          {open === a.id && (
            <div className="mt-3 ml-4 border-l-2 border-gray-50 pl-3">
              {a.indicators.length > 0 && (
                <div className="flex flex-col divide-y divide-gray-50 mb-2 max-h-72 overflow-y-auto">
                  {a.indicators.map((i: any) => (
                    <div key={i.id} className="flex items-start gap-2 py-1.5 text-xs">
                      <span className="text-[9px] font-semibold text-gray-500 bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5 shrink-0 mt-0.5 w-28 text-center">{domLabel(i.domain)}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-gray-800">{i.statement} {i.critical && <span className="text-[9px] font-bold text-[var(--cmp-text-critical)]">CRITICAL</span>}</p>
                        {(i.positive || i.negative) && <p className="text-[10px] text-gray-500">{i.positive ? `＋ ${i.positive}` : ""}{i.positive && i.negative ? "  ·  " : ""}{i.negative ? `− ${i.negative}` : ""}</p>}
                      </div>
                      <button onClick={() => removeI(i.id)} disabled={busy} className="text-gray-500 hover:text-red-500 shrink-0" title="Remove">✕</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex flex-col gap-2 bg-gray-50/60 rounded-lg p-2.5">
                <div className="flex flex-col sm:flex-row gap-2">
                  <select value={domain} onChange={e => setDomain(e.target.value)} className={`${inp} sm:w-44`}>{DOMAINS.map(d => <option key={d.v} value={d.v}>{d.label}</option>)}</select>
                  <input value={statement} onChange={e => setStatement(e.target.value)} placeholder="Observable behaviour statement" className={`${inp} flex-1`} />
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input value={pos} onChange={e => setPos(e.target.value)} placeholder="Positive anchor (optional)" className={`${inp} flex-1`} />
                  <input value={neg} onChange={e => setNeg(e.target.value)} placeholder="Negative anchor (optional)" className={`${inp} flex-1`} />
                  <label className="flex items-center gap-1.5 text-[11px] text-gray-600 shrink-0"><input type="checkbox" checked={critical} onChange={e => setCritical(e.target.checked)} /> Critical</label>
                  <button onClick={() => addI(a.id)} disabled={busy} className="text-xs font-semibold text-teal-700 border border-teal-200 bg-teal-50 hover:bg-teal-100 rounded-lg px-3 py-2 whitespace-nowrap">Add indicator</button>
                </div>
              </div>
              {a.indicators.length > 0 && a.status !== "active" && <button onClick={() => setStatus(a.id, "active")} disabled={busy} className="mt-2 text-[11px] font-semibold text-teal-700 hover:underline">Activate →</button>}
              {a.status === "active" && <button onClick={() => setStatus(a.id, "archived")} disabled={busy} className="mt-2 text-[11px] font-semibold text-gray-500 hover:underline">Archive</button>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
