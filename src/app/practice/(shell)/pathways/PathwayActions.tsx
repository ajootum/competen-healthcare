"use client";

import { useState } from "react";
import { PATHWAY_DEVIATIONS } from "@/lib/practice/pathways-constants";
import { BUTTON } from "@/lib/practice/palette";
import type { PatientPathwayView } from "@/lib/practice/pathways";

// CPR-FUP-003 s10 -- the deviations, as first-class buttons.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ SKIP, REPEAT, DELAY, CANCEL AND END-EARLY SIT BESIDE "COMPLETE", NOT BEHIND A WARNING.
//
// It is tempting to hide them: they look like the destructive half of the menu. But s2 says "not
// protocol enforcement" and "supports deviations" in the same breath as "practitioner-controlled", and
// a plan whose departures are one click harder than its happy path is a plan that quietly pushes people
// down the happy path. The patients who need a deviation are the ones the plan fits worst.
//
// WHAT IS ASKED FOR IS A REASON, AND ONLY A REASON. Every deviation requires one and the button will not
// submit without it -- the engine refuses it too. That is s10 and s14's requirement ("every deviation is
// audited"), and it is the only thing standing between a practitioner and any of these acts.
//
// COMPLETING NEEDS NO REASON. Doing what the plan expected is not a departure and does not owe anybody
// an explanation.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

const input = "w-full rounded-lg border border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 px-2.5 py-1.5 text-[12.5px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";

export default function PathwayActions({ pathway, canAssign }: {
  pathway: PatientPathwayView; canAssign: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [days, setDays] = useState(14);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  if (!canAssign || pathway.status !== "active") return null;

  async function send(payload: Record<string, unknown>) {
    setBusy(true); setError(null); setWarnings([]);
    const res = await fetch(`/api/v1/practice/pathways/assignments/${pathway.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data?.error?.message ?? "That did not work."); setBusy(false); return; }
    // ⚠ WARNINGS ARE SHOWN, NOT SWALLOWED. "The stage moved but its follow-up did not close" is a state
    // somebody has to know about; reloading on it silently would leave a live obligation nobody expects.
    const w = (data?.result?.warnings ?? []) as string[];
    if (w.length > 0) { setWarnings(w); setBusy(false); return; }
    window.location.reload();
  }

  const quiet = "rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[11.5px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50";
  const deviation = PATHWAY_DEVIATIONS.find(d => d.key === open);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        <button type="button" disabled={busy} onClick={() => send({ action: "complete" })}
          className={`rounded-lg px-2.5 py-1 text-[11.5px] font-semibold ${BUTTON.primary}`}>
          Complete this stage
        </button>
        {PATHWAY_DEVIATIONS.map(d => (
          <button key={d.key} type="button" title={d.blurb}
            onClick={() => { setReason(""); setError(null); setOpen(open === d.key ? null : d.key); }}
            className={quiet}>
            {d.label}
          </button>
        ))}
      </div>

      {error && <p className="text-[11.5px] text-[var(--cmp-text-critical)]">{error}</p>}
      {warnings.length > 0 && (
        <div className="rounded-lg bg-[var(--cmp-surface-warning)] px-2.5 py-1.5 text-[11.5px] text-[var(--cmp-text-warning)]">
          <p className="font-semibold">The move went through, but not everything did:</p>
          <ul className="mt-0.5 list-disc pl-4">{warnings.map(w => <li key={w}>{w}</li>)}</ul>
          <button type="button" onClick={() => window.location.reload()} className="mt-1 font-semibold underline">
            Reload and check
          </button>
        </div>
      )}

      {deviation && (
        <form
          className="rounded-lg border border-gray-200 bg-gray-50 p-2.5"
          onSubmit={e => {
            e.preventDefault();
            send(deviation.key === "delay"
              ? { action: "delay", days, reason }
              : { action: deviation.key === "stop" ? "stop" : deviation.key, reason });
          }}
        >
          <p className="text-[11.5px] leading-relaxed text-gray-600">{deviation.blurb}</p>
          {deviation.key === "delay" && (
            <label className="mt-1.5 flex items-center gap-2">
              <span className="text-[11.5px] font-semibold text-gray-600">Move it back by</span>
              <input type="number" min={1} max={3650} value={days} onChange={e => setDays(Number(e.target.value))}
                className="w-20 rounded-lg border border-gray-200 px-2 py-1 text-[12.5px]" />
              <span className="text-[11.5px] text-gray-500">days</span>
            </label>
          )}
          <label className="mt-1.5 flex flex-col gap-0.5">
            <span className="text-[11.5px] font-semibold text-gray-600">
              Why? &mdash; required, and this is the only thing that stops any of these actions
            </span>
            <input autoFocus value={reason} onChange={e => setReason(e.target.value)} className={input}
              placeholder="Seen at the referring hospital; this review is not needed" />
          </label>
          <div className="mt-2 flex gap-1.5">
            <button type="submit" disabled={busy || !reason.trim()}
              className={`rounded-lg px-2.5 py-1 text-[11.5px] font-semibold ${BUTTON.primary}`}>
              Confirm
            </button>
            <button type="button" onClick={() => setOpen(null)}
              className={`rounded-lg px-2.5 py-1 text-[11.5px] font-semibold ${BUTTON.quiet}`}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
