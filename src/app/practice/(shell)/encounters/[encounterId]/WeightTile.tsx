"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { WeightPromptState } from "@/lib/practice/encounter-workspace-constants";

// THE WEIGHT, AS A FIRST-CLASS CAPTURE ON THE CONSULTATION SCREEN.
//
// The user's requirement of 2026-08-08: "ensure that the weight is part of the data we collect." It was
// already collectable -- as one row among N in the clinical parameters panel -- and being collectable is
// not the same as being obvious. This tile puts it in the safety snapshot, above the fold, one action
// from empty to recorded, because the walkthrough path it sits on is: open the encounter, weigh the
// child, prescribe on the weight, sign.
//
// ⚠ IT IS A PROMPT AND NOT A GATE. The user's ruling, same day: "do not make it required, but prompt for
// it." Nothing in this file prevents anything. There is no disabled Finish button, no modal, no confirm
// step and no reason box demanding an explanation for skipping -- each of those is a requirement wearing
// a softer word. A practitioner reads this, ignores it, and signs. The reasoning is in
// encounter-workspace-constants.ts beside weightPrompt(), and it is the same reasoning the checklist work
// and the weight-decision work both reached: a step that cannot be skipped is one people satisfy with a
// typed-in guess, and a fabricated weight is indistinguishable from a measured one once it is in the
// record -- after which doseArithmetic multiplies by it in good faith.
//
// ⚠ FOUR STATES, AND THE THIRD IS THE ONE THAT IS EASY TO GET WRONG.
//
//   recorded       a weight was taken in THIS consultation. The figure, and nothing else.
//   prompt         weight is activated, none today. The input, and the consequence in plain words.
//   not_activated  the practice has not switched weight on. A SETUP answer, pointing at setup. Silent
//                  about the patient, because nothing here is a statement about the patient.
//   unreadable     the collection did not load. Explicitly not "no weight".
//
// ⚠ AND THE INPUT STARTS EMPTY, ALWAYS. Never `value={prior}`, never `defaultValue`, never a placeholder
// holding the last number. LCP s10.3's carry-forward prohibition is enforced by what this file does not
// do, exactly as it is in ParameterCollection -- and the parameters harness scans this file for it. A
// prior weight is rendered as dated history in text that is not an input, and the comp's own
// "Weight 22 kg (08 Aug 2025)" beside a live encounter is why: on 2026-08-08 that is a figure over a year
// old on a small child, drawn as a current safety fact.

// ⚠ CPR-MOB-001 s4/s16 — SIZE ONLY, AND THE PARAGRAPH ABOVE IS WHY THAT MATTERS HERE. This was the
// smallest field on the screen (px-1.5 py-1 at 12px is roughly a 26px target) and it is the number the
// dose calculator multiplies by. `max-md:` adds the 44px floor and the 16px size that stops iOS zooming
// on focus; it adds NO value, NO defaultValue and NO placeholder, so the carry-forward prohibition the
// harness scans this file for is untouched — a class cannot bind an input to a prior measurement.
const input = "w-full rounded border border-gray-200 px-1.5 py-1 text-[12px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10 max-md:min-h-[var(--cp-touch)] max-md:text-[16px]";

export default function WeightTile(props: {
  state: WeightPromptState;
  text: string;
  parameter: {
    definitionId: string;
    canonicalUnit: string | null;
    permittedUnits: string[];
    recorded: { value: string } | null;
    priorText: string | null;
    priorAt: string | null;
  } | null;
  patientId: string | null;
  encounterId: string;
  canRecord: boolean;
  locked: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState(props.parameter?.canonicalUnit ?? "kg");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (props.state === "unreadable") {
    return (
      <p className="text-[11px] font-semibold text-[var(--cmp-text-critical)]">{props.text}</p>
    );
  }

  // ⚠ A CONFIGURATION ANSWER, DRAWN AS ONE. No input, no empty box that looks like an unweighed patient,
  // and a link to the page where the fact can be changed.
  if (props.state === "not_activated") {
    return (
      <>
        <p className="text-[11px] text-gray-500">{props.text}</p>
        <Link href="/practice/setup/clinical-parameters"
          className="text-[10px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
          Clinical parameters setup →
        </Link>
      </>
    );
  }

  if (props.state === "recorded") {
    return (
      <>
        <p className="text-[13px] font-bold text-[var(--cmp-text-success)]">
          {props.parameter?.recorded?.value}
        </p>
        <p className="text-[10px] text-gray-500">{props.text}</p>
      </>
    );
  }

  // ── THE PROMPT ────────────────────────────────────────────────────────────────────────────────────
  const p = props.parameter;
  const units = p?.permittedUnits?.length ? p.permittedUnits : [p?.canonicalUnit ?? "kg"];

  return (
    <>
      <p className="text-[12px] font-semibold text-[var(--cmp-text-warning)]">Not recorded today</p>

      {/* ⚠ HISTORY, WITH ITS DATE, AND NOT IN THE BOX. */}
      {p?.priorText && (
        <p className="text-[10px] text-gray-500">
          Last: <span className="font-semibold">{p.priorText}</span>
          {p.priorAt ? ` ${p.priorAt.slice(0, 10)}` : ""}
          <span className="text-gray-400"> — not carried forward</span>
        </p>
      )}

      {props.locked ? (
        <p className="text-[10px] text-gray-400">This consultation is closed.</p>
      ) : !props.canRecord ? (
        <p className="text-[10px] text-gray-400">You do not hold permission to record a measurement.</p>
      ) : p && props.patientId ? (
        <>
          <div className="flex items-end gap-1">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Weight</span>
              {/* ⚠ EMPTY. See the header. */}
              <input className={input} value={value} inputMode="decimal" placeholder=""
                onChange={e => setValue(e.target.value)} />
            </label>
            <label>
              <span className="sr-only">Unit</span>
              <select className={`${input} w-[62px]`} value={unit} onChange={e => setUnit(e.target.value)}>
                {units.map(u => <option key={u} value={u ?? "kg"}>{u}</option>)}
              </select>
            </label>
            <button type="button" disabled={busy || value.trim() === ""}
              onClick={async () => {
                setBusy(true); setError(null);
                try {
                  const res = await fetch("/api/v1/practice/parameters", {
                    method: "POST", headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                      action: "record", patientId: props.patientId, definitionId: p.definitionId,
                      encounterId: props.encounterId, value, unit: unit || null, source: "practitioner",
                    }),
                  });
                  const json = await res.json().catch(() => ({}));
                  // ⚠ NEVER DISCARDED. A weight that silently failed to save is a weight the prescriber
                  // believes is in the record.
                  if (!res.ok) {
                    setError(json?.error?.message ?? json?.error ?? `That did not save (${res.status}).`);
                    return;
                  }
                  setValue("");
                  router.refresh();
                } catch (e) {
                  setError(e instanceof Error ? e.message : "That did not save.");
                } finally { setBusy(false); }
              }}
              className="shrink-0 rounded bg-[var(--cp-primary)] px-2 py-1 text-[11px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50">
              {busy ? "…" : "Save"}
            </button>
          </div>
          {error && (
            <p className="rounded bg-[var(--cmp-surface-critical)] px-1.5 py-1 text-[10px] font-semibold text-[var(--cmp-text-critical)]">
              {error}
            </p>
          )}
        </>
      ) : null}

      {/* ⚠ THE CONSEQUENCE, NOT AN ASTERISK. Saying what a missing weight actually costs is a better
          motivator than marking the field required, and it is true rather than coercive. */}
      <p className="text-[10px] leading-snug text-gray-500">{props.text}</p>
    </>
  );
}
