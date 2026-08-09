"use client";

import { useCallback, useState } from "react";
import { BUTTON } from "@/lib/practice/palette";
import { startEncounterFor } from "@/lib/practice/encounter-start";

// CPR-FLOW-001 -- "start a consultation for THIS patient", on a screen that already knows who they are.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE DEFECT THIS EXISTS TO CLOSE, WHICH IS THE BOARD'S DEFECT ONE LAYER IN.
//
// "+ Start encounter" on the encounters board was a link to /practice/patients: a control named for a
// clinical act that was really a change of page, landing on a register that did not know why anybody
// had arrived. That one is fixed -- the picker opens over the board.
//
// The longitudinal record at /practice/encounters/record/{patientId} had the same control and a worse
// version of the same defect. It offered "Start an encounter for this patient" and navigated to the
// patient's page, because the real action lived there. But the patient is IN THE URL of the screen you
// are standing on: there was nothing to work out, and it sent you away to find somebody whose record was
// open in front of you.
//
// WHY A COMPONENT RATHER THAN A FOURTH COPY OF THE ACT. The defence written against building it in place
// was sound -- "a second implementation beside it is a second place for the resume-before-create rule to
// be got wrong" -- and it was already too late: there were three implementations and they had drifted.
// The rule is now startEncounterFor(), in the module the harness runs; this file is what a practitioner
// presses, and it holds no rule of its own.
//
// WHAT IT DOES NOT DO: gate itself. `encounter.create` is checked by the SERVER component that mounts
// this, and a caller without it renders nothing at all -- hidden, not disabled, because a greyed-out
// button is still an offer and the person it is offered to is the one who cannot take it.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type ActionNotice = { kind: "ok" | "err"; text: string };

/**
 * Everything the control draws, as a function of its props.
 *
 * SEPARATED FROM THE STATE BELOW IT, the same way StartEncounterPanel is, so that the busy sentence and
 * the refusal are branches a harness can render rather than states only a browser can reach.
 */
export function StartEncounterActionView({
  label, note, busy, notice, disabled, tone = "primary", compact, onStart,
}: {
  label: string;
  /** Small print under the button. The resume promise belongs here, next to the act it describes. */
  note?: string;
  busy: boolean;
  /** Rendered here only when the caller did not take the notice for itself. */
  notice: ActionNotice | null;
  disabled?: boolean;
  tone?: "primary" | "secondaryAction";
  /** Sits in a row beside other buttons rather than owning its block. Height only -- not a quieter act. */
  compact?: boolean;
  onStart: () => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={busy || disabled}
        onClick={onStart}
        className={`rounded-lg px-3 text-[13px] font-semibold ${compact ? "py-1.5" : "py-2"} ${BUTTON[tone]}`}
      >
        {busy ? "Opening the consultation…" : label}
      </button>
      {note && <p className="text-[10px] text-gray-400">{note}</p>}
      {notice && (
        <p className={`rounded-lg px-2.5 py-1.5 text-[11px] ${notice.kind === "ok"
          ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]"
          : "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"}`}>
          {notice.text}
        </p>
      )}
    </div>
  );
}

export default function StartEncounterAction({
  patientId, label = "Start encounter", note, disabled, tone, compact, onNotice, onBusy,
}: {
  patientId: string;
  label?: string;
  note?: string;
  disabled?: boolean;
  tone?: "primary" | "secondaryAction";
  compact?: boolean;
  /** Given by a caller that already draws a notice area of its own, so the screen has one, not two. */
  onNotice?: (n: ActionNotice) => void;
  /** Given by a caller whose other buttons must go quiet while this one is working. */
  onBusy?: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<ActionNotice | null>(null);

  const start = useCallback(async () => {
    setBusy(true); onBusy?.(true);
    setNotice(null);
    const report = (n: ActionNotice) => { if (onNotice) onNotice(n); else setNotice(n); };
    try {
      const r = await startEncounterFor(patientId);
      // ⚠ THE FAILURE IS SAID AND THE PAGE DOES NOT MOVE. Every refusal startEncounterFor returns is
      // one somebody has to act on -- reload, or open a different record -- and a control that navigates
      // on failure is the defect this component was built to remove, inverted.
      if (!r.ok) { report({ kind: "err", text: r.message }); return; }
      window.location.assign(`/practice/encounters/${r.encounterId}`);
    } finally {
      setBusy(false); onBusy?.(false);
    }
  }, [patientId, onNotice, onBusy]);

  return (
    <StartEncounterActionView
      label={label} note={note} busy={busy} disabled={disabled} tone={tone} compact={compact}
      notice={onNotice ? null : notice}
      onStart={() => void start()}
    />
  );
}
