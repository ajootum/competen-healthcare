"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// CGR-028 — service-profile authoring (migration 151). Requirements are picked from the REAL competency library
// (ids are true FKs — same discipline as the propose-link form) with min-staff, min-level and a critical toggle.
// Profiles are created as DRAFTS; a separate governance act (Activate) puts them in front of the gate, and the
// gate never evaluates drafts.

type Competency = { id: string; name: string };
type Row = { competency_id: string; min_staff: number; min_level: string; is_critical: boolean };

const LEVELS = [
  { v: "", l: "Any (competent outcome)" },
  { v: "competent", l: "Competent" },
  { v: "proficient", l: "Proficient" },
  { v: "expert", l: "Expert" },
];
const blank = (): Row => ({ competency_id: "", min_staff: 1, min_level: "", is_critical: false });

export function ProfileBuilder({ competencies }: { competencies: Competency[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [rows, setRows] = useState<Row[]>([blank()]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const chosen = new Set(rows.map((r) => r.competency_id).filter(Boolean));
  const valid = name.trim().length > 0 && rows.length > 0 && rows.every((r) => r.competency_id);

  async function submit() {
    setBusy(true); setErr(null); setOk(false);
    const res = await fetch("/api/cgr/service-profiles", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), code: code.trim() || undefined, requirements: rows.map((r) => ({ competency_id: r.competency_id, min_staff: r.min_staff, min_level: r.min_level || undefined, is_critical: r.is_critical })) }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || j.ok === false) { setErr(j.error ?? "Failed to create profile"); return; }
    setOk(true); setName(""); setCode(""); setRows([blank()]); setOpen(false); router.refresh();
  }

  const input = "border border-gray-200 rounded-md px-2 py-1.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-emerald-500/30 bg-white";

  if (!open) {
    return (
      <div className="flex items-center gap-2">
        <button onClick={() => setOpen(true)} className="text-[11px] font-semibold text-emerald-700 border border-[var(--cmp-color-success)] bg-[var(--cmp-surface-success)] hover:bg-[var(--cmp-surface-success)] rounded-lg px-3 py-1.5 transition-colors">+ Define a service profile</button>
        {ok && <span className="text-[11px] text-[var(--cmp-text-success)] font-medium">Profile created as draft — activate it to start gating.</span>}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-[var(--cmp-color-success)] p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-bold text-gray-800">Define a service profile</p>
        <button onClick={() => setOpen(false)} className="text-[11px] text-gray-400 hover:text-gray-600">Close</button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Service name (e.g. Adult ICU Service)" className={`${input} sm:col-span-2`} />
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code (e.g. SVC-ICU-001)" className={input} />
      </div>

      <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Required competencies</p>
      <div className="space-y-1.5 mb-2">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-1.5 flex-wrap">
            <select value={r.competency_id} onChange={(e) => setRow(i, { competency_id: e.target.value })} className={`${input} flex-1 min-w-[220px]`}>
              <option value="">Select a competency…</option>
              {competencies.map((c) => <option key={c.id} value={c.id} disabled={chosen.has(c.id) && r.competency_id !== c.id}>{c.name}</option>)}
            </select>
            <input type="number" min={1} value={r.min_staff} onChange={(e) => setRow(i, { min_staff: Math.max(1, Number(e.target.value) || 1) })} className={`${input} w-16`} title="Minimum staff who must hold it" />
            <select value={r.min_level} onChange={(e) => setRow(i, { min_level: e.target.value })} className={input}>
              {LEVELS.map((l) => <option key={l.v} value={l.v}>{l.l}</option>)}
            </select>
            <label className="flex items-center gap-1 text-[11px] text-gray-600 cursor-pointer">
              <input type="checkbox" checked={r.is_critical} onChange={(e) => setRow(i, { is_critical: e.target.checked })} /> critical
            </label>
            {rows.length > 1 && <button onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="text-[11px] text-gray-300 hover:text-rose-500">✕</button>}
          </div>
        ))}
      </div>
      <button onClick={() => setRows((rs) => [...rs, blank()])} className="text-[11px] text-[var(--cmp-text-success)] hover:underline mb-3">+ add requirement</button>

      <div className="flex items-center gap-2">
        <button onClick={submit} disabled={!valid || busy} className="text-[11px] font-semibold text-white bg-[var(--cmp-color-success)] hover:bg-emerald-700 disabled:opacity-40 disabled:hover:bg-[var(--cmp-color-success)] rounded-lg px-3 py-1.5 transition-colors">{busy ? "Creating…" : "Create draft profile"}</button>
        <span className="text-[10px] text-gray-400">Created as draft — activation is a separate governance act. Unmet critical requirements block activation readiness.</span>
        {err && <span className="text-[11px] text-[var(--cmp-text-error)] font-medium">{err}</span>}
      </div>
    </div>
  );
}

export function ProfileStatus({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function set(next: string) {
    setBusy(true); setErr(null);
    const res = await fetch("/api/cgr/service-profiles", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status: next }) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || j.ok === false) { setErr(j.error ?? "Failed"); return; }
    router.refresh();
  }

  const btn = "text-[10px] font-semibold border rounded px-1.5 py-0.5 disabled:opacity-40 transition-colors";
  return (
    <span className="inline-flex items-center gap-1">
      {status === "draft" && <button onClick={() => set("active")} disabled={busy} className={`${btn} text-emerald-700 border-[var(--cmp-color-success)] hover:bg-[var(--cmp-surface-success)]`}>{busy ? "…" : "Activate"}</button>}
      {status === "active" && <button onClick={() => set("retired")} disabled={busy} className={`${btn} text-gray-500 border-gray-200 hover:bg-gray-50`}>{busy ? "…" : "Retire"}</button>}
      {err && <span className="text-[10px] text-[var(--cmp-text-error)]">{err}</span>}
    </span>
  );
}
