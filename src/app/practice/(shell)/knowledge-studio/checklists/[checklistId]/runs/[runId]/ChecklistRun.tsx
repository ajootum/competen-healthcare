"use client";

import { useCallback, useMemo, useState } from "react";
import { BUTTON } from "@/lib/practice/palette";
import {
  applicableItems, checklistClearedNotice, CHECKLIST_RESPONSES, CHECKLIST_RESPONSE_SWATCH,
  CHECKLIST_RESPONSES_NEEDING_NOTE, CHECKLIST_ROUTE, CHECKLIST_RUN_NAME,
} from "@/lib/practice/checklist-constants";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// FILLING A CHECKLIST IN. The conditional runtime, on the screen.
//
// ⚠ THIS COMPONENT IMPORTS THE EVALUATOR. `applicableItems` is a two-line adapter over
// `resolveApplicable` from registration-condition.ts -- the file that imports nothing, so that a client
// component may reach for it without dragging node:crypto and next/headers into the bundle. The server's
// `recordResponses` resolves through the same function object. There is ONE evaluator.
//
// ⚠ ONE WRITE PATH FOR EVERY ANSWER ON THIS SCREEN, AND IT IS WHERE A WITHDRAWN ITEM'S ANSWER IS THROWN
// AWAY. Two reasons it is here rather than in an effect watching the state:
//
//   1. React 19 refuses it. Clearing state from an effect is a cascading render, and this project's lint
//      says so as an ERROR rather than a warning. "You might not need an effect" is right: the only
//      thing that can withdraw an item is somebody answering another one, which is an event.
//   2. ONE PLACE MEANS ONE PLACE TO GET WRONG. Every control below calls `answer`. A handler writing to
//      the answers map directly would silently opt out of the clearing.
//
// ⚠ AND THE PAYLOAD IS A POSITIVE WHITELIST -- only the items currently drawn. `answer` has already
// cleared the state, so the two agree; but only one of them stays right if somebody later decides
// clearing was too aggressive, and it is not the state map. The SERVER clears too, against what is
// stored rather than what this sent, because a client is a claim and the store is the record.
//
// ⚠ MOBILE MODE IS CSS AND NOTHING IS HIDDEN BY IT. One column, full-width answer buttons and larger
// tap targets below the small breakpoint. A checklist that hides items on a phone is a checklist
// somebody completes without seeing them.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

const CARD = "rounded-xl border border-gray-200 bg-white";
const FIELD = "w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";

type Answer = { response: string; note: string };

export default function ChecklistRun({ detail, checklistId, canComplete }: {
  detail: any; checklistId: string; canComplete: boolean;
}) {
  // ⚠ MEMOISED, because `detail.items ?? []` is a new array object on every render and it is a
  // dependency of both the resolver and the one write path -- which would then re-run every render and,
  // in the callback's case, close over a stale answers map.
  const items = useMemo<any[]>(() => detail.items ?? [], [detail.items]);

  const [answers, setAnswers] = useState<Record<string, Answer>>(() => {
    const byId = new Map(items.map(i => [i.id, i.item_key]));
    const out: Record<string, Answer> = {};
    for (const r of (detail.responses ?? []) as any[]) {
      const key = byId.get(r.item_id);
      if (key) out[key] = { response: r.response, note: r.note ?? "" };
    }
    return out;
  });
  const [clearedNote, setClearedNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const open = detail.run?.open === true;

  // The map the evaluator wants: item_key -> response code.
  const codes = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(answers)) if (v?.response) out[k] = v.response;
    return out;
  }, [answers]);

  const resolved = useMemo(() => applicableItems(items, codes), [items, codes]);
  const drawn = resolved.applicable;
  const withdrawn = items.filter(i => !drawn.some(d => d.id === i.id));

  // ── THE ONE WRITE PATH ────────────────────────────────────────────────────────────────────────
  const answer = useCallback((itemKey: string, patch: Partial<Answer>) => {
    const existing: Answer = answers[itemKey] ?? { response: "", note: "" };
    const next = { ...answers, [itemKey]: { ...existing, ...patch } };
    const nextCodes: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(next)) if (v?.response) nextCodes[k] = v.response;

    const out = applicableItems(items, nextCodes);
    const surviving = new Set(Object.keys(out.answers));
    const cleared = out.cleared;

    if (cleared.length === 0) { setAnswers(next); return; }

    // THE ANSWER GOES, AND IT IS SAID. An item disappearing takes what somebody recorded with it, and a
    // screen that does neither of those things out loud is how a safety checklist loses a tick with no
    // account of where it went.
    const kept: Record<string, Answer> = {};
    for (const k of Object.keys(next)) if (surviving.has(k) || !next[k].response) kept[k] = next[k];
    for (const c of cleared) delete kept[c.item_key];
    setAnswers(kept);
    setClearedNote(checklistClearedNotice(cleared.map((c: any) => String(c.label ?? c.item_key))));
  }, [answers, items]);

  async function post(body: unknown) {
    setBusy(true); setError(null);
    const res = await fetch(`/api/v1/practice/checklist-runs/${detail.run.id}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(data?.error?.message ?? "That did not work."); return null; }
    return data;
  }

  async function save() {
    // ⚠ THE WHITELIST. Only what is drawn, and only what has an answer.
    const payload = drawn
      .filter(i => answers[i.item_key]?.response)
      .map(i => ({ itemKey: i.item_key, response: answers[i.item_key].response, note: answers[i.item_key].note || null }));
    const out = await post({ action: "record", answers: payload });
    if (out) window.location.reload();
  }

  async function close() {
    const saved = await post({
      action: "record",
      answers: drawn.filter(i => answers[i.item_key]?.response)
        .map(i => ({ itemKey: i.item_key, response: answers[i.item_key].response, note: answers[i.item_key].note || null })),
    });
    if (!saved) return;
    const out = await post({ action: "complete" });
    if (out) window.location.reload();
  }

  if (detail.state !== "ok" || !detail.run) {
    return (
      <section className={`rounded-xl border p-4 ${detail.state === "failed" ? "border-rose-200 bg-rose-50/70" : "border-amber-200 bg-amber-50/70"}`}>
        <h1 className="text-[14px] font-bold text-gray-900">
          {detail.state === "failed" ? "This record could not be read." : "There is nowhere to store a completion record yet."}
        </h1>
        {detail.detail && (
          <p className="mt-2 rounded-lg bg-white/70 px-2.5 py-1.5 font-mono text-[11px] text-gray-700">{detail.detail}</p>
        )}
        <a href={`${CHECKLIST_ROUTE}/${checklistId}`} className="mt-3 inline-block text-[12px] text-gray-600 hover:underline">
          &larr; Back to the checklist
        </a>
      </section>
    );
  }

  const c = detail.completeness;
  // Read off the PREVIOUS ROW rather than carried in a mutable variable -- reassigning during a render
  // is an error in this project's lint, and rightly: a second render would start where the first ended.
  const headingFor = (item: any, i: number, all: any[]) =>
    item.section && item.section !== (all[i - 1]?.section ?? null) ? item.section : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-gray-500">
        <a href={`${CHECKLIST_ROUTE}/${checklistId}`} className="hover:underline">&larr; {detail.checklist?.title ?? "The checklist"}</a>
        <a href={`${CHECKLIST_ROUTE}/${checklistId}/runs/${detail.run.id}/print`} className="ml-auto hover:underline">Print this record</a>
      </div>

      <header>
        <h1 className="text-[17px] font-bold text-gray-900">
          {detail.checklist?.title ?? "Checklist"}
          <span className="ml-2 text-[12px] font-normal text-gray-500">
            {detail.run.stateLabel} &middot; against v{detail.run.checklist_version}
          </span>
        </h1>
        <p className="mt-1 text-[12px] text-gray-600">
          Started {String(detail.run.started_at).slice(0, 16).replace("T", " ")}
          {detail.run.startedByName ? ` by ${detail.run.startedByName}` : ""}
          {detail.run.context_note ? ` · ${detail.run.context_note}` : ""}
          {detail.run.completed_at ? ` · Closed ${String(detail.run.completed_at).slice(0, 16).replace("T", " ")}${detail.run.completedByName ? ` by ${detail.run.completedByName}` : ""}` : ""}
        </p>
      </header>

      {/* ⚠ THE NOTICE, WHILE SOMEBODY IS TICKING. Not only on the library. */}
      <section className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-3">
        <p className="text-[12.5px] font-bold text-slate-800">
          <span aria-hidden className="mr-1.5">◌</span>{detail.notVerified.headline}
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-slate-600">{detail.notVerified.detail}</p>
      </section>

      {clearedNote && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
          {clearedNote}
        </p>
      )}
      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">{error}</p>}

      {/* ── THE LIST ─────────────────────────────────────────────────────────────────────────────── */}
      <section className={`${CARD} divide-y divide-gray-100`}>
        {drawn.map((item, i, all) => {
          const a = answers[item.item_key];
          const heading = headingFor(item, i, all);
          const needsNote = a?.response && CHECKLIST_RESPONSES_NEEDING_NOTE.includes(a.response);
          const criticalNotDone = item.is_critical && a?.response === "not_done";
          return (
            <div key={item.id}>
              {heading && (
                <p className="bg-gray-50 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-500">
                  {heading}
                </p>
              )}
              <div className="p-3.5">
                <p className="text-[13px] font-semibold text-gray-900">
                  {item.label}
                  {item.is_critical && (
                    <span className="ml-1.5 rounded bg-rose-100 px-1.5 text-[10px] font-bold text-rose-700">critical</span>
                  )}
                  {!item.required && (
                    <span className="ml-1.5 rounded bg-gray-100 px-1.5 text-[10px] font-bold text-gray-500">optional</span>
                  )}
                </p>
                {item.detail && <p className="mt-0.5 text-[11.5px] leading-relaxed text-gray-500">{item.detail}</p>}

                {/* MOBILE MODE: full width, stacked, larger tap targets below sm. Nothing is hidden. */}
                <div className="mt-2 grid grid-cols-1 gap-1.5 sm:flex sm:flex-wrap">
                  {CHECKLIST_RESPONSES.map(r => {
                    const on = a?.response === r.code;
                    const sw = CHECKLIST_RESPONSE_SWATCH[r.code];
                    return (
                      <button key={r.code} type="button" disabled={!open || !canComplete || busy}
                        onClick={() => answer(item.item_key, { response: on ? "" : r.code })}
                        className={`rounded-lg px-3 py-2.5 text-[12.5px] font-semibold transition sm:py-1.5 ${
                          on ? sw.chip : "border border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                        } disabled:opacity-60`}>
                        <span aria-hidden className="mr-1.5">{sw.icon}</span>{r.label}
                      </button>
                    );
                  })}
                </div>

                {(needsNote || criticalNotDone || a?.note) && (
                  <div className="mt-2">
                    <input value={a?.note ?? ""} disabled={!open || !canComplete}
                      onChange={e => answer(item.item_key, { note: e.target.value })}
                      placeholder={needsNote ? "Why did this not apply?" : criticalNotDone ? "What happened? Nothing here will ask again." : "A note, if there is one"}
                      className={FIELD} />
                    {(needsNote || criticalNotDone) && !(a?.note ?? "").trim() && (
                      <p className="mt-1 text-[11.5px] text-amber-800">
                        {needsNote
                          ? "\"Not applicable\" needs a reason -- the database refuses it without one."
                          : "A critical item recorded as not done needs a word about what happened."}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {drawn.length === 0 && (
          <p className="p-6 text-center text-[12.5px] text-gray-500">
            There is nothing on this checklist to tick.
          </p>
        )}
      </section>

      {/* ⚠ WHAT DID NOT APPLY, NAMED. Not silence, and not an empty box beside the answered ones -- an
          item that was withdrawn and an item nobody reached mean opposite things. */}
      {withdrawn.length > 0 && (
        <section className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-3">
          <p className="text-[12.5px] font-bold text-slate-800">
            <span aria-hidden className="mr-1.5">◌</span>
            {withdrawn.length === 1 ? "One item did not apply" : `${withdrawn.length} items did not apply`}
          </p>
          <ul className="mt-1 space-y-0.5">
            {withdrawn.map(i => (
              <li key={i.id} className="text-[12px] text-slate-600">
                {i.label}
                <span className="text-slate-400"> &mdash; withdrawn by an answer above, so it was never asked.</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── WHAT IS OUTSTANDING, AND WHAT IS CRITICAL AND NOT DONE ───────────────────────────────── */}
      {c && (
        <section className={`${CARD} p-3.5`}>
          <p className="text-[12.5px] text-gray-700">
            {c.answered} of {c.applicable} items that apply have an answer.
          </p>
          {c.outstanding.length > 0 && (
            <div className="mt-2">
              <p className="text-[12px] font-semibold text-amber-800">Still needs an answer</p>
              <ul className="mt-0.5 space-y-0.5">
                {c.outstanding.map((i: any) => <li key={i.id} className="text-[12px] text-gray-600">{i.label}</li>)}
              </ul>
            </div>
          )}
          {c.criticalNotDone.length > 0 && (
            // ⚠ NEVER HIDDEN AND NEVER A NUMBER. This is the thing anybody would ever come looking for.
            <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50/70 p-2.5">
              <p className="text-[12px] font-bold text-rose-800">
                Critical items recorded as not done
              </p>
              <ul className="mt-0.5 space-y-0.5">
                {c.criticalNotDone.map((i: any) => (
                  <li key={i.id} className="text-[12px] text-rose-800">
                    {i.label}{i.note ? ` — ${i.note}` : ""}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[11.5px] leading-relaxed text-rose-700">
                This does not stop the record being closed. A checklist that cannot be closed with a step
                undone is one people close by ticking the box, so this is recorded rather than refused.
              </p>
            </div>
          )}
        </section>
      )}

      {/* ── CLOSING IT ───────────────────────────────────────────────────────────────────────────── */}
      {open && canComplete && (
        <section className={`${CARD} p-3.5`}>
          <div className="flex flex-wrap gap-2">
            <button disabled={busy} onClick={save}
              className={`${BUTTON.quiet} rounded-lg px-3.5 py-2 text-[12.5px] font-semibold`}>
              {busy ? "Saving…" : "Save what is answered so far"}
            </button>
            <button disabled={busy} onClick={close}
              className={`${BUTTON.primary} rounded-lg px-3.5 py-2 text-[12.5px] font-semibold`}>
              Close this {CHECKLIST_RUN_NAME}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 border-t border-gray-100 pt-3">
            <input value={reason} onChange={e => setReason(e.target.value)}
              placeholder="If this is being abandoned, why?" className={`${FIELD} max-w-[26rem]`} />
            <button disabled={busy}
              onClick={async () => { const out = await post({ action: "abandon", reason }); if (out) window.location.reload(); }}
              className={`${BUTTON.quiet} rounded-lg px-3 py-2 text-[12.5px] font-semibold text-rose-700`}>
              Abandon it
            </button>
          </div>
        </section>
      )}

      {!open && (
        <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[12.5px] text-gray-600">
          This record is {String(detail.run.stateLabel).toLowerCase()}. What was recorded at the time is
          what it says, and it cannot be changed afterwards.
        </p>
      )}
    </div>
  );
}
