"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// SBAR builder + responsibility transfer per patient (HWW-HND-001 over the
// nurse-permitted handover API). Save writes the four SBAR fields to the open
// handover's item for this patient (created server-side if absent); accept is
// the INCOMING nurse taking responsibility; complete closes the transfer.
/* eslint-disable @typescript-eslint/no-explicit-any */

const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40";
const btn = "px-3.5 py-2 rounded-lg bg-[var(--cmp-color-success)] text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50";
const btnGhost = "px-2.5 py-1 rounded-lg border border-gray-300 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50";

const FIELDS = [
  { key: "situation", label: "S — Situation", ph: "Current status, why they are here, immediate issues" },
  { key: "background", label: "B — Background", ph: "Relevant history, admission context, key events this shift" },
  { key: "assessment", label: "A — Assessment", ph: "Your clinical read: acuity, PEWS trend, what is changing" },
  { key: "recommendation", label: "R — Recommendation", ph: "What the incoming nurse must do / watch / chase" },
] as const;

export default function SbarForm({ patientId, patientLabel, existing, itemStatus }: {
  patientId: string; patientLabel: string;
  existing: { situation?: string | null; background?: string | null; assessment?: string | null; recommendation?: string | null };
  itemStatus: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState<Record<string, string>>({
    situation: existing.situation ?? "", background: existing.background ?? "",
    assessment: existing.assessment ?? "", recommendation: existing.recommendation ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function act(body: any) {
    setBusy(true); setErr(null);
    const r = await fetch("/api/operations/handover", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(d.error ?? "Failed"); return; }
    setOpen(false);
    router.refresh();
  }

  const hasSbar = !!(existing.situation || existing.background || existing.assessment || existing.recommendation);

  return (
    <div className="mt-2">
      <div className="flex flex-wrap gap-1.5">
        <button className={btnGhost} onClick={() => setOpen(!open)}>{open ? "Close" : hasSbar ? "Edit SBAR" : "Write SBAR"}</button>
        {itemStatus !== "accepted" && itemStatus !== "completed" && hasSbar && (
          <button className={btnGhost} disabled={busy} title="Take over responsibility for this patient (incoming nurse)"
            onClick={() => act({ action: "accept", patient_id: patientId, patient_label: patientLabel })}>Accept handover</button>
        )}
        {itemStatus === "accepted" && (
          <button className={btnGhost} disabled={busy} onClick={() => act({ action: "complete", patient_id: patientId, patient_label: patientLabel })}>Mark completed</button>
        )}
      </div>
      {err && <p className="text-xs text-[var(--cmp-text-warning)] mt-1">{err}</p>}
      {open && (
        <div className="mt-2 border border-[var(--cmp-color-success)] bg-[var(--cmp-surface-success)]/30 rounded-lg p-3 space-y-2">
          {FIELDS.map(f => (
            <label key={f.key} className="block text-xs text-gray-600">
              <span className="font-semibold">{f.label}</span>
              <textarea className={`${input} min-h-[48px] mt-0.5`} placeholder={f.ph}
                value={vals[f.key]} onChange={e => setVals({ ...vals, [f.key]: e.target.value })} />
            </label>
          ))}
          <button className={btn} disabled={busy} onClick={() => act({ action: "save_sbar", patient_id: patientId, patient_label: patientLabel, ...vals })}>
            {busy ? "Saving…" : "Save SBAR"}
          </button>
        </div>
      )}
    </div>
  );
}
