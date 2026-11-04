"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { DisclaimerBadge, LearningIcon, LearningSectionHead, learnBox, learnTone, type LearningIconName, type LearningTone } from "@/components/ui/scholar-learning";
import { ACTIVITY_LABEL, ASK_NOT_KEPT, REQUEST_KEY, newRequestKey, type CapturedActivity, type HistoryActivity } from "@/lib/individual/scholar/search-history";
import { HISTORY_ROUTE, recordHistory } from "@/lib/individual/scholar/search-history-capture";
import { snippetParts } from "@/lib/individual/scholar/saved-library";
import { focusRing } from "../../../../../_components/chrome";

// SCHOLAR-SEARCH-HISTORY-01 -- the interactive parts of My Search History (study/saved/searches) and its two capture pieces.
// Everything shown is decided on the server (the page). Pin, Save for revision (the library's own 820 bookmark), Remove and
// Clear go to the learner's own routes and refresh the page. Nothing here calls an AI. Every "open" link opens something kept;
// "Continue the lesson" is the one link into Learn, always the learner's click (search-history.ts entryLinks).
// Design: the Scholar Learning Design System (docs/design/SCHOLAR-LEARNING-DESIGN-SYSTEM.md): each activity names a learning
// tone and an icon, and carries its meaning in words; one edge per level (the rows sit on white inside one section).

export type ClientEntry = {
  key: string; activity: HistoryActivity; title: string; when: string; whenIso: string; meta: string[];
  headline: string | null; pinned: boolean; links: { label: string; href: string; kind: "open" | "continue" }[];
  save: { targetKind: "artefact"; artefactId: string } | { targetKind: "lesson"; sessionId: string; step: number } | null;
  ai: boolean; askNotKept: boolean;
};

const TONE: Record<HistoryActivity, { tone: LearningTone; icon: LearningIconName }> = {
  material_search: { tone: "sources", icon: "book" }, library_search: { tone: "notes", icon: "library" }, ask: { tone: "aiBeyond", icon: "chat" },
  teaching: { tone: "teach", icon: "teach" }, research: { tone: "aiBeyond", icon: "compass" }, lesson: { tone: "next", icon: "lesson" },
};
const btn = `inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-[13px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;
const linkCls = `inline-flex min-h-[40px] items-center px-1 text-[13.5px] font-semibold text-gray-900 underline underline-offset-2 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;

function Snippet({ headline }: { headline: string }) {
  return <p className="mt-1 break-words text-[13.5px] leading-relaxed text-gray-800">{snippetParts(headline, 280).map((p, i) => (p.mark ? <mark key={i} className="rounded bg-amber-100 px-0.5 text-gray-900">{p.text}</mark> : <span key={i}>{p.text}</span>))}</p>;
}

async function send(url: string, init: RequestInit): Promise<{ ok: boolean; error?: string }> {
  const r = await fetch(url, init).catch(() => null);
  const j = await r?.json().catch(() => ({})) ?? {};
  return r?.ok ? { ok: true } : { ok: false, error: (j as { error?: string }).error ?? "That could not be done just now." };
}

function Row({ e, notesOn }: { e: ClientEntry; notesOn: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string>("");
  const [msg, setMsg] = useState<string>("");
  const [saved, setSaved] = useState(false);
  const t = TONE[e.activity];
  async function act(kind: "pin" | "save" | "remove") {
    setBusy(kind); setMsg("");
    const r = kind === "pin" ? await send(HISTORY_ROUTE, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: e.key, pinned: !e.pinned }) })
      : kind === "remove" ? await send(`${HISTORY_ROUTE}?key=${encodeURIComponent(e.key)}`, { method: "DELETE" })
        : await send("/api/individual/scholar/library/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "bookmark", ...e.save }) });
    setBusy("");
    if (!r.ok) { setMsg(r.error ?? ""); return; }
    if (kind === "save") { setSaved(true); return; }
    router.refresh();
  }
  return (
    <li className="py-3.5" data-entry={e.key} data-activity={e.activity}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-gray-600">
        <span className={`${learnTone(t.tone)} inline-flex items-center gap-1.5 rounded-full border border-[var(--learn-border)] bg-[var(--learn-surface)] px-2.5 py-0.5 font-semibold text-[var(--learn-ink)]`}>
          <span className="cmp-learn-accent"><LearningIcon name={t.icon} className="h-4 w-4" /></span>{ACTIVITY_LABEL[e.activity]}
        </span>
        <time dateTime={e.whenIso}>{e.when}</time>
        {e.pinned && <span className="inline-flex items-center gap-1 font-semibold text-gray-900"><span aria-hidden>📌</span>Pinned</span>}
      </div>
      <p className="mt-1 break-words text-[15px] font-semibold text-gray-900">{e.title}</p>
      {e.meta.length > 0 && <p className="mt-0.5 break-words text-[12.5px] text-gray-600">{e.meta.join(" · ")}</p>}
      {e.headline && <Snippet headline={e.headline} />}
      {e.ai && <DisclaimerBadge className="mt-1.5">AI-generated from your notes, not clinically reviewed</DisclaimerBadge>}
      {e.askNotKept && <p className="mt-1 text-[12.5px] text-gray-600">{ASK_NOT_KEPT}</p>}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        {e.links.map(l => <Link key={l.href} href={l.href} prefetch={false} className={linkCls} data-link={l.kind}>{l.label}</Link>)}
        <span className="flex flex-wrap items-center gap-2">
          <button type="button" className={btn} disabled={!!busy} aria-pressed={e.pinned} onClick={() => act("pin")}>{busy === "pin" ? "…" : e.pinned ? "Unpin" : "Pin"}</button>
          {notesOn && e.save && <button type="button" className={btn} disabled={!!busy || saved} onClick={() => act("save")}>{saved ? "Saved for revision" : busy === "save" ? "Saving…" : "Save for revision"}</button>}
          <button type="button" className={btn} disabled={!!busy} onClick={() => act("remove")} aria-label={`Remove from history: ${e.title}`}>{busy === "remove" ? "Removing…" : "Remove"}</button>
        </span>
      </div>
      {msg && <p role="alert" className="mt-1 text-[13px] text-red-700">{msg}</p>}
    </li>
  );
}

/** The history list in one section (one edge), newest first, each row an entry. */
export function HistoryList({ entries, title, notesOn, empty, id }: { entries: ClientEntry[]; title: string; notesOn: boolean; empty: string; id: string }) {
  // data-ready once hydrated, so a scripted walk never clicks a control before it works.
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { ref.current?.setAttribute("data-ready", "1"); }, []);
  return (
    <section ref={ref} aria-labelledby={`${id}-h`} className={`${learnBox("next")} p-4 sm:p-5`} data-testid={id}>
      <LearningSectionHead id={`${id}-h`} icon="list" title={title} level={2} />
      {entries.length === 0
        ? <p className="mt-3 rounded-xl bg-[var(--cmp-app-surface)] p-4 text-[14px] text-gray-700">{empty}</p>
        : <ul className="mt-3 divide-y divide-gray-200 rounded-xl bg-[var(--cmp-app-surface)] px-4">{entries.map(e => <Row key={e.key} e={e} notesOn={notesOn} />)}</ul>}
    </section>
  );
}

/** Clear the whole history, after an explicit second step. Saved learning, lessons, answers and materials stay. */
export function ClearHistory({ count }: { count: number }) {
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
  if (!asking) return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className={btn} disabled={count === 0} onClick={() => setAsking(true)} data-testid="history-clear">Clear search history…</button>
      {msg && <p role="status" className="text-[13px] text-gray-700">{msg}</p>}
    </div>
  );
  return (
    <div role="group" aria-labelledby={`${uid}-q`} className="rounded-xl border-2 border-gray-900 bg-white p-3" data-testid="history-clear-confirm">
      <p id={`${uid}-q`} className="text-[14px] font-semibold text-gray-900">Clear your whole search history?</p>
      <p className="mt-0.5 text-[13px] text-gray-700">Every entry goes, pinned ones too. Your saved learning, lessons, answers, notes and materials are not deleted.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button ref={confirmRef} type="button" className={`${btn} border-gray-900 bg-gray-900 text-white hover:bg-gray-800`} disabled={busy} onClick={clear}>{busy ? "Clearing…" : "Yes, clear my search history"}</button>
        <button type="button" className={btn} disabled={busy} onClick={() => setAsking(false)}>Cancel</button>
      </div>
      {msg && <p role="alert" className="mt-1 text-[13px] text-red-700">{msg}</p>}
    </div>
  );
}

// ── CAPTURE: a server-rendered search form and its results page ──────────────────────────────────────────

/**
 * A hidden `hk` field for a GET search form: a fresh request key on every SUBMIT (never on a keystroke). The results page
 * carries it in its address, so a reload of the same results is the same history entry, never a second one.
 */
export function HistoryKeyInput() {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const input = ref.current, form = input?.form;
    if (!input || !form) return;
    // A key from the moment the form can be used, and a fresh one on every submit (the same page can be searched again).
    input.value = newRequestKey();
    const onSubmit = () => { input.value = newRequestKey(); };
    form.addEventListener("submit", onSubmit);
    return () => form.removeEventListener("submit", onSubmit);
  }, []);
  // The value is written after hydration (above), and a browser must not restore an old key on reload: autoComplete off.
  return <input ref={ref} type="hidden" name="hk" defaultValue="" autoComplete="off" suppressHydrationWarning />;
}

/** Keeps one submitted search once its results are shown: only with the form's own key (no key, no entry). Renders nothing. */
export function RecordSearch({ activity, query, requestKey, resultCount, materialId = null }: { activity: CapturedActivity; query: string; requestKey: string | null; resultCount: number | null; materialId?: string | null }) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !requestKey || !REQUEST_KEY.test(requestKey)) return;
    done.current = true;
    void recordHistory({ activity, query, requestKey, resultCount, materialId });
  }, [activity, query, requestKey, resultCount, materialId]);
  return null;
}
