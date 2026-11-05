"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { DisclaimerBadge, LearningIcon, learnTone, type LearningIconName, type LearningTone } from "@/components/ui/scholar-learning";
import { ACTIVITY_LABEL, ASK_ROW_NOTE, REQUEST_KEY, newRequestKey, type CapturedActivity, type HistoryActivity } from "@/lib/individual/scholar/search-history";
import { HISTORY_ROUTE, recordHistory } from "@/lib/individual/scholar/search-history-capture";
import { snippetParts } from "@/lib/individual/scholar/saved-library";
import { AI_LABEL } from "@/lib/individual/scholar/config";
import { focusRing } from "../../../../../_components/chrome";
import { useSearchHistoryChoice } from "../../../../../_components/SearchHistoryChoice";

// SCHOLAR-SEARCH-HISTORY-01 -- the interactive parts of My Search History (study/saved/searches, the owner's mock-up: one card, icon-tile
// rows, a chevron that opens the saved item) and its two capture pieces. Everything shown is decided on the server (the page), from the
// learner's real records. Pin, Save for revision (the library's own 820 bookmark), Remove and Clear go to the learner's own routes and
// refresh the page. Nothing here calls an AI. The chevron is always an "open" link to something kept; "Continue the lesson" is the one
// link into Learn, in the row's menu, always the learner's click (search-history.ts entryLinks). Design: the Scholar Learning Design
// System (docs/design/SCHOLAR-LEARNING-DESIGN-SYSTEM.md): each activity names a learning tone and an icon, and says what it is in words.

export type ClientEntry = {
  key: string; activity: HistoryActivity; title: string; when: string; whenIso: string; meta: string[];
  headline: string | null; pinned: boolean;
  primary: { label: string; href: string } | null; rest: { label: string; href: string; kind: "open" | "continue" }[];
  save: { targetKind: "artefact"; artefactId: string } | { targetKind: "lesson"; sessionId: string; step: number } | null;
  ai: boolean; askNotKept: boolean;
};

// The mock-up's icons: speech bubble = Ask Scholar, magnifier = a search, open book = a lesson, books = research.
const TONE: Record<HistoryActivity, { tone: LearningTone; icon: LearningIconName }> = {
  material_search: { tone: "sources", icon: "search" }, library_search: { tone: "notes", icon: "search" }, ask: { tone: "aiBeyond", icon: "chat" },
  teaching: { tone: "teach", icon: "book" }, research: { tone: "aiBeyond", icon: "library" }, lesson: { tone: "next", icon: "book" },
};
const btn = `inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-[13px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;
const menuItem = `flex min-h-[40px] w-full items-center rounded-lg px-3 py-1.5 text-left text-[13.5px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;

function Snippet({ headline }: { headline: string }) {
  return <p className="mt-1 break-words text-[13.5px] leading-relaxed text-gray-800">{snippetParts(headline, 280).map((p, i) => (p.mark ? <mark key={i} className="rounded bg-amber-100 px-0.5 text-gray-900">{p.text}</mark> : <span key={i}>{p.text}</span>))}</p>;
}

async function send(url: string, init: RequestInit): Promise<{ ok: boolean; error?: string }> {
  const r = await fetch(url, init).catch(() => null);
  const j = await r?.json().catch(() => ({})) ?? {};
  return r?.ok ? { ok: true } : { ok: false, error: (j as { error?: string }).error ?? "That could not be done just now." };
}

/** The row's overflow menu: a disclosure of real controls, closed by Escape or a click elsewhere. Above the row's stretched link. */
function RowMenu({ e, notesOn }: { e: ClientEntry; notesOn: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [saved, setSaved] = useState(false);
  const [msg, setMsg] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (ev: PointerEvent) => { if (!box.current?.contains(ev.target as Node)) setOpen(false); };
    const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  async function act(kind: "pin" | "save" | "remove") {
    setBusy(kind); setMsg("");
    const r = kind === "pin" ? await send(HISTORY_ROUTE, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: e.key, pinned: !e.pinned }) })
      : kind === "remove" ? await send(`${HISTORY_ROUTE}?key=${encodeURIComponent(e.key)}`, { method: "DELETE" })
        : await send("/api/individual/scholar/library/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "bookmark", ...e.save }) });
    setBusy("");
    if (!r.ok) { setMsg(r.error ?? ""); return; }
    if (kind === "save") { setSaved(true); return; }
    setOpen(false);
    router.refresh();
  }
  return (
    // Open, it lifts above the rows after it (each row's control is its own stacking context, and later ones would paint through the menu).
    <div ref={box} className={`relative shrink-0 ${open ? "z-40" : "z-10"}`}>
      <button ref={trigger} type="button" aria-expanded={open} aria-label={`More for: ${e.title}`} onClick={() => setOpen(o => !o)} data-testid="row-menu"
        className={`inline-flex h-10 w-10 items-center justify-center rounded-lg text-[18px] font-bold leading-none text-gray-700 hover:bg-gray-100 pointer-coarse:h-[var(--cmp-touch-min)] pointer-coarse:w-[var(--cmp-touch-min)] ${focusRing}`}>
        <span aria-hidden>⋯</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-[15rem] max-w-[calc(100vw-3rem)] rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg">
          {e.rest.map(l => <Link key={l.href} href={l.href} prefetch={false} className={menuItem} data-link={l.kind}>{l.label}</Link>)}
          <button type="button" className={menuItem} disabled={!!busy} aria-pressed={e.pinned} onClick={() => act("pin")}>{busy === "pin" ? "…" : e.pinned ? "Unpin" : "Pin"}</button>
          {notesOn && e.save && <button type="button" className={menuItem} disabled={!!busy || saved} onClick={() => act("save")}>{saved ? "Saved for revision" : busy === "save" ? "Saving…" : "Save for revision"}</button>}
          <button type="button" className={menuItem} disabled={!!busy} onClick={() => act("remove")} aria-label={`Remove from history: ${e.title}`}>{busy === "remove" ? "Removing…" : "Remove"}</button>
          {msg && <p role="alert" className="px-3 py-1 text-[13px] text-red-700">{msg}</p>}
        </div>
      )}
    </div>
  );
}

function Row({ e, notesOn }: { e: ClientEntry; notesOn: boolean }) {
  const t = TONE[e.activity];
  return (
    <li className="relative flex items-start gap-3 py-3" data-entry={e.key} data-activity={e.activity}>
      <span className={`${learnTone(t.tone)} cmp-learn-accent inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--learn-border)] bg-[var(--learn-surface)]`}>
        <LearningIcon name={t.icon} className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        {/* The title is the row's link: stretched over the row, so the chevron and the whole row open the saved item. */}
        <p className="break-words text-[15px] font-bold leading-snug text-gray-900">
          {e.primary
            ? <Link href={e.primary.href} prefetch={false} data-link="open" className={`after:absolute after:inset-0 after:rounded-xl hover:underline ${focusRing}`}><span className="sr-only">{e.primary.label}: </span>{e.title}</Link>
            : e.title}
        </p>
        <p className="mt-0.5 break-words text-[13px] text-gray-600">
          {ACTIVITY_LABEL[e.activity]} · <time dateTime={e.whenIso}>{e.when}</time>
          {e.pinned && <span className="font-semibold text-gray-900"> · Pinned</span>}
          {e.askNotKept && <span> · {ASK_ROW_NOTE}</span>}
        </p>
        {e.meta.length > 0 && <p className="mt-0.5 break-words text-[12.5px] text-gray-600">{e.meta.join(" · ")}</p>}
        {e.headline && <Snippet headline={e.headline} />}
        {/* Only where AI-written words are on the row: its search snippet. */}
        {e.ai && e.headline && <DisclaimerBadge className="mt-1.5">{AI_LABEL}</DisclaimerBadge>}
      </div>
      <RowMenu e={e} notesOn={notesOn} />
      {e.primary && <span aria-hidden className="mt-2.5 shrink-0 text-gray-500"><LearningIcon name="chevron" className="h-5 w-5" /></span>}
    </li>
  );
}

/** A list of rows. data-ready once hydrated, so a scripted walk never clicks a control before it works. */
export function HistoryList({ entries, heading, notesOn, id }: { entries: ClientEntry[]; heading?: string; notesOn: boolean; id: string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { ref.current?.setAttribute("data-ready", "1"); }, []);
  return (
    <section ref={ref} aria-label={heading ?? "Your history"} data-testid={id}>
      {heading && <h2 className="mt-4 text-[12px] font-bold uppercase tracking-[0.1em] text-gray-500">{heading}</h2>}
      <ul className="mt-1 divide-y divide-gray-200">{entries.map(e => <Row key={e.key} e={e} notesOn={notesOn} />)}</ul>
    </section>
  );
}

/** The card's heading: title, subtitle, Clear all (after an explicit second step) and the history icon. */
export function HistoryHeader({ count }: { count: number }) {
  const router = useRouter();
  const uid = useId();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (asking) confirmRef.current?.focus(); }, [asking]);
  async function clear() {
    setBusy(true); setMsg("");
    const r = await send(`${HISTORY_ROUTE}?all=1&confirm=CLEAR`, { method: "DELETE" });
    setBusy(false);
    if (!r.ok) { setMsg(r.error ?? ""); return; }
    setAsking(false); setMsg("Your search history is cleared.");
    router.refresh();
  }
  return (
    <>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[22px] font-bold tracking-tight text-gray-900">My Search History</h1>
          <p className="mt-0.5 text-[14px] text-gray-600">Find your previous searches and learning questions</p>
        </div>
        <button type="button" className={btn} disabled={count === 0 || asking} onClick={() => setAsking(true)} data-testid="history-clear">Clear all</button>
        <span aria-hidden className={`${learnTone("next")} cmp-learn-accent inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--learn-border)] bg-[var(--learn-surface)]`}><LearningIcon name="clock" className="h-5 w-5" /></span>
      </div>
      {msg && !asking && <p role="status" className="mt-2 text-[13px] text-gray-700">{msg}</p>}
      {asking && (
        <div role="group" aria-labelledby={`${uid}-q`} className="mt-3 rounded-xl border-2 border-gray-900 bg-white p-3" data-testid="history-clear-confirm">
          <p id={`${uid}-q`} className="text-[14px] font-semibold text-gray-900">Clear your whole search history?</p>
          <p className="mt-0.5 text-[13px] text-gray-700">Every entry goes, pinned ones too, and this cannot be undone here. Your saved learning, lessons, answers, notes and materials are not deleted.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button ref={confirmRef} type="button" className={`${btn} border-gray-900 bg-gray-900 text-white hover:bg-gray-800`} disabled={busy} onClick={clear}>{busy ? "Clearing…" : "Yes, clear my search history"}</button>
            <button type="button" className={btn} disabled={busy} onClick={() => setAsking(false)}>Cancel</button>
          </div>
          {msg && <p role="alert" className="mt-1 text-[13px] text-red-700">{msg}</p>}
        </div>
      )}
    </>
  );
}

// ── CAPTURE: a server-rendered search form and its results page ──────────────────────────────────────────

/**
 * A hidden `hk` field for a GET search form: a fresh request key on every SUBMIT (never on a keystroke). The results page
 * carries it in its address, so a reload of the same results is the same history entry, never a second one.
 */
export function HistoryKeyInput() {
  const ref = useRef<HTMLInputElement>(null);
  const { on } = useSearchHistoryChoice();
  useEffect(() => {
    const input = ref.current, form = input?.form;
    if (!input || !form) return;
    // A key from the moment the form can be used, and a fresh one on every submit (the same page can be searched again).
    input.value = newRequestKey();
    const onSubmit = () => { input.value = newRequestKey(); };
    form.addEventListener("submit", onSubmit);
    return () => form.removeEventListener("submit", onSubmit);
  }, [on]);
  // With My Search History off a submit carries no key, so nothing can be kept from it.
  if (!on) return null;
  // The value is written after hydration (above), and a browser must not restore an old key on reload: autoComplete off.
  return <input ref={ref} type="hidden" name="hk" defaultValue="" autoComplete="off" suppressHydrationWarning />;
}

/** Keeps one submitted search once its results are shown: only with the form's own key (no key, no entry). Renders nothing. */
export function RecordSearch({ activity, query, requestKey, resultCount, materialId = null }: { activity: CapturedActivity; query: string; requestKey: string | null; resultCount: number | null; materialId?: string | null }) {
  const done = useRef(false);
  const { on } = useSearchHistoryChoice();
  useEffect(() => {
    if (!on || done.current || !requestKey || !REQUEST_KEY.test(requestKey)) return;
    done.current = true;
    void recordHistory({ activity, query, requestKey, resultCount, materialId });
  }, [on, activity, query, requestKey, resultCount, materialId]);
  return null;
}
