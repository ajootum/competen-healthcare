"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { tintedCard, tintedChip, tintedFigure } from "@/lib/practice/palette";
import {
  CATEGORY_HUE, CATEGORY_HUE_UNKEYED, CATEGORY_ICON, THRESHOLD_TONE, DUE_TONE,
  MEASUREMENT_SOURCES,
} from "@/lib/practice/parameters-constants";
import type { EncounterCollection, EncounterParameter } from "@/lib/practice/parameters";

// CPR-LCP-001 s10.3 -- ENCOUNTER WORKSPACE: COLLECTION DURING A VISIT.
//
// s10.3 names four things and this panel is those four:
//   "Only due, required and contextually relevant parameters shown first
//    Optional parameters accessible without clutter
//    One-click carry-forward is prohibited for measured values
//    Clear distinction between measured, patient-reported, imported and calculated values"
//
// ⚠ THE THIRD IS THE ONE WITH TEETH, AND IT IS ENFORCED BY WHAT THIS COMPONENT DOES NOT DO.
//
// There is no "same as last time" button, no defaultValue drawn from a prior measurement, and no
// prefilled input anywhere below. The patient's last value is rendered as HISTORY, with its date, in
// text that is not an input -- because a weight nobody weighed, sitting in a box that looks like it was
// typed, is the anti-pattern that fills a chart with fiction and then doses off it.
//
// The only value the form shows as filled in is one recorded IN THIS ENCOUNTER, which came from
// somebody typing it here.
//
// ⚠ AND THE HIDDEN-BUT-REQUIRED PARAMETER APPEARS. The engine unions the safety list into the visible
// set rather than intersecting it, so LCP s9's "Patient-level hiding of weight must not suppress a
// medication-triggered safety requirement" holds at the point of collection and not only on the plan.
//
// ⚠ TYPE-ONLY IMPORT FROM THE ENGINE -- see the note in MonitoringPlanPanel.tsx.

const CARD = "rounded-xl border border-gray-200 bg-white p-4";
// CPR-MOB-001 s4/s16 — this panel is the measurements step of the encounter flow, so it is one of the
// first things touched in a consultation and it is almost entirely numeric entry. 44px targets and the
// 16px field size that stops iOS zooming the page on focus; every suffix is `max-md:` and therefore
// inert at md and up, so the desktop panel is unchanged and the carry-forward prohibition (LCP s10.3,
// which is about what a field is BOUND to) is untouched by a class edit.
const input = "w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10 max-md:min-h-[var(--cp-touch)] max-md:text-[16px]";
const BTN = "rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50 max-md:inline-flex max-md:min-h-[var(--cp-touch-primary)] max-md:items-center max-md:justify-center max-md:px-4 max-md:text-[14px]";
const QUIET = "rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 max-md:inline-flex max-md:min-h-[var(--cp-touch)] max-md:items-center max-md:justify-center max-md:px-3.5 max-md:text-[12.5px]";

const hueOf = (c: string) => CATEGORY_HUE[c] ?? CATEGORY_HUE_UNKEYED;

const REASON_LABEL: Record<string, { label: string; chip: string }> = {
  safety_required: { label: "Required for safety", chip: "bg-rose-200 text-rose-900" },
  overdue: { label: "Overdue", chip: "bg-rose-100 text-rose-800" },
  due_today: { label: "Due today", chip: "bg-cyan-100 text-cyan-800" },
  required: { label: "Required", chip: "bg-amber-100 text-amber-800" },
  every_visit: { label: "Every visit", chip: "bg-[var(--cp-primary)]/12 text-[var(--cp-primary-deep)]" },
  encounter_addition: { label: "Added for today", chip: "bg-violet-100 text-violet-700" },
  optional: { label: "Optional", chip: "bg-slate-100 text-slate-600" },
};

export default function ParameterCollection({ collection, locked }: {
  collection: EncounterCollection; locked: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [showOptional, setShowOptional] = useState(false);
  const [values, setValues] = useState<Record<string, { value: string; unit: string; source: string }>>({});

  async function post(body: Record<string, unknown>, okText: string) {
    setBusy(true); setNotice(null);
    try {
      const res = await fetch("/api/v1/practice/parameters", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ kind: "err", text: json?.error?.message ?? json?.error ?? `Request failed (${res.status})` });
        return false;
      }
      setNotice({ kind: "ok", text: okText });
      router.refresh();
      return true;
    } catch (e) {
      setNotice({ kind: "err", text: e instanceof Error ? e.message : "Request failed" });
      return false;
    } finally { setBusy(false); }
  }

  if (!collection.permitted) {
    return (
      <section className={CARD}>
        <h2 className="text-[13px] font-bold text-gray-900">Clinical parameters</h2>
        <p className="mt-1 text-[12px] text-gray-600">
          You do not have the <code className="rounded bg-gray-100 px-1">parameter.view</code> capability.
          That is a permissions answer, not an empty collection form.
        </p>
      </section>
    );
  }

  if (collection.unavailable) {
    return (
      <section className="rounded-xl border border-rose-300 bg-rose-50 p-4">
        <h2 className="text-[13px] font-bold text-rose-900">The parameters for this visit could not be read</h2>
        <p className="mt-1 text-[12px] leading-relaxed text-rose-800">
          This is <strong>not</strong> an empty collection form. Something this patient is monitored for
          may be due, and this screen cannot tell you which.
        </p>
        {collection.detail && <p className="mt-1.5 font-mono text-[11px] text-rose-700">{collection.detail}</p>}
      </section>
    );
  }

  const recordedCount = [...collection.priority, ...collection.optional]
    .filter(e => e.recordedThisEncounter !== null).length;

  const row = (e: EncounterParameter) => {
    const hue = hueOf(e.category);
    const tone = THRESHOLD_TONE[e.threshold.state] ?? THRESHOLD_TONE.unreadable;
    const due = DUE_TONE[e.due.state] ?? DUE_TONE.unreadable;
    const reason = REASON_LABEL[e.reasonShown] ?? REASON_LABEL.optional;
    const done = e.recordedThisEncounter;
    // ⚠ THE INPUT STARTS EMPTY. Never `?? e.latest.value`. See the header.
    const v = values[e.definitionId] ?? { value: "", unit: e.canonicalUnit ?? "", source: "practitioner" };

    return (
      <li key={e.definitionId} className="rounded-lg border p-3" style={tintedCard(hue)}>
        <div className="flex flex-wrap items-start gap-2">
          <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[12px]"
            style={tintedChip(hue)}>{CATEGORY_ICON[e.category] ?? "•"}</span>

          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-bold text-gray-900">
              {e.label}
              {e.canonicalUnit && <span className="font-normal text-gray-500">({e.canonicalUnit})</span>}
              <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${reason.chip}`}>
                {reason.label}
              </span>
              {/* ⚠ s9: hidden on the plan, demanded here. The chip says both, or it says nothing useful. */}
              {e.resurfacedForSafety && (
                <span className="rounded bg-rose-200 px-1.5 py-0.5 text-[9px] font-bold uppercase text-rose-900"
                  title={e.safetyRequiredReason ?? undefined}>
                  {e.state} on the plan, still required
                </span>
              )}
            </p>

            <p className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <span className={`rounded px-1.5 py-0.5 text-[9.5px] font-semibold ${tone.chip}`} title={e.threshold.text}>
                <span aria-hidden className="mr-0.5">{tone.mark}</span>{tone.label}
              </span>
              <span className={`rounded px-1.5 py-0.5 text-[9.5px] font-semibold ${due.chip}`} title={e.due.text}>
                {due.label}
              </span>
            </p>

            {/* ⚠ HISTORY, NOT A DEFAULT. Rendered as text beside the empty box on purpose. */}
            <p className="mt-1 text-[10.5px] text-gray-600">
              {e.value.state === "value" ? (
                <>
                  Last: <span className="font-semibold" style={tintedFigure(hue)}>{e.value.text}</span>
                  <span className="ml-1 rounded bg-white/70 px-1 py-0.5 text-[9px] font-semibold text-gray-600">
                    {e.value.provenanceLabel}
                  </span>
                  {e.lastMeasuredAt && <span className="ml-1 text-gray-500">{e.lastMeasuredAt.slice(0, 10)}</span>}
                  <span className="ml-1 text-gray-400">— not carried forward</span>
                </>
              ) : (
                <span className={e.value.state === "unreadable" ? "font-semibold text-rose-700" : "text-gray-500"}>
                  {e.value.text}
                </span>
              )}
            </p>
          </div>

          <div className="flex shrink-0 items-end gap-1.5">
            {done ? (
              <span className="rounded-lg bg-emerald-100 px-2.5 py-1.5 text-[10.5px] font-semibold text-emerald-800">
                Recorded {done.value}
              </span>
            ) : locked || !collection.canRecord ? (
              <span className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-[10.5px] font-semibold text-slate-500">
                {locked ? "Encounter closed" : "No permission to record"}
              </span>
            ) : (
              <>
                <label className="text-[10px] font-semibold text-gray-600">
                  Value
                  {/* ⚠ EMPTY. No defaultValue, no placeholder holding the last number. */}
                  <input className={`${input} w-24`} value={v.value}
                    onChange={ev => setValues(s => ({ ...s, [e.definitionId]: { ...v, value: ev.target.value } }))} />
                </label>
                {e.permittedUnits.length > 0 && (
                  <label className="text-[10px] font-semibold text-gray-600">
                    Unit
                    <select className={`${input} w-20`} value={v.unit}
                      onChange={ev => setValues(s => ({ ...s, [e.definitionId]: { ...v, unit: ev.target.value } }))}>
                      {e.permittedUnits.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </label>
                )}
                <label className="text-[10px] font-semibold text-gray-600">
                  Source
                  <select className={`${input} w-32`} value={v.source}
                    onChange={ev => setValues(s => ({ ...s, [e.definitionId]: { ...v, source: ev.target.value } }))}>
                    {MEASUREMENT_SOURCES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </label>
                <button type="button" disabled={busy || v.value.trim() === ""} className={BTN}
                  onClick={async () => {
                    const ok = await post({
                      action: "record", patientId: collection.patientId,
                      definitionId: e.definitionId, encounterId: collection.encounterId,
                      value: v.value, unit: v.unit || null, source: v.source,
                    }, `${e.label} recorded.`);
                    if (ok) setValues(s => ({ ...s, [e.definitionId]: { ...v, value: "" } }));
                  }}>
                  Save
                </button>
              </>
            )}
          </div>
        </div>
      </li>
    );
  };

  return (
    <section className={CARD}>
      <div className="flex flex-wrap items-center gap-2">
        <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg text-[13px]"
          style={tintedChip("var(--cp-primary)")}>⚖</span>
        <h2 className="text-[13px] font-bold text-gray-900">Clinical parameters</h2>
        <span className="text-[11px] text-gray-500">
          {collection.counts.priority ?? "—"} to collect ·{" "}
          {collection.counts.recorded === null ? "recorded count could not be read" : `${recordedCount} done today`}
        </span>
        {collection.optional.length > 0 && (
          <button type="button" className={`${QUIET} ml-auto`} onClick={() => setShowOptional(v => !v)}>
            {showOptional ? "Hide" : "Show"} {collection.optional.length} optional
          </button>
        )}
      </div>

      {notice && (
        <p className={`mt-2 rounded-lg px-3 py-2 text-[12px] font-semibold ${notice.kind === "ok"
          ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>{notice.text}</p>
      )}

      {collection.priority.length === 0 && collection.optional.length === 0 ? (
        <p className="mt-2 text-[12px] leading-relaxed text-gray-600">
          Nothing is monitored for this patient, so there is nothing to collect. That is a real answer:
          parameters appear here once the practice activates them on the Clinical Parameters page, or once
          one is added to this patient&rsquo;s monitoring plan.
        </p>
      ) : (
        <>
          {/* s10.3: "Only due, required and contextually relevant parameters shown first." */}
          <ul className="mt-2.5 flex flex-col gap-2">{collection.priority.map(row)}</ul>
          {collection.priority.length === 0 && (
            <p className="mt-2 text-[12px] text-gray-600">
              Nothing is due or required for this visit. {collection.optional.length} optional parameter
              {collection.optional.length === 1 ? " is" : "s are"} available below.
            </p>
          )}

          {/* s10.3: "Optional parameters accessible without clutter" -- present, folded away. */}
          {showOptional && collection.optional.length > 0 && (
            <ul className="mt-2 flex flex-col gap-2 border-t border-gray-100 pt-2.5">
              {collection.optional.map(row)}
            </ul>
          )}
        </>
      )}

      <p className="mt-2.5 border-t border-gray-100 pt-2 text-[10px] leading-relaxed text-gray-500">
        Nothing on this form is filled in from a previous visit. A prior value is shown beside the box with
        its date, and it is never copied into it &mdash; a measurement carried forward is a measurement
        nobody took.
      </p>
    </section>
  );
}
