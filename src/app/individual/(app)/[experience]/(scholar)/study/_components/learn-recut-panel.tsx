"use client";

import { useId, useState } from "react";
import { experienceHref } from "@/lib/individual/experiences";
import type { SessionView } from "@/lib/individual/scholar/learn-view";
import { RECUT_TITLE_MAX, citationSummary, lessonsFromView, mergeLessons, recutBody, renameLesson, sameCut, splitLesson, type RecutLesson } from "@/lib/individual/scholar/learn-recut";
import { fieldCls, hintCls, primaryBtn, quietBtn, secondaryBtn } from "./plan-style";

// LEARNING-CLOSE-2026-11 D03 / LE-03: "Change the lessons" of a recorded Learn session. The learner can name a lesson,
// merge one with the next, or split one before a section, then save. The sections of their notes are never changed:
// what is saved (questions, flashcards, attempts, citations, saved explanations, notes on a section) stays with the
// sections. The server (migration 955) re-points lesson progress by containment: a lesson wholly inside an old one keeps
// its record, and a lesson made larger than any old one starts afresh. The page reloads to the re-pointed position.

const API = (id: string) => `/api/individual/scholar/learn/sessions/${encodeURIComponent(id)}/recut`;

export function RecutPanel({ sessionId, steps, titles, accent, disabled = false }: {
  sessionId: string; steps: SessionView["steps"]; titles: (string | null)[] | null; accent: string; disabled?: boolean;
}) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [lessons, setLessons] = useState<RecutLesson[]>(() => lessonsFromView(steps, titles));
  const [renaming, setRenaming] = useState<{ index: number; title: string } | null>(null);
  const [splitting, setSplitting] = useState<{ index: number; before: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const changed = !sameCut(recutBody(lessons), steps, titles);

  function reset() { setLessons(lessonsFromView(steps, titles)); setRenaming(null); setSplitting(null); setError(""); }
  async function save() {
    if (!changed || busy) return;
    setBusy(true); setError("");
    try {
      const res = await fetch(API(sessionId), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(recutBody(lessons)) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(typeof j?.error === "string" ? j.error : "Your lessons could not be changed just now. Nothing was changed."); setBusy(false); return; }
      // Everything on this page is keyed by lesson number: reload to the session as it now is, at the re-pointed position.
      window.location.assign(experienceHref("scholar", `study/learn?session=${encodeURIComponent(sessionId)}`));
    } catch {
      setError("Your lessons could not be changed just now. Nothing was changed."); setBusy(false);
    }
  }

  return (
    <section aria-labelledby={`${uid}-h`} className="rounded-2xl border border-gray-200 bg-white p-4" data-testid="learn-recut">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${uid}-h`} className="text-[15px] font-bold text-gray-900">Change the lessons</h3>
        <button type="button" className={secondaryBtn} aria-expanded={open} aria-controls={`${uid}-body`} disabled={disabled || busy} onClick={() => { if (open) reset(); setOpen(!open); }}>
          {open ? "Close" : "Change the lessons"}
        </button>
      </div>
      {open && (
        <div id={`${uid}-body`} className="mt-3">
          <p className={hintCls}>Name a lesson, merge one with the next, or split one before a section. Your notes stay as they are, and everything you have saved stays with its sections. A lesson that becomes larger than before starts afresh; the rest keep their progress.</p>
          <ol className="mt-3 space-y-2" aria-label="Lessons">
            {lessons.map((l, i) => (
              <li key={`${i}-${l.sections[0]?.chunkId ?? ""}`} className="rounded-lg border border-gray-200 bg-gray-50 p-3" data-testid="recut-lesson">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-[14.5px] font-semibold text-gray-900">{i + 1}. {l.title ?? l.outline}{l.title && <span className="ml-2 text-[12px] font-normal text-gray-600">(your name; from your notes: {l.outline})</span>}</p>
                    <p className="mt-0.5 text-[12.5px] text-gray-600">{l.sections.length} {l.sections.length === 1 ? "section" : "sections"}: {citationSummary(l.sections)}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5 md:max-w-[46%] md:justify-end">
                    <button type="button" className={quietBtn} aria-expanded={renaming?.index === i} disabled={busy} onClick={() => { setSplitting(null); setRenaming(renaming?.index === i ? null : { index: i, title: l.title ?? "" }); }}>Rename</button>
                    {i < lessons.length - 1 && <button type="button" className={quietBtn} disabled={busy} onClick={() => { setSplitting(null); setRenaming(null); setLessons(mergeLessons(lessons, i)); }}>Merge with next</button>}
                    {l.sections.length > 1 && <button type="button" className={quietBtn} aria-expanded={splitting?.index === i} disabled={busy} onClick={() => { setRenaming(null); setSplitting(splitting?.index === i ? null : { index: i, before: Math.max(1, Math.floor(l.sections.length / 2)) }); }}>Split</button>}
                  </div>
                </div>
                {renaming?.index === i && (
                  <form className="mt-2 flex flex-col gap-2 border-t border-gray-200 pt-2 md:flex-row md:items-end" onSubmit={ev => { ev.preventDefault(); setLessons(renameLesson(lessons, i, renaming.title)); setRenaming(null); }}>
                    <label className="block flex-1 text-[13px] font-semibold text-gray-800">
                      Name of this lesson
                      <input className={`${fieldCls} mt-1 font-normal`} value={renaming.title} maxLength={RECUT_TITLE_MAX} autoFocus placeholder={l.outline}
                        onChange={ev => setRenaming({ index: i, title: ev.target.value })} aria-describedby={`${uid}-rename-${i}`} />
                    </label>
                    <p id={`${uid}-rename-${i}`} className="sr-only">Up to {RECUT_TITLE_MAX} characters. Leave it empty to use the name from your notes.</p>
                    <div className="flex gap-1.5">
                      <button type="submit" className={secondaryBtn}>Save name</button>
                      <button type="button" className={quietBtn} onClick={() => setRenaming(null)}>Cancel</button>
                    </div>
                  </form>
                )}
                {splitting?.index === i && (
                  <div className="mt-2 flex flex-col gap-2 border-t border-gray-200 pt-2 md:flex-row md:items-end">
                    <label className="block flex-1 text-[13px] font-semibold text-gray-800">
                      Split before
                      <select className={`${fieldCls} mt-1 font-normal`} value={splitting.before} onChange={ev => setSplitting({ index: i, before: Number(ev.target.value) })}>
                        {l.sections.slice(1).map((s, k) => <option key={s.chunkId} value={k + 1}>{s.citation}</option>)}
                      </select>
                    </label>
                    <div className="flex gap-1.5">
                      <button type="button" className={secondaryBtn} onClick={() => { setLessons(splitLesson(lessons, i, splitting.before)); setSplitting(null); }}>Split here</button>
                      <button type="button" className={quietBtn} onClick={() => setSplitting(null)}>Cancel</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ol>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={primaryBtn} style={{ background: accent }} disabled={!changed || busy} onClick={() => void save()}>{busy ? "Saving…" : "Save the lessons"}</button>
            <button type="button" className={secondaryBtn} disabled={busy} onClick={reset}>Undo changes</button>
          </div>
          {error && <p role="alert" className="mt-2 text-[13.5px] text-red-700">{error}</p>}
        </div>
      )}
    </section>
  );
}
