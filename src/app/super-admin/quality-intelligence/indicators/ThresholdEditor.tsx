"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// QIE-011 — no-code threshold configuration, editing the columns that already drive the dashboards.
//
// Not a rule builder. The thresholds are three numbers on pa_kpis, and the honest "no-code" surface for
// three numbers is three inputs — a drag-and-drop rule canvas over `target`, `threshold_amber` and
// `threshold_red` would be ceremony around an integer.
//
// The direction hint is shown rather than assumed, because which of amber/red is the larger number
// depends on whether lower is better, and getting it backwards means the indicator silently stops
// reporting breaches. The server refuses that pair; this says so before the user tries.

export default function ThresholdEditor({
  id, name, direction, target, amber, red,
}: { id: string; name: string; direction: string | null; target: number | null; amber: number | null; red: number | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [t, setT] = useState(target?.toString() ?? "");
  const [a, setA] = useState(amber?.toString() ?? "");
  const [r, setR] = useState(red?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const lowerBetter = direction === "lower_better";

  async function save() {
    setBusy(true); setErr(null);
    const body = {
      target: t.trim() === "" ? null : Number(t),
      threshold_amber: a.trim() === "" ? null : Number(a),
      threshold_red: r.trim() === "" ? null : Number(r),
    };
    const res = await fetch(`/api/qie/indicators?id=${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setErr(json.error ?? "Could not save."); return; }
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-[10px] text-[var(--cmp-text-information)] hover:underline whitespace-nowrap">
        {target === null && amber === null && red === null ? "set thresholds" : "edit"}
      </button>
    );
  }

  const field = (label: string, v: string, set: (s: string) => void) => (
    <label className="flex flex-col gap-0.5">
      <span className="text-[9px] text-gray-500 uppercase tracking-wide">{label}</span>
      <input value={v} onChange={e => set(e.target.value)} inputMode="decimal" placeholder="—"
        className="w-16 text-[11px] border border-gray-200 rounded px-1.5 py-1 bg-white tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-500/30" />
    </label>
  );

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-2 mt-1 min-w-[240px]">
      <p className="text-[10px] text-gray-500 mb-1.5 truncate" title={name}>{name}</p>
      <div className="flex items-end gap-2 flex-wrap">
        {field("Target", t, setT)}
        {field("Amber", a, setA)}
        {field("Red", r, setR)}
        <button onClick={save} disabled={busy}
          className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-50">
          {busy ? "…" : "Save"}
        </button>
        <button onClick={() => { setOpen(false); setErr(null); }}
          className="text-[11px] px-2 py-1 rounded-lg border border-gray-200 bg-white hover:bg-gray-50">Cancel</button>
      </div>
      <p className="text-[9px] text-gray-500 mt-1.5">
        {lowerBetter
          ? "Lower is better — red must be at or above amber."
          : "Higher is better — red must be at or below amber."}{" "}
        Leave blank to clear.
      </p>
      {err && <p className="text-[10px] text-[var(--cmp-text-error)] mt-1">{err}</p>}
    </div>
  );
}
