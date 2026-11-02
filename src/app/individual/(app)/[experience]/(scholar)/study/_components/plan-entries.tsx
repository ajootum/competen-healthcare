"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import type { Occurrence } from "@/lib/individual/learning-plan/types";
import {
  ENTRY_TYPE_OPTIONS, WEEKDAY_NAMES, buildEntryBody, emptyEntryForm, entryDateBounds, timeChoices,
  type EntryForm, type LinkOption,
} from "@/lib/individual/scholar/plan-view";
import { fieldCls, hintCls, labelCls, primaryBtn, secondaryBtn, summaryCls } from "./plan-style";
import { ErrorLine, PlanDialog, callJson, errorOf } from "./plan-ui";

// MY PLAN -> THE LEARNER'S OWN CALENDAR ENTRIES (owner GO "My Plan Calendar Enhancement", 2 Nov 2026).
//
// The compact editor (a native modal dialog with the shared focus doctrine) and the per-entry actions: Edit, Move, Mark done, Delete.
// For a repeating entry, Edit / Mark done / Delete ask "This occurrence" or "The whole series" (the occurrence route versus the series
// routes). Move is always this occurrence. "Mark done" is the learner's word: it is labelled self-reported and is never counted as recorded learning.
// The server checks everything again; client checks only save a round trip. Scholar never edits these entries.

const API = "/api/individual/scholar/plan/entries";

// ── the time line an entry shows ──
export function whenLine(o: Pick<Occurrence, "allDay" | "startTime" | "endTime" | "durationMinutes">): string {
  const t = o.allDay ? "All day" : o.endTime ? `${o.startTime}–${o.endTime}` : `${o.startTime}`;
  return o.durationMinutes ? `${t} · ${o.durationMinutes} min` : t;
}

// ── the editor ──
type EditorMode =
  | { kind: "create"; date: string }
  | { kind: "series"; occ: Occurrence }
  | { kind: "occurrence"; occ: Occurrence };

function formFrom(mode: EditorMode, links: readonly LinkOption[]): EntryForm {
  if (mode.kind === "create") return emptyEntryForm(mode.date);
  const o = mode.occ;
  const linkValue = o.link ? `${o.link.kind}:${o.link.id}` : "";
  return {
    ...emptyEntryForm(o.date), title: o.title, entryType: o.entryType, date: o.date, startTime: o.startTime ?? "", endTime: o.endTime ?? "",
    duration: o.durationMinutes ? String(o.durationMinutes) : "", description: o.description ?? "", link: links.some(l => l.value === linkValue) ? linkValue : "",
  };
}

export function EntryEditor({ mode, today, links, accent, onClose }: { mode: EditorMode; today: string; links: readonly LinkOption[]; accent: string; onClose: () => void }) {
  const router = useRouter();
  const uid = useId();
  const [f, setF] = useState<EntryForm>(() => formFrom(mode, links));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof EntryForm>(k: K, v: EntryForm[K]) => setF(cur => ({ ...cur, [k]: v }));
  const { min, max } = entryDateBounds(today);
  const occOnly = mode.kind === "occurrence";
  const recurringSeries = mode.kind === "series" && mode.occ.recurring;
  const editing = mode.kind !== "create";
  const hasMore = mode.kind !== "create" && !!(f.startTime || f.endTime || f.duration || f.description || f.link);
  const title = mode.kind === "create" ? "Add activity" : occOnly ? "Edit this occurrence" : recurringSeries ? "Edit the whole series" : "Edit activity";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const built = buildEntryBody(f, today, { links, schedule: mode.kind === "create" || (mode.kind === "series" && !mode.occ.recurring) });
    if (!built.ok) { setError(built.error); return; }
    setBusy(true);
    let r;
    if (mode.kind === "create") r = await callJson(API, "POST", built.body);
    else if (mode.kind === "series") r = await callJson(`${API}/${mode.occ.entryId}`, "PATCH", built.body);
    else r = await callJson(`${API}/${mode.occ.entryId}/occurrence`, "POST", { date: mode.occ.occurrenceDate, action: "edited", title: built.body.title, newStart: f.startTime || null, newEnd: f.endTime || null });
    setBusy(false);
    if (!r.ok) { setError(errorOf(r)); return; }
    onClose(); router.refresh();
  }

  return (
    <PlanDialog title={title} onClose={onClose} wide>
      <form className="space-y-4" onSubmit={submit} noValidate>
        {!occOnly && (
          <div>
            <label htmlFor={`${uid}-type`} className={labelCls}>Type</label>
            <select id={`${uid}-type`} className={fieldCls} value={f.entryType} onChange={e => set("entryType", e.target.value as EntryForm["entryType"])}>
              {ENTRY_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        )}
        <div>
          <label htmlFor={`${uid}-title`} className={labelCls}>Title <span className="font-normal text-gray-600">(required)</span></label>
          <input id={`${uid}-title`} className={fieldCls} value={f.title} maxLength={200} required autoComplete="off" onChange={e => set("title", e.target.value)} aria-describedby={`${uid}-title-h`} />
          <p id={`${uid}-title-h`} className={hintCls}>Do not include anything that identifies a patient.</p>
        </div>
        {!occOnly && !recurringSeries && (
          <div className="max-w-xs">
            <label htmlFor={`${uid}-date`} className={labelCls}>Date</label>
            <input id={`${uid}-date`} type="date" className={fieldCls} value={f.date} min={min} max={max} required onChange={e => set("date", e.target.value)} />
          </div>
        )}
        {recurringSeries && <p className={hintCls}>This entry repeats. To change one day, edit or move that occurrence.</p>}
        <details open={hasMore}>
          <summary className={summaryCls}>More: time, notes, link{mode.kind === "create" ? ", repeat" : ""}</summary>
          <div className="mt-2 space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor={`${uid}-st`} className={labelCls}>Starts</label>
                <select id={`${uid}-st`} className={fieldCls} value={f.startTime} onChange={e => set("startTime", e.target.value)}>
                  <option value="">All day</option>{timeChoices([f.startTime]).map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor={`${uid}-en`} className={labelCls}>Ends</label>
                <select id={`${uid}-en`} className={fieldCls} value={f.endTime} onChange={e => set("endTime", e.target.value)}>
                  <option value="">No end time</option>{timeChoices([f.endTime]).map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              {!occOnly && (
                <div>
                  <label htmlFor={`${uid}-dur`} className={labelCls}>Or length (minutes)</label>
                  <input id={`${uid}-dur`} type="number" inputMode="numeric" className={fieldCls} value={f.duration} min={5} max={1440} onChange={e => set("duration", e.target.value)} />
                </div>
              )}
            </div>
            <p className={hintCls}>Choose &quot;All day&quot; for no particular time.</p>
            {!occOnly && (
              <>
                <div>
                  <label htmlFor={`${uid}-desc`} className={labelCls}>Description</label>
                  <textarea id={`${uid}-desc`} className={`${fieldCls} min-h-[72px]`} rows={2} maxLength={2000} value={f.description} onChange={e => set("description", e.target.value)} />
                </div>
                <div>
                  <label htmlFor={`${uid}-link`} className={labelCls}>About a material or topic <span className="font-normal text-gray-600">(optional)</span></label>
                  <select id={`${uid}-link`} className={fieldCls} value={f.link} onChange={e => set("link", e.target.value)}>
                    <option value="">Nothing in particular</option>
                    {links.some(l => l.kind === "material") && <optgroup label="Your materials">{links.filter(l => l.kind === "material").map(l => <option key={l.value} value={l.value}>{l.label}</option>)}</optgroup>}
                    {links.some(l => l.kind === "topic") && <optgroup label="Your topics">{links.filter(l => l.kind === "topic").map(l => <option key={l.value} value={l.value}>{l.label}</option>)}</optgroup>}
                  </select>
                </div>
              </>
            )}
            {mode.kind === "create" && (
              <fieldset className="space-y-3">
                <legend className={labelCls}>Repeat</legend>
                <div className="max-w-xs">
                  <label htmlFor={`${uid}-rep`} className="sr-only">Repeat</label>
                  <select id={`${uid}-rep`} className={fieldCls} value={f.repeat} onChange={e => set("repeat", e.target.value as EntryForm["repeat"])}>
                    <option value="none">Does not repeat</option>
                    <option value="daily">Every day</option>
                    <option value="weekly">Every week</option>
                  </select>
                </div>
                {f.repeat === "weekly" && (
                  <fieldset>
                    <legend className="text-[13px] font-semibold text-gray-800">On these days</legend>
                    <ul className="mt-1 flex flex-wrap gap-2">
                      {WEEKDAY_NAMES.map((n, i) => {
                        const on = f.weekdays.includes(i);
                        return (
                          <li key={n}>
                            <label className={`inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center gap-1 rounded-xl border px-3 text-[13.5px] font-semibold pointer-coarse:min-h-[var(--cmp-touch-min)] ${on ? "border-gray-900 bg-gray-50 ring-2 ring-gray-900" : "border-gray-300 bg-white"}`}>
                              <input type="checkbox" className="h-4 w-4" checked={on} onChange={() => set("weekdays", on ? f.weekdays.filter(d => d !== i) : [...f.weekdays, i])} />
                              <span aria-hidden>{n.slice(0, 3)}</span><span className="sr-only">{n}</span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </fieldset>
                )}
                {f.repeat !== "none" && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label htmlFor={`${uid}-end`} className={labelCls}>It ends</label>
                      <select id={`${uid}-end`} className={fieldCls} value={f.endMode} onChange={e => set("endMode", e.target.value as EntryForm["endMode"])}>
                        <option value="until">On a date</option>
                        <option value="count">After a number of times</option>
                      </select>
                    </div>
                    {f.endMode === "until" ? (
                      <div>
                        <label htmlFor={`${uid}-until`} className={labelCls}>Last day</label>
                        <input id={`${uid}-until`} type="date" className={fieldCls} value={f.until} min={f.date} max={max} onChange={e => set("until", e.target.value)} />
                      </div>
                    ) : (
                      <div>
                        <label htmlFor={`${uid}-count`} className={labelCls}>Number of times (1 to 200)</label>
                        <input id={`${uid}-count`} type="number" inputMode="numeric" className={fieldCls} value={f.count} min={1} max={200} onChange={e => set("count", e.target.value)} />
                      </div>
                    )}
                  </div>
                )}
              </fieldset>
            )}
          </div>
        </details>
        <ErrorLine text={error} />
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={primaryBtn} style={{ background: accent }} disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Add to my calendar"}</button>
          <button type="button" className={secondaryBtn} disabled={busy} onClick={onClose}>Cancel</button>
        </div>
      </form>
    </PlanDialog>
  );
}

/** "Add activity": the button and its editor. */
export function AddActivity({ accent, today, links, date }: { accent: string; today: string; links: readonly LinkOption[]; date?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={primaryBtn} style={{ background: accent }} onClick={() => setOpen(true)}>Add activity</button>
      {open && <EntryEditor mode={{ kind: "create", date: date ?? today }} today={today} links={links} accent={accent} onClose={() => setOpen(false)} />}
    </>
  );
}
// ── a repeating entry: this occurrence, or the whole series ──
function ScopeDialog({ title, lead, thisLabel, seriesLabel, onThis, onSeries, onClose, busy, error }: {
  title: string; lead: string; thisLabel: string; seriesLabel: string; onThis: () => void; onSeries: () => void; onClose: () => void; busy: boolean; error: string;
}) {
  return (
    <PlanDialog title={title} onClose={onClose}>
      <p className="text-[14px] text-gray-800">{lead}</p>
      <div className="mt-3 flex flex-col gap-2">
        <button type="button" className={secondaryBtn} disabled={busy} onClick={onThis}>{thisLabel}</button>
        <button type="button" className={secondaryBtn} disabled={busy} onClick={onSeries}>{seriesLabel}</button>
        <button type="button" className={secondaryBtn} disabled={busy} onClick={onClose}>Cancel</button>
      </div>
      <div className="mt-2"><ErrorLine text={error} /></div>
    </PlanDialog>
  );
}

type Step = null | "edit-scope" | "edit-series" | "edit-occ" | "move" | "done-scope" | "delete-scope" | "delete-confirm";

/** The actions of one of the learner's own entries. Owns its dialogs. */
export function EntryActions({ occ, today, links, accent }: { occ: Occurrence; today: string; links: readonly LinkOption[]; accent: string }) {
  const router = useRouter();
  const uid = useId();
  const [step, setStep] = useState<Step>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [to, setTo] = useState(occ.date);
  const { min, max } = entryDateBounds(today);
  const close = () => { setStep(null); setError(""); };
  const cancelled = occ.status === "cancelled";

  async function run(promise: Promise<Awaited<ReturnType<typeof callJson>>>) {
    setBusy(true); setError("");
    const r = await promise;
    setBusy(false);
    if (!r.ok) { setError(errorOf(r)); return; }
    close(); router.refresh();
  }
  const occCall = (body: Record<string, unknown>) => callJson(`${API}/${occ.entryId}/occurrence`, "POST", { date: occ.occurrenceDate, ...body });
  const canDone = occ.entryType === "study_session" && occ.status === "planned";
  if (cancelled) return null;

  return (
    <>
      <button type="button" className={secondaryBtn} onClick={() => setStep(occ.recurring ? "edit-scope" : "edit-series")}>Edit<span className="sr-only">: {occ.title}</span></button>
      <button type="button" className={secondaryBtn} onClick={() => { setTo(occ.date); setStep("move"); }}>Move<span className="sr-only">: {occ.title}</span></button>
      {canDone && <button type="button" className={secondaryBtn} onClick={() => (occ.recurring ? setStep("done-scope") : void run(callJson(`${API}/${occ.entryId}`, "PATCH", { status: "completed" })))} disabled={busy}>Mark done<span className="sr-only">: {occ.title}</span></button>}
      <button type="button" className={secondaryBtn} onClick={() => setStep(occ.recurring ? "delete-scope" : "delete-confirm")}>Delete<span className="sr-only">: {occ.title}</span></button>

      {step === "edit-scope" && <ScopeDialog title="Edit a repeating entry" lead={`"${occ.title}" repeats. What do you want to change?`} thisLabel="This occurrence" seriesLabel="The whole series" busy={false} error=""
        onThis={() => setStep("edit-occ")} onSeries={() => setStep("edit-series")} onClose={close} />}
      {step === "edit-series" && <EntryEditor mode={{ kind: "series", occ }} today={today} links={links} accent={accent} onClose={close} />}
      {step === "edit-occ" && <EntryEditor mode={{ kind: "occurrence", occ }} today={today} links={links} accent={accent} onClose={close} />}

      {step === "move" && (
        <PlanDialog title="Move this entry" onClose={close}>
          <form onSubmit={e => { e.preventDefault(); if (to === occ.date) { close(); return; } void run(occCall({ action: "moved", newDate: to })); }}>
            <p className="text-[14px] text-gray-800">{occ.title}</p>
            <label htmlFor={`${uid}-mv`} className={`${labelCls} mt-3`}>Move to</label>
            <input id={`${uid}-mv`} type="date" className={`${fieldCls} max-w-xs`} value={to} min={min} max={max} required onChange={e => setTo(e.target.value)} />
            {occ.recurring && <p className={hintCls}>Only this occurrence moves. The rest of the series stays where it is.</p>}
            <div className="mt-3"><ErrorLine text={error} /></div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="submit" className={primaryBtn} style={{ background: accent }} disabled={busy}>{busy ? "Saving…" : "Save the new day"}</button>
              <button type="button" className={secondaryBtn} disabled={busy} onClick={close}>Cancel</button>
            </div>
          </form>
        </PlanDialog>
      )}

      {step === "done-scope" && <ScopeDialog title="Mark done" lead="This is your own word: it is shown as self-reported and is not counted as recorded learning." thisLabel="This occurrence" seriesLabel="The whole series" busy={busy} error={error}
        onThis={() => void run(occCall({ action: "completed" }))} onSeries={() => void run(callJson(`${API}/${occ.entryId}`, "PATCH", { status: "completed" }))} onClose={close} />}

      {step === "delete-scope" && <ScopeDialog title="Delete a repeating entry" lead={`"${occ.title}" repeats. What do you want to delete?`} thisLabel="This occurrence" seriesLabel="The whole series" busy={busy} error={error}
        onThis={() => void run(occCall({ action: "cancelled" }))} onSeries={() => void run(callJson(`${API}/${occ.entryId}`, "DELETE"))} onClose={close} />}

      {step === "delete-confirm" && (
        <PlanDialog title="Delete this entry?" onClose={close}>
          <p className="text-[14px] text-gray-800">&quot;{occ.title}&quot; on {occ.date} will be removed from your calendar. Your study plan is not changed.</p>
          <div className="mt-3"><ErrorLine text={error} /></div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={primaryBtn} style={{ background: accent }} disabled={busy} onClick={() => void run(callJson(`${API}/${occ.entryId}`, "DELETE"))}>{busy ? "Deleting…" : "Delete"}</button>
            <button type="button" className={secondaryBtn} disabled={busy} onClick={close}>Keep it</button>
          </div>
        </PlanDialog>
      )}
    </>
  );
}
