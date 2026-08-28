"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { tintedCard, tintedChip, tintedFigure } from "@/lib/practice/palette";
import {
  PLAN_STATES, PLAN_SCHEDULES, PLAN_STATE_CHIP, THRESHOLD_TONE, DUE_TONE,
  CATEGORY_HUE, CATEGORY_HUE_UNKEYED, CATEGORY_ICON,
  MONITORING_PLAN_BOUNDARY, TREND_BOUNDARY, NO_PERCENTILE_BANDS,
} from "@/lib/practice/parameters-constants";
import type { MonitoringPlan, PlanEntry } from "@/lib/practice/parameters";

// CPR-LCP-001 s10.2 -- PATIENT WORKSPACE: THE MONITORING PLAN PANEL.
//
// s10.2 names seven things and this panel is those seven:
//   "Monitoring Plan panel / Current values and last measurement dates / Due and overdue parameters /
//    Trend summaries and alerts / Customise for this patient action / Restore inherited defaults action /
//    Parameter history and configuration audit trail"
//
// ⚠ TWO LISTS THAT LOOK LIKE ONE, AND LCP s9 IS THE REASON THEY ARE NOT.
//
// "Patient-level hiding of weight must not suppress a medication-triggered safety requirement."
// `plan.routine` has already dropped hidden, paused and resolved. `plan.safetyRequired` reads the other
// column and does not consult state at all. A parameter that is hidden AND required for safety is drawn
// in the safety block with its own sentence, because the whole point is that it is still demanded.
//
// ⚠ AND NOTHING HERE DRAWS A CENTILE BAND. The design overview's panel 9 draws 97th/75th/50th/25th/3rd
// curves behind the weight line. There is no reference population in this product; drawing them would
// be a fabricated clinical figure read by somebody deciding whether a child is failing to thrive. The
// raw series is drawn and the reason is printed under it.
//
// ⚠ TYPE-ONLY IMPORT FROM THE ENGINE. parameters.ts imports access.ts imports next/headers; a value
// import here would put that chain in the browser bundle and only `next build` would say so.

const CARD = "rounded-xl border border-gray-200 bg-white p-4";
const input = "w-full rounded-lg border border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 px-2.5 py-1.5 text-[12px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";
const BTN = "rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50";
const QUIET = "rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50";

const hueOf = (c: string) => CATEGORY_HUE[c] ?? CATEGORY_HUE_UNKEYED;

export default function MonitoringPlanPanel({ plan, patientId }: { plan: MonitoringPlan; patientId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [draft, setDraft] = useState({ state: "active", schedule: "", untilDate: "", low: "", high: "", improving: "", reason: "" });
  const [record, setRecord] = useState<{ id: string; value: string; unit: string; note: string } | null>(null);

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

  // ⚠ THREE STATES. `permitted: false` is not an empty plan and `unavailable` is not an empty plan.
  if (!plan.permitted) {
    return (
      <section id="record-monitoring" className={`scroll-mt-4 mt-4 ${CARD}`}>
        <h2 className="text-[13px] font-bold text-gray-900">Monitoring plan</h2>
        <p className="mt-1 text-[12px] text-gray-600">
          You do not have the <code className="rounded bg-gray-100 px-1">parameter.view</code> capability,
          so this patient&rsquo;s monitoring plan is not shown. That is a permissions answer, not an empty
          plan.
        </p>
      </section>
    );
  }

  if (plan.all.unavailable) {
    return (
      <section id="record-monitoring" className="scroll-mt-4 mt-4 rounded-xl border border-rose-300 bg-rose-50 p-4">
        <h2 className="text-[13px] font-bold text-rose-900">This patient&rsquo;s monitoring plan could not be read</h2>
        <p className="mt-1 text-[12px] leading-relaxed text-rose-800">
          This is <strong>not</strong> the same as having no monitoring plan. Do not treat this patient as
          unmonitored, and do not rely on the absence of a warning here.
        </p>
        {plan.all.detail && <p className="mt-1.5 font-mono text-[11px] text-rose-700">{plan.all.detail}</p>}
      </section>
    );
  }

  const stats = [
    { key: "routine", figure: plan.counts.routine, label: "In routine collection", hue: "var(--cp-primary)" },
    { key: "overdue", figure: plan.counts.overdue, label: "Overdue", hue: "var(--cp-error)" },
    { key: "breached", figure: plan.counts.breached, label: "Outside range", hue: "var(--cp-warning)" },
    { key: "notChecked", figure: plan.counts.notChecked, label: "Nothing checking", hue: "var(--cp-slate-500)" },
  ];

  const hiddenButRequired = plan.safetyRequired.filter(e => e.resurfacedForSafety);

  return (
    <section id="record-monitoring" className="scroll-mt-4 mt-4 flex flex-col gap-3">
      <div className={CARD}>
        <div className="flex flex-wrap items-center gap-2">
          <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg text-[13px]"
            style={tintedChip("var(--cp-primary)")}>⚖</span>
          <h2 className="text-[13px] font-bold text-gray-900">Monitoring plan</h2>
          <span className="text-[11px] text-gray-500">
            {plan.counts.inPlan} parameter{plan.counts.inPlan === 1 ? "" : "s"} · as at {plan.today}
          </span>
          {plan.history.items.length > 0 && (
            <button type="button" className={`${QUIET} ml-auto`} onClick={() => setShowHistory(v => !v)}>
              {showHistory ? "Hide" : "Configuration history"} ({plan.history.items.length})
            </button>
          )}
        </div>
        <p className="mt-1.5 text-[10.5px] leading-relaxed text-gray-500">{MONITORING_PLAN_BOUNDARY}</p>

        {notice && (
          <p className={`mt-2 rounded-lg px-3 py-2 text-[12px] font-semibold ${notice.kind === "ok"
            ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>{notice.text}</p>
        )}

        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {stats.map(s => (
            <div key={s.key} className="relative overflow-hidden rounded-lg border p-2.5" style={tintedCard(s.hue)}>
              <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: s.hue }} />
              <p className="text-[20px] font-bold leading-none"
                style={s.figure === null ? { color: "var(--cp-slate-300)" } : tintedFigure(s.hue)}>
                {s.figure === null ? "—" : s.figure}
              </p>
              <p className="mt-0.5 text-[10px] font-semibold text-gray-600">{s.label}</p>
              {s.figure === null && <p className="text-[9px] text-gray-400">could not be read</p>}
            </div>
          ))}
        </div>
      </div>

      {/* ⚠ LCP s9's SENTENCE, RENDERED. A parameter somebody removed from routine views that a safety
          requirement still demands. The block exists so that hiding cannot suppress it. */}
      {hiddenButRequired.length > 0 && (
        <div className="rounded-xl border-2 border-rose-300 bg-rose-50 p-4">
          <h3 className="text-[12.5px] font-bold text-rose-900">
            Still required for safety, even though it is out of routine collection
          </h3>
          <p className="mt-1 text-[11px] leading-relaxed text-rose-800">
            Hiding, pausing or resolving a parameter removes it from routine views. It does{" "}
            <strong>not</strong> lift a requirement raised by a medication, a diagnosis or a protocol.
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {hiddenButRequired.map(e => (
              <li key={e.definitionId} className="rounded-lg bg-white/70 px-2.5 py-2">
                <p className="text-[12px] font-bold text-rose-900">
                  {e.label}
                  <span className="ml-1.5 rounded bg-rose-200 px-1 py-0.5 text-[9px] font-semibold uppercase text-rose-900">
                    {e.state}
                  </span>
                </p>
                <p className="text-[10.5px] text-rose-800">{e.safetyRequiredReason ?? "No reason recorded"}</p>
                <p className="text-[10px] text-rose-700">
                  {e.latest ? `Last value ${e.latest.value} on ${e.latest.effectiveAt.slice(0, 10)}` : "Nothing recorded"}
                  {e.safetyOverrideReason ? ` · override: ${e.safetyOverrideReason}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Open alerts. s8 step 7: severity, rationale and recommended action. */}
      {plan.alerts.unavailable ? (
        <div className="rounded-xl border border-rose-300 bg-rose-50 p-3">
          <p className="text-[12px] font-semibold text-rose-900">
            This patient&rsquo;s alerts could not be read &mdash; the absence of a warning here means nothing.
          </p>
        </div>
      ) : plan.alerts.items.length > 0 && (
        <div className={CARD}>
          <h3 className="text-[12.5px] font-bold text-gray-900">Open alerts ({plan.alerts.items.length})</h3>
          <ul className="mt-2 flex flex-col gap-1.5">
            {plan.alerts.items.map(a => (
              <li key={a.id} className="rounded-lg border border-amber-200 bg-amber-50/70 px-2.5 py-2">
                <p className="text-[11.5px] font-bold text-amber-900">
                  {a.label}
                  {/* ⚠ A NULL SEVERITY READS "NOT CLASSIFIED", NEVER THE LOWEST LEVEL AND NEVER A BLANK. */}
                  <span className="ml-1.5 rounded bg-amber-200 px-1 py-0.5 text-[9px] font-semibold uppercase text-amber-900">
                    {a.severityLabel}
                  </span>
                </p>
                <p className="text-[10.5px] leading-relaxed text-amber-800">{a.rationale}</p>
                {a.recommendedAction && <p className="text-[10px] text-amber-700">{a.recommendedAction}</p>}
                {plan.canRecord && (
                  <button type="button" disabled={busy} className={`${QUIET} mt-1.5`}
                    onClick={() => post({ action: "resolveAlert", alertId: a.id, status: "acknowledged" }, "Alert acknowledged.")}>
                    Acknowledge
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* The plan itself. */}
      <div className={CARD}>
        {plan.all.items.length === 0 ? (
          <p className="text-[12px] leading-relaxed text-gray-600">
            Nothing is monitored for this patient yet, and this <em>is</em> a real answer rather than a
            failed read. Parameters appear here once the practice activates them on the Clinical
            Parameters page, or once one is added for this patient.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {plan.all.items.map(e => (
              <PlanRow
                key={e.definitionId} e={e} busy={busy}
                canConfigure={plan.canConfigure} canRecord={plan.canRecord}
                open={open === e.definitionId}
                onOpen={() => {
                  setOpen(open === e.definitionId ? null : e.definitionId);
                  setRecord(null);
                  setDraft({
                    state: e.state === "inherited" ? "active" : e.state,
                    schedule: e.schedule ?? "",
                    untilDate: "",
                    low: e.target?.low != null ? String(e.target.low) : "",
                    high: e.target?.high != null ? String(e.target.high) : "",
                    improving: e.improvingDirection ?? "",
                    reason: "",
                  });
                }}
                draft={draft} onDraft={d => setDraft(p => ({ ...p, ...d }))}
                record={record?.id === e.definitionId ? record : null}
                onRecordOpen={() => setRecord({ id: e.definitionId, value: "", unit: e.canonicalUnit ?? "", note: "" })}
                onRecordDraft={d => setRecord(r => (r ? { ...r, ...d } : r))}
                onSave={async () => {
                  const ok = await post({
                    action: "setPlan", patientId, definitionId: e.definitionId,
                    state: draft.state, schedule: draft.schedule || null,
                    untilDate: draft.untilDate || null,
                    targetLow: draft.low || null, targetHigh: draft.high || null,
                    improvingDirection: draft.improving || null,
                    reason: draft.reason,
                  }, `${e.label} updated for this patient.`);
                  if (ok) setOpen(null);
                }}
                onRestore={async () => {
                  const ok = await post({
                    action: "restoreInherited", patientId, definitionId: e.definitionId,
                    reason: draft.reason || "Restored to the practice default.",
                  }, `${e.label} is back on the practice default.`);
                  if (ok) setOpen(null);
                }}
                onRecordSave={async () => {
                  const ok = await post({
                    action: "record", patientId, definitionId: e.definitionId,
                    value: record?.value, unit: record?.unit || null, note: record?.note || null,
                  }, `${e.label} recorded.`);
                  if (ok) setRecord(null);
                }}
              />
            ))}
          </ul>
        )}
      </div>

      {/* s10.2's "Parameter history and configuration audit trail". */}
      {showHistory && (
        <div className={CARD}>
          <h3 className="text-[12.5px] font-bold text-gray-900">Configuration history</h3>
          {plan.history.unavailable ? (
            <p className="mt-1.5 text-[12px] text-rose-800">
              The configuration history could not be read &mdash; not the same as there having been no changes.
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1">
              {plan.history.items.map(h => (
                <li key={h.id} className="flex flex-wrap items-baseline gap-2 border-b border-gray-100 py-1 text-[11px] last:border-0">
                  <span className="font-mono text-[10px] text-gray-400">{h.occurredAt.slice(0, 16).replace("T", " ")}</span>
                  <span className="font-semibold text-gray-800">{h.field.replace(/_/g, " ")}</span>
                  <span className="text-gray-500">
                    {JSON.stringify(h.previous)} → {JSON.stringify(h.next)}
                  </span>
                  <span className="text-gray-600">{h.reason}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[10px] leading-relaxed text-gray-400">
            Append-only. Every patient-specific change records who made it, when, what it was before, what
            it is now and why &mdash; the database refuses a change with no reason.
          </p>
        </div>
      )}
    </section>
  );
}

function PlanRow({
  e, busy, canConfigure, canRecord, open, onOpen, draft, onDraft, record,
  onRecordOpen, onRecordDraft, onSave, onRestore, onRecordSave,
}: {
  e: PlanEntry; busy: boolean; canConfigure: boolean; canRecord: boolean; open: boolean;
  onOpen: () => void;
  draft: { state: string; schedule: string; untilDate: string; low: string; high: string; improving: string; reason: string };
  onDraft: (d: Partial<{ state: string; schedule: string; untilDate: string; low: string; high: string; improving: string; reason: string }>) => void;
  record: { id: string; value: string; unit: string; note: string } | null;
  onRecordOpen: () => void;
  onRecordDraft: (d: Partial<{ value: string; unit: string; note: string }>) => void;
  onSave: () => void; onRestore: () => void; onRecordSave: () => void;
}) {
  const hue = hueOf(e.category);
  const tone = THRESHOLD_TONE[e.threshold.state] ?? THRESHOLD_TONE.unreadable;
  const due = DUE_TONE[e.due.state] ?? DUE_TONE.unreadable;
  const outOfRoutine = ["paused", "resolved", "hidden"].includes(e.state);

  return (
    <li className="rounded-lg border p-3"
      style={outOfRoutine ? { borderColor: "var(--cp-slate-300)", background: "var(--cp-slate-100)" } : tintedCard(hue)}>
      <div className="flex flex-wrap items-start gap-2">
        <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[12px]"
          style={outOfRoutine ? { background: "white", color: "var(--cp-slate-500)" } : tintedChip(hue)}>
          {CATEGORY_ICON[e.category] ?? "•"}
        </span>

        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-bold text-gray-900">
            {e.label}
            <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${PLAN_STATE_CHIP[e.state] ?? "bg-slate-100 text-slate-600"}`}
              title={e.stateMeaning}>
              {PLAN_STATES.find(([k]) => k === e.state)?.[1] ?? e.state}
            </span>
            {e.safetyRequired && (
              <span className="rounded bg-rose-200 px-1.5 py-0.5 text-[9px] font-bold uppercase text-rose-900">
                Required for safety
              </span>
            )}
          </p>

          {/* s10.2: "Current values and last measurement dates". */}
          <p className="mt-0.5 text-[11.5px]">
            {e.value.state === "value" ? (
              <>
                <span className="font-semibold" style={tintedFigure(hue)}>{e.value.text}</span>
                {/* ⚠ s10.3's four-way distinction: measured, patient-reported, imported, calculated. */}
                <span className="ml-1.5 rounded bg-white/70 px-1 py-0.5 text-[9px] font-semibold text-gray-600">
                  {e.value.provenanceLabel}
                </span>
                {e.lastMeasuredAt && <span className="ml-1.5 text-[10px] text-gray-500">{e.lastMeasuredAt.slice(0, 10)}</span>}
                {e.latest?.amendedByLaterRow && (
                  <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-semibold text-amber-800">corrected later</span>
                )}
              </>
            ) : (
              <span className={e.value.state === "unreadable" ? "font-semibold text-rose-700" : "text-gray-500"}>
                {e.value.text}
              </span>
            )}
          </p>

          {/* ⚠ THE TWO CHIPS THAT MUST NEVER BE BLANK. */}
          <p className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className={`rounded px-1.5 py-0.5 text-[9.5px] font-semibold ${tone.chip}`} title={e.threshold.text}>
              <span aria-hidden className="mr-0.5">{tone.mark}</span>{tone.label}
            </span>
            <span className={`rounded px-1.5 py-0.5 text-[9.5px] font-semibold ${due.chip}`} title={e.due.text}>
              {due.label}
            </span>
            <span className="text-[10px] text-gray-500">{e.measurementCount} recorded · from {e.inheritedFrom}</span>
          </p>

          {/* The threshold sentence in full, because "Not checked" on its own invites a shrug. */}
          <p className="mt-0.5 text-[10px] leading-relaxed text-gray-600">{e.threshold.text}</p>
          {e.due.state !== "no_schedule" && (
            <p className="text-[10px] leading-relaxed text-gray-600">{e.due.text}</p>
          )}
          {e.plausibility.state === "implausible" && (
            <p className="mt-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">
              {e.plausibility.text}
            </p>
          )}

          {/* ⚠ LCP s3 "Transparent intelligence" and s13: a calculated value shows its formula and the
              measurements it came from. Nothing here is a number with no provenance. */}
          {e.derived && (
            <p className="mt-1 rounded-lg bg-white/70 px-2 py-1.5 text-[10px] leading-relaxed text-gray-600">
              <span className="font-semibold text-gray-800">Calculated {e.derived.value}{e.derived.unit ? ` ${e.derived.unit}` : ""}</span>
              {" · "}<span className="font-mono">{e.derived.formula}</span>
              {" · from "}{e.derived.sourceMeasurementIds.length} measurement
              {e.derived.sourceMeasurementIds.length === 1 ? "" : "s"}
              {" · "}{e.derived.calculatedAt.slice(0, 16).replace("T", " ")}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {canRecord && !record && (
            <button type="button" className={QUIET} onClick={onRecordOpen}>Record a value</button>
          )}
          {canConfigure && (
            <button type="button" className={QUIET} onClick={onOpen}>
              {open ? "Close" : "Customise for this patient"}
            </button>
          )}
        </div>
      </div>

      {/* Recording. */}
      {record && (
        <div className="mt-2.5 flex flex-wrap items-end gap-2 border-t border-white/60 pt-2.5">
          <label className="text-[10px] font-semibold text-gray-600">
            Value
            <input className={`${input} w-28`} value={record.value}
              onChange={ev => onRecordDraft({ value: ev.target.value })} />
          </label>
          <label className="text-[10px] font-semibold text-gray-600">
            Unit
            <select className={`${input} w-24`} value={record.unit} onChange={ev => onRecordDraft({ unit: ev.target.value })}>
              {(e.permittedUnits.length > 0 ? e.permittedUnits : [e.canonicalUnit ?? ""]).map(u => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </label>
          <label className="min-w-[160px] flex-1 text-[10px] font-semibold text-gray-600">
            Note (optional)
            <input className={input} value={record.note} onChange={ev => onRecordDraft({ note: ev.target.value })} />
          </label>
          <button type="button" disabled={busy} className={BTN} onClick={onRecordSave}>Record</button>
          {/* ⚠ THE PRIOR VALUE IS SHOWN AS HISTORY, NEVER PLACED IN THE INPUT. LCP s10.3: "One-click
              carry-forward is prohibited for measured values." */}
          <p className="w-full text-[10px] text-gray-500">
            {e.latest
              ? `Last recorded ${e.latest.value} on ${e.latest.effectiveAt.slice(0, 10)}. That value is not carried forward — type what you measured.`
              : "Nothing has been recorded for this parameter."}
          </p>
        </div>
      )}

      {/* s10.2's "Customise for this patient" and "Restore inherited defaults". */}
      {open && (
        <div className="mt-2.5 grid gap-2 border-t border-white/60 pt-2.5 sm:grid-cols-2 xl:grid-cols-3">
          <label className="text-[10px] font-semibold text-gray-600">
            State
            <select className={input} value={draft.state} onChange={ev => onDraft({ state: ev.target.value })}>
              {PLAN_STATES.filter(([k]) => k !== "inherited").map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label className="text-[10px] font-semibold text-gray-600">
            How often
            <select className={input} value={draft.schedule} onChange={ev => onDraft({ schedule: ev.target.value })}>
              <option value="">No schedule — on request</option>
              {PLAN_SCHEDULES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          {draft.schedule === "until_date" && (
            <label className="text-[10px] font-semibold text-gray-600">
              Until
              <input type="date" className={input} value={draft.untilDate} onChange={ev => onDraft({ untilDate: ev.target.value })} />
            </label>
          )}
          <label className="text-[10px] font-semibold text-gray-600">
            Target low
            <input className={input} value={draft.low} onChange={ev => onDraft({ low: ev.target.value })} />
          </label>
          <label className="text-[10px] font-semibold text-gray-600">
            Target high
            <input className={input} value={draft.high} onChange={ev => onDraft({ high: ev.target.value })} />
          </label>
          <label className="text-[10px] font-semibold text-gray-600">
            Which way is better?
            <select className={input} value={draft.improving} onChange={ev => onDraft({ improving: ev.target.value })}>
              <option value="">Not agreed — no direction will be claimed</option>
              <option value="up">Up is better</option>
              <option value="down">Down is better</option>
            </select>
          </label>
          <label className="text-[10px] font-semibold text-gray-600 sm:col-span-2 xl:col-span-3">
            Reason for this change (required)
            <input className={input} value={draft.reason} placeholder="Why this patient differs from the practice default"
              onChange={ev => onDraft({ reason: ev.target.value })} />
          </label>
          <p className="text-[10px] leading-relaxed text-gray-600 sm:col-span-2 xl:col-span-2">
            {/* The two sentences that make the form honest. */}
            &ldquo;Which way is better&rdquo; has to be agreed <strong>in advance</strong>: without it this
            product will not say a patient is improving or deteriorating, because whether a falling weight
            is improvement depends entirely on the patient.
            {e.safetyRequired && (
              <> {" "}This parameter is required for safety
                {e.safetyRequiredReason ? ` (${e.safetyRequiredReason})` : ""} &mdash; pausing, resolving or
                hiding it needs an authorised override with a written reason.</>
            )}
          </p>
          <div className="flex items-end gap-2">
            <button type="button" disabled={busy || !draft.reason.trim()} className={BTN} onClick={onSave}>Save</button>
            {e.planId && (
              <button type="button" disabled={busy} className={QUIET} onClick={onRestore}>Restore inherited</button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * s10.2's "Trend summaries" -- the raw series, at its own scale, with no centile bands behind it.
 *
 * Exported so the encounter panel can draw the same chart from the same code; a second implementation
 * would be a second place to decide whether to draw a band.
 */
export function ParameterTrend({ points, unit, label }: {
  points: { value: number; at: string }[]; unit: string | null; label: string;
}) {
  if (points.length < 2) {
    return (
      <p className="text-[11px] text-gray-500">
        {points.length === 1 ? "One value recorded — a line needs two." : "Nothing recorded yet."}
      </p>
    );
  }
  const values = points.map(p => p.value);
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const w = 320, h = 90, pad = 6;
  const x = (i: number) => pad + (i / (points.length - 1)) * (w - pad * 2);
  const y = (v: number) => h - pad - ((v - min) / span) * (h - pad * 2);
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-[90px] w-full" role="img"
        aria-label={`${label}: ${points.length} recorded values from ${min} to ${max}${unit ? ` ${unit}` : ""}`}>
        {/* ⚠ NO CENTILE BANDS. See NO_PERCENTILE_BANDS. There is nothing behind this line on purpose. */}
        <path d={d} fill="none" stroke="var(--cp-primary)" strokeWidth="2" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.value)} r="2.5" fill="var(--cp-primary)" />
        ))}
      </svg>
      <p className="text-[10px] text-gray-500">
        {points[0].at.slice(0, 10)} → {points[points.length - 1].at.slice(0, 10)} ·{" "}
        {min}–{max}{unit ? ` ${unit}` : ""}
      </p>
      <p className="mt-1 text-[10px] leading-relaxed text-gray-500">{TREND_BOUNDARY}</p>
      <p className="text-[10px] leading-relaxed text-gray-400">{NO_PERCENTILE_BANDS.wouldRequire}</p>
    </div>
  );
}
