"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LearningIcon, learnAction, learnBox } from "@/components/ui/scholar-learning";
import { experienceHref } from "@/lib/individual/experiences";
import { IDEAS, NOTEBOOK_PAGE, noteHeading, type NoteDraft } from "@/lib/individual/scholar/personal-notebook";
import type { NotebookNote } from "@/lib/individual/scholar/personal-notebook-store";
import { DraftRecovery, notebookHref } from "./note-capture";
import { rememberRestoredDraft } from "./note-editor";

// COMPETEN-NOTEBOOK-001 P1: the parts of My Notebook. The first thing on the page is a place to start writing, with nothing to fill in first.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export type NotebookCard = { note: NotebookNote; where: string | null; headline?: string | null };

/** A snippet from search: the marked words as <mark>, split as text and never read as HTML. */
function Marked({ text }: { text: string }) {
  const parts = text.split(/(\{\{hl\}\}.*?\{\{\/hl\}\})/g).filter(Boolean);
  return <>{parts.map((p, i) => { const m = /^\{\{hl\}\}(.*)\{\{\/hl\}\}$/.exec(p); return m ? <mark key={i} className="rounded bg-[var(--cmp-learn-ideas-border)] px-0.5 text-gray-900">{m[1]}</mark> : <span key={i}>{p}</span>; })}</>;
}

export function NoteCard({ card, pinnable = true }: { card: NotebookCard; pinnable?: boolean }) {
  const n = card.note;
  const [pinned, setPinned] = useState(!!n.pinnedAt);
  const [revision, setRevision] = useState(n.revision);
  const [msg, setMsg] = useState<string | null>(null);
  const togglePin = async () => {
    const next = !pinned;
    setPinned(next); setMsg(null);
    const res = await fetch(`/api/individual/scholar/notebook/notes/${encodeURIComponent(n.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: revision, pinned: next }) }).catch(() => null);
    if (res?.ok) { const j = await res.json().catch(() => ({})); if (Number.isInteger(j.revision)) setRevision(j.revision); return; }
    // Changed elsewhere: take its revision and try once more, since a pin touches no words.
    if (res?.status === 409) {
      const j = await res.json().catch(() => ({}));
      const again = await fetch(`/api/individual/scholar/notebook/notes/${encodeURIComponent(n.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: j.current?.revision, pinned: next }) }).catch(() => null);
      if (again?.ok) { const k = await again.json().catch(() => ({})); if (Number.isInteger(k.revision)) setRevision(k.revision); return; }
    }
    setPinned(!next); setMsg("That could not be changed just now.");
  };
  const edited = n.updatedAt !== n.createdAt;
  const body = (n.body ?? "").replace(/\s+/g, " ").trim();
  return (
    <li className={`${learnBox("ideas")} p-3.5`} data-testid="notebook-card" data-note-id={n.id}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-[15.5px] font-bold leading-snug text-gray-900">
            <Link href={notebookHref(n.id)} className={`hover:underline ${focusRing}`}>{noteHeading(n)}</Link>
          </h3>
          {card.headline ? <p className="mt-1 break-words text-[13.5px] leading-relaxed text-gray-800"><Marked text={card.headline} /></p>
            : body && (n.title || body.length > 80) && <p className="mt-1 line-clamp-2 break-words text-[13.5px] leading-relaxed text-gray-800">{body}</p>}
          {n.quote && !card.headline && <p className="mt-1 line-clamp-2 break-words border-l-4 border-[var(--learn-border)] pl-2 text-[13px] italic text-gray-800"><span className="sr-only">You highlighted: </span>{n.quote}</p>}
          <p className="mt-1.5 flex flex-wrap gap-x-2 text-[12px] text-gray-700">
            {n.kind !== "note" && <span className="font-semibold">{n.kind === "highlight" ? "Highlight" : "Summary"}</span>}
            <span>{card.where ?? (n.wasOn ? `Free-standing. Was linked to ${n.wasOn}, since removed` : "Free-standing")}</span>
            <span>· Written {day(n.createdAt)}{edited ? `, edited ${day(n.updatedAt)}` : ""}</span>
          </p>
          {n.tags.length > 0 && (
            <ul className="mt-1.5 flex flex-wrap gap-1" aria-label="Tags">
              {n.tags.map(t => <li key={t}><Link href={`${notebookHref()}?tag=${encodeURIComponent(t)}`} className={`inline-flex min-h-[26px] items-center rounded-full bg-[var(--cmp-app-surface)] px-2 text-[12px] font-semibold text-[var(--learn-ink)] ring-1 ring-[var(--learn-border)] pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>{t}</Link></li>)}
            </ul>
          )}
        </div>
        {pinnable && (
          <button type="button" aria-pressed={pinned} onClick={() => void togglePin()} className={`${learnAction.secondary} shrink-0 px-2.5`} data-testid="notebook-pin">
            {pinned ? "Pinned" : "Pin"}<span className="sr-only">: {noteHeading(n)}</span>
          </button>
        )}
      </div>
      {msg && <p role="status" className="mt-1 text-[12.5px] text-gray-900">{msg}</p>}
    </li>
  );
}

export function NotebookSection({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="mt-5">
      <h2 className="text-[13px] font-bold uppercase tracking-[0.12em] text-gray-600">{title}{count !== undefined ? ` · ${count}` : ""}</h2>
      <ul className="mt-2 space-y-2.5">{children}</ul>
    </section>
  );
}

/** The blank page, one tap away. No title, category or material is asked for. */
export function StartWriting({ userId }: { userId: string }) {
  const router = useRouter();
  const restore = (d: NoteDraft) => { rememberRestoredDraft(d); router.push(`${notebookHref("new")}?draft=${encodeURIComponent(d.clientKey)}`); };
  return (
    <>
      <DraftRecovery userId={userId} onRestore={restore} />
      <Link href={notebookHref("new")} data-testid="notebook-start" className={`${learnBox("ideas")} flex min-h-[72px] items-center gap-3 p-4 hover:brightness-[0.98] ${focusRing}`}>
        <span className="cmp-learn-accent"><LearningIcon name="bulb" className="h-6 w-6" /></span>
        <span className="min-w-0 flex-1">
          <span className="cmp-learn-ink block text-[16px] font-bold">Start writing</span>
          <span className="block text-[13.5px] text-gray-800">{IDEAS.placeholder}</span>
        </span>
        <span className="cmp-learn-ink hidden text-[12px] sm:inline">{IDEAS.privacy}</span>
      </Link>
    </>
  );
}

export function NotebookSearch({ q, tags, tag, material, materials }: { q: string; tags: string[]; tag: string | null; material: string | null; materials: { id: string; title: string }[] }) {
  const field = `min-h-[44px] rounded-xl border border-gray-300 bg-white px-3 text-[15px] text-gray-900 ${focusRing}`;
  return (
    <form role="search" action={notebookHref()} className="mt-4" aria-label="Search my notes">
      <div className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="notebook-q">Search my notes</label>
        <input id="notebook-q" name="q" type="search" defaultValue={q} maxLength={200} placeholder="Search my notes" className={`${field} min-w-0 flex-[1_1_14rem]`} data-testid="notebook-search" />
        {materials.length > 0 && (
          <>
            <label className="sr-only" htmlFor="notebook-m">Only notes on one material</label>
            <select id="notebook-m" name="material" defaultValue={material ?? ""} className={`${field} min-w-0 max-w-full flex-[0_1_14rem]`}>
              <option value="">All materials</option>
              {materials.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
            </select>
          </>
        )}
        {tag && <input type="hidden" name="tag" value={tag} />}
        <button type="submit" className={`inline-flex min-h-[44px] items-center rounded-xl border border-gray-900 bg-gray-900 px-4 text-[14px] font-semibold text-white pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>Search</button>
      </div>
      {tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Show one tag">
          {tags.map(t => (
            <Link key={t} href={tag === t ? notebookHref() : `${notebookHref()}?tag=${encodeURIComponent(t)}`} aria-current={tag === t ? "true" : undefined}
              className={`inline-flex min-h-[32px] items-center rounded-full border px-2.5 text-[12.5px] font-semibold pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing} ${tag === t ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 bg-white text-gray-800"}`}>{t}</Link>
          ))}
        </div>
      )}
    </form>
  );
}

export const pageSize = NOTEBOOK_PAGE;
export const practiseHref = () => experienceHref("scholar", "study/saved?view=notebook");
