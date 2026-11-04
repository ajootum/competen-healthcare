"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { experienceHref } from "@/lib/individual/experiences";
import { PRACTICE_NOTES_MAX, practicePath, practiceScopes } from "@/lib/individual/scholar/notebook-practice";
import { focusRing } from "../../../../../_components/chrome";
import { StandaloneNote, type ClientNote } from "./library-notes-client";

// SALE-2026-11 R3 / SALE-12 -- the Notebook's list: each note, highlight and summary with its cited source, Open, Related, Edit / Remove
// (the library's own StandaloneNote), and a checkbox. "Make practice" turns the chosen notes into the sections they are attached to and
// opens the EXISTING Revise builder on them (one material at a time): questions are generated there by the existing SQIE routes, with
// their allowance and model routing unchanged. Nothing is generated on this page. Learner text, private, never AI.

export type NotebookItem = ClientNote & {
  title: string; attached: string; materialId: string | null; chunkIds: string[];
  openHref: string | null;
  /** The section the note is attached to: its citation. */
  source: { href: string; label: string } | null;
  related: { href: string; label: string; why: string }[];
};

const KIND: Record<NotebookItem["kind"], string> = { note: "Note", highlight: "Highlight", summary: "Summary", bookmark: "Bookmark" };
const linkCls = `inline-flex min-h-[40px] items-center px-1 font-semibold text-gray-900 underline underline-offset-2 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 py-2 text-[14px] font-semibold disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;

export function NotebookList({ items, more }: { items: NotebookItem[]; more: boolean }) {
  const uid = useId();
  const [kind, setKind] = useState<"all" | NotebookItem["kind"]>("all");
  const [chosen, setChosen] = useState<string[]>([]);
  const shown = kind === "all" ? items : items.filter(i => i.kind === kind);
  const picked = useMemo(() => items.filter(i => chosen.includes(i.id)), [items, chosen]);
  const plan = useMemo(() => practiceScopes(picked.map(i => ({ id: i.id, materialId: i.materialId, chunkIds: i.chunkIds }))), [picked]);
  const toggle = (id: string) => setChosen(c => (c.includes(id) ? c.filter(x => x !== id) : c.length >= PRACTICE_NOTES_MAX ? c : [...c, id]));

  if (!items.length) return <p className="rounded-2xl border border-dashed border-gray-300 bg-white p-5 text-[14px] text-gray-600">No notes yet. Write a summary above, or add notes and highlights while you read a saved lesson.</p>;
  return (
    <section aria-labelledby={`${uid}-h`} className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5" data-testid="notebook-list">
      <h3 id={`${uid}-h`} className="text-[15px] font-bold text-gray-900">Your notes, highlights and summaries</h3>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Show">
        {(["all", "summary", "note", "highlight"] as const).map(k => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}
            className={`inline-flex min-h-9 items-center rounded-full border px-3.5 text-[13px] font-semibold pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing} ${kind === k ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 bg-white text-gray-800 hover:bg-gray-50"}`}>
            {k === "all" ? "All" : `${KIND[k]}s`}
          </button>
        ))}
      </div>

      {/* PRACTICE FROM THE CHOSEN NOTES: sticky on a phone, so it stays in reach while choosing */}
      <div className="sticky bottom-2 z-10 mt-3 rounded-xl border border-gray-300 bg-white p-3 shadow-sm" aria-live="polite" data-testid="notebook-practice">
        {picked.length === 0 ? (
          <p className="text-[13.5px] text-gray-700">Choose notes below to make practice questions from the sections they are about.</p>
        ) : (
          <>
            <p className="text-[13.5px] font-semibold text-gray-900">{picked.length} note{picked.length === 1 ? "" : "s"} chosen{picked.length >= PRACTICE_NOTES_MAX ? ` (at most ${PRACTICE_NOTES_MAX})` : ""}</p>
            {plan.withoutSection > 0 && <p className="mt-0.5 text-[12.5px] text-gray-600">{plan.withoutSection} {plan.withoutSection === 1 ? "is" : "are"} on a whole material with no section, so {plan.withoutSection === 1 ? "it is" : "they are"} left out of practice.</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              {plan.scopes.map(s => (
                <Link key={s.materialId} href={experienceHref("scholar", practicePath(s, "1"))} className={`${btn} bg-gray-900 text-white hover:opacity-90`} data-testid="notebook-practice-link">
                  Make practice from {s.notes === picked.length ? "these notes" : `${s.notes} of them`} ({s.chunkIds.length} section{s.chunkIds.length === 1 ? "" : "s"})
                </Link>
              ))}
              <button type="button" className={`${btn} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`} onClick={() => setChosen([])}>Clear</button>
            </div>
            <p className="mt-1 text-[12px] text-gray-600">Opens Revise on those sections. Questions are written from your own material there, and their answers say where they come from.</p>
          </>
        )}
      </div>

      <ul className="mt-3 space-y-3">
        {shown.map(i => (
          <li key={i.id} id={`n-${i.id}`} className="scroll-mt-24" data-testid="notebook-item" data-kind={i.kind}>
            <div className="flex items-start gap-2">
              <label className="-m-1 flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center pointer-coarse:min-h-[var(--cmp-touch-min)] pointer-coarse:min-w-[var(--cmp-touch-min)]">
                <input type="checkbox" className="h-5 w-5" checked={chosen.includes(i.id)} onChange={() => toggle(i.id)} disabled={!i.chunkIds.length && !chosen.includes(i.id)}
                  aria-label={`Choose this ${KIND[i.kind].toLowerCase()} on ${i.title} for practice`} />
              </label>
              <div className="min-w-0 flex-1">
                <p className="break-words text-[14.5px] font-semibold text-gray-900"><span className="mr-1.5 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11.5px] font-bold uppercase tracking-[0.06em] text-gray-700">{KIND[i.kind]}</span>{i.title}</p>
                <StandaloneNote note={i} attached={i.attached}>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[13px]">
                    {i.openHref && <Link href={i.openHref} className={linkCls}>{i.artefactId ? "Open saved lesson" : "Open lesson"}</Link>}
                    {i.source ? <Link href={i.source.href} className={linkCls}>Source: {i.source.label}</Link> : <span className="text-[12.5px] text-gray-600">On the whole material, no section</span>}
                  </p>
                  {i.related.length > 0 && (
                    <details className="mt-1">
                      <summary className={`inline-flex min-h-[40px] cursor-pointer items-center text-[13px] font-semibold text-gray-800 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>Related ({i.related.length})</summary>
                      <ul className="mb-1 space-y-1 pl-1 text-[13px]">
                        {i.related.map(r => <li key={r.href}><Link href={r.href} className={linkCls}>{r.label}</Link> <span className="text-gray-600">· {r.why}</span></li>)}
                      </ul>
                    </details>
                  )}
                </StandaloneNote>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {more && <p className="mt-3 text-[12.5px] text-gray-600">Only your newest 300 are shown here. Search above finds older ones.</p>}
    </section>
  );
}
