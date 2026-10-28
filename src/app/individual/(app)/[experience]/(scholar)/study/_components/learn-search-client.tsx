"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";

// SCH-LEARN-UX-01: the few interactive pieces of the search-first Learn page. Everything else -- every result, count
// and word -- is decided on the server. Nothing here calls an AI or reads the library: selection is the form's own
// checkboxes, renaming goes to the student's own topic corrections, and a bookmark is kept on this device only.

const accent = SCHOLAR.accent;
const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const ghost = `inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-300 bg-white px-4 py-2 text-[14px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 ${focusRing}`;

/**
 * "Teach me using selected sources": the results form's checkboxes (m = documents, s = sections, t = topics) submit
 * to Learn, which starts one session from them through the existing Learn engine. Counts what is ticked.
 */
export function SelectionBar({ formId, max }: { formId: string; max: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;
    const count = () => setN(form.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-source]:checked').length);
    count();
    form.addEventListener("change", count);
    return () => form.removeEventListener("change", count);
  }, [formId]);
  const over = n > max;
  return (
    // Below md it clears the fixed bottom navigation (70px and the safe area); above, it sits at the bottom edge.
    <div className="sticky bottom-[calc(70px_+_env(safe-area-inset-bottom))] z-10 mt-4 md:bottom-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-[13.5px] text-gray-700" aria-live="polite">
        {n === 0 ? "Tick topics, documents or sections to learn from them together." : `${n} source${n === 1 ? "" : "s"} selected${over ? ` -- choose at most ${max}` : ""}.`}
      </p>
      <button type="submit" form={formId} disabled={n === 0 || over}
        className={`inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 py-2 text-[14px] font-semibold text-white hover:opacity-90 disabled:opacity-50 ${focusRing}`} style={{ background: accent }}>
        Teach me using selected sources
      </button>
    </div>
  );
}

// ── bookmarks: personal, on this device only (never a governed record, never sent anywhere) ──────────────────
const KEY = "scholar.learn.topics.bookmarked";
const listeners = new Set<() => void>();
const readRaw = (): string => { try { return window.localStorage.getItem(KEY) ?? "[]"; } catch { return "[]"; } };
const parse = (raw: string): string[] => { try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 50) : []; } catch { return []; } };
const subscribe = (fn: () => void) => { listeners.add(fn); window.addEventListener("storage", fn); return () => { listeners.delete(fn); window.removeEventListener("storage", fn); }; };
function writeBookmarks(list: string[]) {
  try { window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, 50))); } catch { /* not kept */ }
  listeners.forEach(fn => fn());
}
function useBookmarks(): string[] {
  return parse(useSyncExternalStore(subscribe, readRaw, () => "[]"));
}

/** Bookmark and rename one topic (the student's own organisation, apart from governed competencies). */
export function TopicTools({ name }: { name: string }) {
  const marks = useBookmarks();
  const marked = marks.some(m => m.toLowerCase() === name.toLowerCase());
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const toggle = () => writeBookmarks(marked ? marks.filter(m => m.toLowerCase() !== name.toLowerCase()) : [name, ...marks]);
  async function rename(e: React.FormEvent) {
    e.preventDefault();
    const to = value.replace(/\s+/g, " ").trim();
    if (!to || to === name) { setEditing(false); return; }
    setBusy(true); setMsg("");
    const res = await fetch("/api/individual/scholar/topics", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from: name, to }) }).catch(() => null);
    const json = await res?.json().catch(() => ({})) ?? {};
    setBusy(false);
    if (!res?.ok) { setMsg(json.error ?? "Your topic could not be renamed just now."); return; }
    if (marked) writeBookmarks(marks.map(m => (m.toLowerCase() === name.toLowerCase() ? json.name : m)));
    window.location.assign(`${experienceHref("scholar", "study/learn")}?topicView=${encodeURIComponent(json.name)}`);
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={toggle} aria-pressed={marked} className={ghost}>{marked ? "★ Bookmarked" : "☆ Bookmark"}</button>
      {editing ? (
        <form onSubmit={rename} className="flex flex-wrap items-center gap-2">
          <label htmlFor="topic-rename" className="sr-only">New name for this topic</label>
          <input id="topic-rename" value={value} onChange={e => setValue(e.target.value)} maxLength={80} autoFocus
            className={`min-h-[44px] rounded-lg border border-gray-300 px-2.5 py-2 text-[14px] ${focusRing}`} />
          <button type="submit" disabled={busy} className={ghost}>{busy ? "Saving…" : "Save name"}</button>
          <button type="button" onClick={() => { setEditing(false); setValue(name); }} className={ghost}>Cancel</button>
        </form>
      ) : <button type="button" onClick={() => setEditing(true)} className={ghost}>Rename</button>}
      {msg && <p role="alert" className="w-full text-[13px] text-red-700">{msg}</p>}
      <p className="w-full text-[12px] text-gray-500">Renaming changes your own topic name on your sections. It does not change any competency. Bookmarks are kept on this device.</p>
    </div>
  );
}

/** The student's bookmarked topics, on this device, as links. Nothing when there are none. */
export function BookmarkedTopics() {
  const marks = useBookmarks();
  if (!marks.length) return null;
  return (
    <div className="mb-3">
      <h3 className="mb-1.5 text-[12px] font-extrabold uppercase tracking-[0.14em] text-gray-500">Bookmarked</h3>
      <ul className="flex flex-wrap gap-2">
        {marks.slice(0, 12).map(m => (
          <li key={m}>
            <Link href={`${experienceHref("scholar", "study/learn")}?topicView=${encodeURIComponent(m)}`}
              className={`inline-flex min-h-[36px] items-center rounded-full border border-[var(--cmp-theme-border)] bg-[var(--cmp-theme-soft)] px-3 py-1.5 text-[13px] font-semibold text-[var(--cmp-theme-ink)] pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>
              ★ {m}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
