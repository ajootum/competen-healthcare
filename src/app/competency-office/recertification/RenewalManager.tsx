"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

// COMP-020 — the recertification worklist + renewal tracker. For an expiring item without a renewal, open one on a
// chosen path (POST /api/competency/renewals). For a renewal in flight, advance its status
// (in_progress → reassessment → completed, or lapse it) via PATCH /api/competency/renewals?id=. Mirrors the
// EquivalencyManager interaction pattern: optimistic-free, router.refresh() after each successful write.
/* eslint-disable @typescript-eslint/no-explicit-any */

const PATHS: { key: string; label: string }[] = [
  { key: "assessment", label: "Reassessment" },
  { key: "evidence", label: "Evidence portfolio" },
  { key: "simulation", label: "Simulation" },
  { key: "continuing_education", label: "Continuing education" },
  { key: "practice_observation", label: "Practice observation" },
  { key: "portfolio", label: "Portfolio review" },
  { key: "mixed", label: "Mixed pathway" },
];

const BAND_TONE: Record<string, string> = { rose: "bg-rose-100 text-rose-700", amber: "bg-amber-100 text-amber-700", blue: "bg-blue-100 text-blue-700", slate: "bg-gray-100 text-gray-600" };
const STATUS_TONE: Record<string, string> = { pending: "bg-gray-100 text-gray-600", in_progress: "bg-blue-100 text-blue-700", reassessment: "bg-violet-100 text-violet-700", completed: "bg-emerald-100 text-emerald-700", lapsed: "bg-rose-100 text-rose-700" };
const NEXT: Record<string, string | null> = { pending: "in_progress", in_progress: "reassessment", reassessment: "completed", completed: null, lapsed: null };
const NEXT_LABEL: Record<string, string> = { in_progress: "Start work", reassessment: "To reassessment", completed: "Mark renewed" };

type WorklistItem = { person: string; personId: string | null; subject: string; subjectId: string | null; type: string; expiry_date: string; daysLeft: number; band: string; bandLabel: string; bandTone: string; hasRenewal: boolean };
type Renewal = { id: string; status: string; renewalPath: string; pathLabel: string; subject: string; person: string; expiry_date: string | null; inFlight: boolean; subjectType: string; subjectId: string | null };

export default function RenewalManager({ worklist, renewals, worklistTotal }: { worklist: WorklistItem[]; renewals: Renewal[]; worklistTotal: number }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const done = () => router.refresh();
  const activeCount = renewals.filter(r => r.inFlight).length;

  return (
    <div className="space-y-3">
      {err && <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-3 py-2 text-[12px]">{err}</div>}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[12px] font-semibold text-gray-700">Expiring worklist</p>
            <p className="text-[11px] text-gray-400">{worklist.length} shown{worklistTotal > worklist.length ? ` of ${worklistTotal}` : ""}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-50 max-h-[540px] overflow-y-auto">
            {worklist.length === 0 && <p className="text-sm text-gray-400 p-6 text-center">Nothing expiring within 90 days. This populates from professional certifications and current competency decisions that carry an expiry date.</p>}
            {worklist.map((it, i) => <WorklistRow key={`${it.subjectId ?? "x"}-${i}`} item={it} onErr={setErr} onDone={done} />)}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[12px] font-semibold text-gray-700">Renewals</p>
            <p className="text-[11px] text-gray-400">{activeCount} in flight · {renewals.length} total</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-50 max-h-[540px] overflow-y-auto">
            {renewals.length === 0 && <p className="text-sm text-gray-400 p-6 text-center">No renewals opened yet. Start one from the worklist to track it through to completion.</p>}
            {renewals.map(r => <RenewalRow key={r.id} r={r} onErr={setErr} onDone={done} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

function WorklistRow({ item, onErr, onDone }: { item: WorklistItem; onErr: (s: string | null) => void; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState("assessment");
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true); onErr(null);
    try {
      const body: any = { subject_type: item.type, subject_id: item.subjectId, subject_name: item.subject, nurse_id: item.personId, nurse_name: item.person, expiry_date: item.expiry_date, renewal_path: path };
      const res = await fetch("/api/competency/renewals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); onErr(j.error ?? `Error ${res.status}`); return; }
      setOpen(false); onDone();
    } catch { onErr("Network error"); } finally { setBusy(false); }
  }

  return (
    <div className="p-2.5 text-[12px]">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-gray-800 font-medium truncate">{item.subject}</p>
          <p className="text-gray-400 text-[11px] truncate">{item.person} · {item.type}</p>
        </div>
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${BAND_TONE[item.bandTone] ?? "bg-gray-100 text-gray-600"}`}>{item.daysLeft < 0 ? `${Math.abs(item.daysLeft)}d overdue` : `${item.daysLeft}d left`}</span>
        {item.hasRenewal
          ? <span className="text-[10px] text-emerald-600 whitespace-nowrap">renewal open</span>
          : <button onClick={() => setOpen(v => !v)} className="text-[11px] bg-teal-600 text-white rounded-lg px-2.5 py-1 hover:bg-teal-700 whitespace-nowrap">{open ? "Close" : "Start renewal"}</button>}
      </div>
      {open && !item.hasRenewal && (
        <div className="mt-2 flex items-center gap-1.5">
          <select value={path} onChange={e => setPath(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1 text-[11px] flex-1 min-w-0">
            {PATHS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
          <button disabled={busy} onClick={start} className="text-[11px] bg-gray-800 text-white rounded-lg px-3 py-1 disabled:opacity-40 whitespace-nowrap">Open renewal</button>
        </div>
      )}
    </div>
  );
}

function RenewalRow({ r, onErr, onDone }: { r: Renewal; onErr: (s: string | null) => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const next = NEXT[r.status];

  async function advance(status: string) {
    setBusy(true); onErr(null);
    try {
      const res = await fetch(`/api/competency/renewals?id=${r.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); onErr(j.error ?? `Error ${res.status}`); return; }
      onDone();
    } catch { onErr("Network error"); } finally { setBusy(false); }
  }

  return (
    <div className="p-2.5 text-[12px]">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-gray-800 font-medium truncate">{r.subject}</p>
          <p className="text-gray-400 text-[11px] truncate">{r.person} · {r.pathLabel}</p>
        </div>
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${STATUS_TONE[r.status] ?? "bg-gray-100 text-gray-600"}`}>{r.status.replace(/_/g, " ")}</span>
      </div>
      {r.inFlight && (
        <div className="mt-2 flex items-center gap-1.5">
          {next && <button disabled={busy} onClick={() => advance(next)} className="text-[11px] bg-teal-600 text-white rounded-lg px-2.5 py-1 hover:bg-teal-700 disabled:opacity-40 whitespace-nowrap">{NEXT_LABEL[next]}</button>}
          <button disabled={busy} onClick={() => advance("lapsed")} className="text-[11px] text-rose-500 hover:text-rose-700 border border-rose-200 rounded-lg px-2.5 py-1 disabled:opacity-40">Lapse</button>
        </div>
      )}
    </div>
  );
}
