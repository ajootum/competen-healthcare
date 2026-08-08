"use client";

import { useState } from "react";
import { BUTTON } from "@/lib/practice/palette";
import {
  CHECKLIST_CHECK_SWATCH, CHECKLIST_STATE_SWATCH, CHECKLIST_RESPONSES, CHECKLIST_ROUTE,
  CHECKLIST_RUN_NAME, checklistState,
} from "@/lib/practice/checklist-constants";

// One checklist: its items, its readiness, its lifecycle, and every completion record made against it.
//
// ⚠ THE ITEM EDITOR AUTHORS CONDITIONS AGAINST EARLIER ITEMS ONLY, and the dropdown is built from the
// items above the one being edited. That is not a UI nicety -- CONDITIONS_RESOLVE refuses a condition
// naming a later item at publish, because such a condition can never be true when its own item is
// reached, and forbidding backwards references is also what makes a cycle impossible to author.
//
// ⚠ THE ANSWER A CONDITION COMPARES AGAINST IS A RESPONSE CODE, which is why the value dropdown holds
// Done / Not done / Not applicable rather than a free-text box.

/* eslint-disable @typescript-eslint/no-explicit-any */

const CARD = "rounded-xl border border-gray-200 bg-white";
const FIELD = "w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";

type Draft = {
  itemKey: string; label: string; section: string; detail: string;
  required: boolean; isCritical: boolean;
  /** "" means unconditional. */
  whenKey: string;
  /** "equals" | "in" | "isPresent" */
  op: string;
  value: string;
};

const toDraft = (i: any): Draft => {
  const c = i.condition && typeof i.condition === "object" ? i.condition : null;
  const op = !c ? "" : "isPresent" in c ? "isPresent" : "in" in c ? "in" : "equals";
  return {
    itemKey: i.item_key, label: i.label, section: i.section ?? "", detail: i.detail ?? "",
    required: i.required !== false, isCritical: i.is_critical === true,
    whenKey: c?.when ?? "", op,
    value: !c ? "done"
      : op === "isPresent" ? String(c.isPresent === false ? "false" : "true")
      : op === "in" ? (Array.isArray(c.in) ? c.in.map(String).join(",") : "")
      : String(c.equals ?? ""),
  };
};

const toCondition = (d: Draft): unknown => {
  if (!d.whenKey || !d.op) return null;
  if (d.op === "isPresent") return { when: d.whenKey, isPresent: d.value !== "false" };
  if (d.op === "in") return { when: d.whenKey, in: d.value.split(",").map(v => v.trim()).filter(Boolean) };
  return { when: d.whenKey, equals: d.value };
};

export default function ChecklistDefinition({ detail, canManage, canComplete, colleagues }: {
  detail: any;
  canManage: boolean;
  canComplete: boolean;
  colleagues: { id: string; name: string }[];
}) {
  const doc = detail.checklist;
  const [drafts, setDrafts] = useState<Draft[]>(() => (detail.items ?? []).map(toDraft));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [assignee, setAssignee] = useState(colleagues[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const [patientId, setPatientId] = useState("");
  const [contextNote, setContextNote] = useState("");

  const editable = !!doc?.editable;
  const swatch = CHECKLIST_STATE_SWATCH[doc?.status] ?? CHECKLIST_STATE_SWATCH.draft;

  // ⚠ THE STORE-ABSENT AND FAILED STATES COME FIRST AND OFFER NOTHING. Same rule as the library.
  if (detail.state !== "ok" || !doc) {
    return (
      <section className={`rounded-xl border p-4 ${detail.state === "failed" ? "border-rose-200 bg-rose-50/70" : "border-amber-200 bg-amber-50/70"}`}>
        <h1 className="text-[14px] font-bold text-gray-900">
          {detail.state === "failed" ? "This checklist could not be read." : "There is nowhere to store a checklist yet."}
        </h1>
        <p className="mt-1.5 max-w-3xl text-[12px] leading-relaxed text-gray-700">
          {detail.state === "failed"
            ? "A failed read is not an empty checklist. Nothing is shown because nothing is known."
            : "The tables this module writes to have not been created in this deployment."}
        </p>
        {detail.detail && (
          <p className="mt-2 rounded-lg bg-white/70 px-2.5 py-1.5 font-mono text-[11px] text-gray-700">{detail.detail}</p>
        )}
        <a href={CHECKLIST_ROUTE} className="mt-3 inline-block text-[12px] text-gray-600 hover:underline">
          &larr; Back to the library
        </a>
      </section>
    );
  }

  async function call(url: string, body: unknown, method = "POST") {
    setBusy(true); setError(null); setNotice(null);
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(data?.error?.message ?? "That did not work."); return null; }
    return data;
  }

  async function saveItems() {
    const body = {
      items: drafts.map(d => ({
        itemKey: d.itemKey, label: d.label, section: d.section || null, detail: d.detail || null,
        required: d.required, isCritical: d.isCritical, condition: toCondition(d),
      })),
    };
    const out = await call(`/api/v1/practice/checklists/${doc.id}`, body, "PATCH");
    if (out) window.location.reload();
  }

  async function move(action: string, extra: Record<string, unknown> = {}) {
    const out = await call(`/api/v1/practice/checklists/${doc.id}/lifecycle`, { action, ...extra });
    if (out) window.location.reload();
  }

  async function startRun() {
    const out = await call(`/api/v1/practice/checklists/${doc.id}/runs`, {
      patientId: patientId || null, contextNote: contextNote || null,
    });
    if (out) window.location.href = `${CHECKLIST_ROUTE}/${doc.id}/runs/${out.id}`;
  }

  const readiness = detail.readiness;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-gray-500">
        <a href={CHECKLIST_ROUTE} className="hover:underline">&larr; {"Checklist Library"}</a>
        <a href={`${CHECKLIST_ROUTE}/${doc.id}/print`} className="ml-auto hover:underline">Print a blank copy</a>
      </div>

      <header>
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-[12px] text-gray-500">{doc.code}</span>
          <h1 className="text-[18px] font-bold text-gray-900">{doc.title}</h1>
          <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${swatch.chip}`}>{doc.stateLabel}</span>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10.5px] font-semibold text-gray-600">{doc.kindLabel}</span>
          <span className="text-[11px] text-gray-400">v{doc.version}</span>
        </div>
        {doc.purpose && <p className="mt-1 max-w-3xl text-[12.5px] text-gray-600">{doc.purpose}</p>}
        {doc.stateMeaning && <p className="mt-1 max-w-3xl text-[11.5px] text-gray-500">{doc.stateMeaning}</p>}
      </header>

      {/* ⚠ THE STANDING NOTICE, ON THE CHECKLIST ITSELF. */}
      <section className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-3">
        <p className="text-[12.5px] font-bold text-slate-800">
          <span aria-hidden className="mr-1.5">◌</span>{detail.notVerified.headline}
        </p>
        <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-slate-600">{detail.notVerified.detail}</p>
      </section>

      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">{error}</p>}
      {notice && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-800">{notice}</p>}

      {/* ── THE ITEMS ────────────────────────────────────────────────────────────────────────────── */}
      <section className={`${CARD} p-3.5`}>
        <h2 className="text-[13px] font-bold text-gray-900">
          The items
          <span className="ml-2 font-normal text-gray-500">{drafts.length}</span>
        </h2>
        {!editable && (
          <p className="mt-1 text-[11.5px] leading-relaxed text-gray-500">
            This checklist is {String(doc.stateLabel).toLowerCase()} and its items cannot be changed.
            {doc.status === "published"
              ? " Start a new version instead -- the one in use stays exactly as it was approved, and so does every completion record made against it."
              : ""}
          </p>
        )}

        {drafts.length === 0 && (
          <p className="mt-2 rounded-lg border border-dashed border-slate-300 bg-slate-50/70 px-3 py-4 text-center text-[12.5px] text-slate-600">
            Nothing to tick yet. A checklist with no items cannot be put into use.
          </p>
        )}

        <ol className="mt-2 space-y-2">
          {drafts.map((d, i) => (
            <li key={i} className="rounded-lg border border-gray-200 p-2.5">
              <div className="grid gap-2 sm:grid-cols-[3rem_1fr]">
                <span className="pt-2 text-[12px] font-semibold text-gray-400">{i + 1}.</span>
                <div className="space-y-2">
                  <input value={d.label} disabled={!editable} placeholder="What is being checked"
                    onChange={e => setDrafts(ds => ds.map((x, j) => j === i ? { ...x, label: e.target.value } : x))}
                    className={FIELD} />
                  <div className="grid gap-2 sm:grid-cols-3">
                    <label className="block">
                      <span className="mb-1 block text-[10.5px] font-semibold text-gray-500">Name a condition can point at</span>
                      <input value={d.itemKey} disabled={!editable} placeholder="sponge_count"
                        onChange={e => setDrafts(ds => ds.map((x, j) => j === i ? { ...x, itemKey: e.target.value } : x))}
                        className={`${FIELD} font-mono text-[12px]`} />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[10.5px] font-semibold text-gray-500">Section</span>
                      <input value={d.section} disabled={!editable} placeholder="Before induction"
                        onChange={e => setDrafts(ds => ds.map((x, j) => j === i ? { ...x, section: e.target.value } : x))}
                        className={FIELD} />
                    </label>
                    <div className="flex items-end gap-3 pb-1.5">
                      <label className="flex items-center gap-1.5 text-[11.5px] text-gray-700">
                        <input type="checkbox" checked={d.required} disabled={!editable}
                          onChange={e => setDrafts(ds => ds.map((x, j) => j === i ? { ...x, required: e.target.checked } : x))} />
                        Required
                      </label>
                      <label className="flex items-center gap-1.5 text-[11.5px] text-gray-700">
                        <input type="checkbox" checked={d.isCritical} disabled={!editable}
                          onChange={e => setDrafts(ds => ds.map((x, j) => j === i ? { ...x, isCritical: e.target.checked } : x))} />
                        Critical
                      </label>
                    </div>
                  </div>

                  {/* ⚠ EARLIER ITEMS ONLY. See the header. */}
                  <div className="grid gap-2 rounded-lg bg-gray-50 p-2 sm:grid-cols-3">
                    <label className="block">
                      <span className="mb-1 block text-[10.5px] font-semibold text-gray-500">Only ask this when</span>
                      <select value={d.whenKey} disabled={!editable}
                        onChange={e => setDrafts(ds => ds.map((x, j) => j === i ? { ...x, whenKey: e.target.value, op: e.target.value ? (x.op || "equals") : "" } : x))}
                        className={FIELD}>
                        <option value="">Always ask it</option>
                        {drafts.slice(0, i).filter(p => p.itemKey).map(p => (
                          <option key={p.itemKey} value={p.itemKey}>{p.label || p.itemKey}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[10.5px] font-semibold text-gray-500">is</span>
                      <select value={d.op} disabled={!editable || !d.whenKey}
                        onChange={e => setDrafts(ds => ds.map((x, j) => j === i ? { ...x, op: e.target.value } : x))}
                        className={FIELD}>
                        <option value="equals">answered exactly</option>
                        <option value="in">answered any of</option>
                        <option value="isPresent">answered at all</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[10.5px] font-semibold text-gray-500">value</span>
                      {d.op === "isPresent" ? (
                        <select value={d.value} disabled={!editable || !d.whenKey}
                          onChange={e => setDrafts(ds => ds.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}
                          className={FIELD}>
                          <option value="true">yes, it has been answered</option>
                          <option value="false">no, it has not</option>
                        </select>
                      ) : d.op === "in" ? (
                        <input value={d.value} disabled={!editable || !d.whenKey} placeholder="done,not_done"
                          onChange={e => setDrafts(ds => ds.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}
                          className={`${FIELD} font-mono text-[12px]`} />
                      ) : (
                        <select value={d.value} disabled={!editable || !d.whenKey}
                          onChange={e => setDrafts(ds => ds.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}
                          className={FIELD}>
                          {CHECKLIST_RESPONSES.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
                        </select>
                      )}
                    </label>
                  </div>

                  {editable && (
                    <div className="flex gap-2">
                      <button type="button" disabled={i === 0}
                        onClick={() => setDrafts(ds => { const n = [...ds]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })}
                        className={`${BUTTON.quiet} rounded px-2 py-1 text-[11px] font-semibold disabled:opacity-40`}>Move up</button>
                      <button type="button" disabled={i === drafts.length - 1}
                        onClick={() => setDrafts(ds => { const n = [...ds]; [n[i], n[i + 1]] = [n[i + 1], n[i]]; return n; })}
                        className={`${BUTTON.quiet} rounded px-2 py-1 text-[11px] font-semibold disabled:opacity-40`}>Move down</button>
                      <button type="button"
                        onClick={() => setDrafts(ds => ds.filter((_, j) => j !== i))}
                        className={`${BUTTON.quiet} rounded px-2 py-1 text-[11px] font-semibold text-rose-700`}>Remove</button>
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>

        {editable && canManage && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button"
              onClick={() => setDrafts(ds => [...ds, {
                itemKey: `item_${ds.length + 1}`, label: "", section: "", detail: "",
                required: true, isCritical: false, whenKey: "", op: "", value: "done",
              }])}
              className={`${BUTTON.quiet} rounded-lg px-3 py-1.5 text-[12.5px] font-semibold`}>Add an item</button>
            <button type="button" disabled={busy} onClick={saveItems}
              className={`${BUTTON.primary} rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold`}>
              {busy ? "Saving…" : "Save the list"}
            </button>
          </div>
        )}
      </section>

      {/* ── READINESS ────────────────────────────────────────────────────────────────────────────── */}
      {readiness && (
        <section className={`${CARD} p-3.5`}>
          <h2 className="text-[13px] font-bold text-gray-900">Before this can be put into use</h2>
          <ul className="mt-2 space-y-1.5">
            {readiness.checks.map((c: any) => {
              const mark = CHECKLIST_CHECK_SWATCH[c.state] ?? CHECKLIST_CHECK_SWATCH.not_checked;
              return (
                <li key={c.code} className={`rounded-lg border p-2 ${mark.box}`}>
                  <p className={`text-[12px] font-semibold ${mark.text}`}>
                    <span aria-hidden className="mr-1.5">{mark.icon}</span>{c.requirement}
                    <span className="ml-2 rounded bg-white/70 px-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-500">
                      {c.state === "not_checked" ? "not checked" : c.state}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[11.5px] leading-relaxed text-gray-600">{c.detail}</p>
                  {c.wouldNeed && <p className="mt-0.5 text-[11px] text-gray-400">It would take: {c.wouldNeed}</p>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ── LIFECYCLE ────────────────────────────────────────────────────────────────────────────── */}
      {canManage && detail.moves.length > 0 && (
        <section className={`${CARD} p-3.5`}>
          <h2 className="text-[13px] font-bold text-gray-900">What can happen next</h2>
          <ul className="mt-2 space-y-2">
            {detail.moves.map((m: any) => (
              <li key={`${m.from}-${m.to}`} className="rounded-lg border border-gray-200 p-2.5">
                <p className="text-[12.5px] font-semibold text-gray-800">{m.label}</p>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-gray-600">{m.why}</p>
                {m.to === "in_review" && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <select value={assignee} onChange={e => setAssignee(e.target.value)} className={`${FIELD} max-w-[16rem]`}>
                      {colleagues.length === 0 && <option value="">No colleague to send it to</option>}
                      {colleagues.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <button disabled={busy} onClick={() => move("submit", { assignedTo: assignee || null })}
                      className={`${BUTTON.primary} rounded-lg px-3 py-1.5 text-[12px] font-semibold`}>Send</button>
                  </div>
                )}
                {m.to === "draft" && (
                  <button disabled={busy} onClick={() => move("withdraw")}
                    className={`${BUTTON.quiet} mt-2 rounded-lg px-3 py-1.5 text-[12px] font-semibold`}>Take it back</button>
                )}
                {m.to === "approved" && (
                  <button disabled={busy} onClick={() => move("sync")}
                    className={`${BUTTON.quiet} mt-2 rounded-lg px-3 py-1.5 text-[12px] font-semibold`}>Follow the decision</button>
                )}
                {m.to === "published" && (
                  <button disabled={busy} onClick={() => move("publish")}
                    className={`${BUTTON.primary} mt-2 rounded-lg px-3 py-1.5 text-[12px] font-semibold`}>Put it into use</button>
                )}
                {m.to === "archived" && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <input value={reason} onChange={e => setReason(e.target.value)}
                      placeholder="Why is it being withdrawn?" className={`${FIELD} max-w-[24rem]`} />
                    <button disabled={busy} onClick={() => move("archive", { reason })}
                      className={`${BUTTON.quiet} rounded-lg px-3 py-1.5 text-[12px] font-semibold text-rose-700`}>Withdraw</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {doc.status === "published" && (
            <button disabled={busy} onClick={() => move("revise")}
              className={`${BUTTON.quiet} mt-2 rounded-lg px-3 py-1.5 text-[12px] font-semibold`}>
              Start the next version
            </button>
          )}
        </section>
      )}

      {/* ── FILLING IT IN ────────────────────────────────────────────────────────────────────────── */}
      {doc.usable && canComplete && (
        <section className={`${CARD} p-3.5`}>
          <h2 className="text-[13px] font-bold text-gray-900">Fill this in</h2>
          <p className="mt-1 text-[11.5px] leading-relaxed text-gray-500">
            Starts a {CHECKLIST_RUN_NAME} with your name on it and the time it began.
            {doc.run_subject === "patient"
              ? " This checklist is about one patient, so it needs the patient it is being done for."
              : " This checklist is not about a patient, so no patient may be recorded on it."}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {doc.run_subject === "patient" && (
              <input value={patientId} onChange={e => setPatientId(e.target.value)}
                placeholder="Patient" className={`${FIELD} max-w-[20rem]`} />
            )}
            <input value={contextNote} onChange={e => setContextNote(e.target.value)}
              placeholder="Theatre 2, morning round, machine 4…" className={`${FIELD} max-w-[24rem]`} />
            <button disabled={busy} onClick={startRun}
              className={`${BUTTON.primary} rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold`}>Start</button>
          </div>
        </section>
      )}

      {/* ── THE COMPLETION RECORDS ───────────────────────────────────────────────────────────────── */}
      <section className={`${CARD} overflow-hidden`}>
        <h2 className="border-b border-gray-100 px-3.5 py-2 text-[12.5px] font-bold text-gray-900">
          Completion records
          <span className="ml-2 font-normal text-gray-500">
            {detail.runsState === "failed" ? "could not be read" : detail.runs.length}
          </span>
        </h2>
        {detail.runsState === "failed" ? (
          // ⚠ NOT "never used". A failed read is not a zero.
          <p className="p-4 text-[12.5px] text-rose-800">
            The completion records for this checklist could not be read. That is not the same as this
            checklist never having been filled in, and nothing below should be read as a count.
          </p>
        ) : detail.runs.length === 0 ? (
          <p className="p-6 text-center text-[12.5px] text-gray-500">
            Nobody has filled this in yet.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {detail.runs.map((r: any) => (
              <li key={r.id}>
                <a href={r.href} className="block px-3.5 py-2.5 transition hover:bg-gray-50">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-[12.5px] font-semibold text-gray-900">
                      {String(r.started_at).slice(0, 16).replace("T", " ")}
                    </span>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10.5px] font-semibold text-gray-600">
                      {r.stateLabel}
                    </span>
                    <span className="text-[11px] text-gray-400">against v{r.checklist_version}</span>
                  </div>
                  {r.context_note && <p className="mt-0.5 text-[12px] text-gray-600">{r.context_note}</p>}
                  {r.abandoned_reason && <p className="mt-0.5 text-[11.5px] text-amber-800">{r.abandoned_reason}</p>}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── VERSIONS ─────────────────────────────────────────────────────────────────────────────── */}
      {detail.history.length > 0 && (
        <section className={`${CARD} p-3.5`}>
          <h2 className="text-[13px] font-bold text-gray-900">Other versions</h2>
          <ul className="mt-2 space-y-1">
            {detail.history.map((h: any) => (
              <li key={h.id} className="text-[12px]">
                <a href={`${CHECKLIST_ROUTE}/${h.id}`} className="text-gray-800 hover:underline">
                  v{h.version} &mdash; {checklistState(h.status)?.label ?? h.status}
                </a>
                <span className="text-gray-500"> ({h.relation})</span>
                {h.archived_reason && <span className="text-gray-400"> &mdash; {h.archived_reason}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
