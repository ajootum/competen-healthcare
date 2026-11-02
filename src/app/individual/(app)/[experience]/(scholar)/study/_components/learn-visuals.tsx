"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useModalFocus } from "@/components/ui/use-modal-focus";
import { sourceHref } from "./question-view";
import { pagesOfCitation, visualUrl, visualsForPages, visualsForSections, visualsListUrl, type Visual } from "@/lib/individual/scholar/material-visuals";

// SCHOLAR-LESSON-VISUALS-01 (owner GO "Visual Learning From Uploaded Presentations"): THE STUDENT'S OWN PICTURES BESIDE THE LESSON.
//
// The original pictures of the slides (and the image-only pages of the PDF) a lesson was taught from, shown exactly as they are
// in the learner's file: never redrawn, cropped, stretched or described by AI. Nothing here calls AI. The list of pictures comes
// from GET /api/individual/scholar/materials/[id]/visuals (fixed rules, material-visuals.ts), asked for once per material per page
// view; each picture is its own cached URL. Every picture is labelled "Original image -- not AI-generated"; where the slide's
// TEXT was read by AI from its picture, that is said beside it with the instruction to check the text against the picture.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const touch = "pointer-coarse:min-h-[var(--cmp-touch-min)]";
const ghostBtn = `inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-300 bg-white px-4 py-2 text-[14px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 ${touch} ${focusRing}`;
const ORIGINAL = "Original image — not AI-generated";
const AI_NOTE = "Its text was read by AI: check it against the picture.";
const NOTE = "The slide’s own layout is not reproduced here; the pictures are shown exactly as in your file.";

export type VisualsReply = { unit?: string; visuals: Visual[]; notShown?: number; off?: boolean };

// ── ONE ASK PER MATERIAL PER PAGE VIEW (memoised; a failed ask is forgotten so a later click can try again) ──
const asked = new Map<string, Promise<VisualsReply | null>>();
export function loadVisuals(materialId: string): Promise<VisualsReply | null> {
  const known = asked.get(materialId);
  if (known) return known;
  const p = fetch(visualsListUrl(materialId), { credentials: "same-origin" })
    .then(r => (r.ok ? (r.json() as Promise<VisualsReply>) : null))
    .catch(() => null)
    .then(r => { if (!r) asked.delete(materialId); return r; });
  asked.set(materialId, p);
  return p;
}

/** The material's visuals, or null while they load / when none can be had. Off, a failure or a non-presentation: an empty list. */
function useVisuals(materialId: string, enabled: boolean): VisualsReply | null {
  const [state, setState] = useState<{ id: string; reply: VisualsReply | null } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void loadVisuals(materialId).then(reply => { if (live) setState({ id: materialId, reply }); });
    return () => { live = false; };
  }, [materialId, enabled]);
  return enabled && state?.id === materialId ? state.reply : null;
}

const noun = (v: Pick<Visual, "unit">) => (v.unit === "slide" ? "slide" : "page");
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ── THE DIALOG: the full-size original, the slide's other pictures, the original file ──
export function VisualDialog({ materialId, materialTitle, visuals, startKey, onClose }: {
  materialId: string; materialTitle: string; visuals: readonly Visual[]; startKey: string; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [key, setKey] = useState(startKey);
  const current = visuals.find(v => v.key === key) ?? visuals[0];
  // The native modal dialog already traps focus; the shared hook keeps the doctrine (pui-a11y) and returns focus to the trigger.
  // It is declared FIRST so it records the trigger before showModal() moves focus into the dialog.
  useModalFocus(true, panel, () => ref.current?.close());
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => { if (d?.open) d.close(); };
  }, []);
  if (!current) return null;
  const same = visuals.filter(v => v.n === current.n);
  const page = current.kind === "pdf_page";
  const title = `${capital(noun(current))} ${current.n} of ${materialTitle}`;
  return (
    <dialog ref={ref} aria-modal="true" aria-label={title} onClose={onClose} onCancel={onClose}
      onClick={e => { if (e.target === ref.current) ref.current?.close(); }}
      className="cmp-dialog m-auto w-[96%] max-w-[1000px] rounded-2xl border border-gray-200 bg-white p-0 text-gray-900 shadow-xl backdrop:bg-black/40">
      <div ref={panel} tabIndex={-1} className="flex max-h-[92vh] flex-col outline-none">
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 p-4">
          <div className="min-w-0">
            <h2 className="break-words text-[16px] font-bold text-gray-900">{title}</h2>
            <p className="mt-0.5 text-[12.5px] font-semibold text-gray-700">{ORIGINAL}</p>
          </div>
          <button type="button" aria-label="Close" onClick={() => ref.current?.close()}
            className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-[15px] font-semibold hover:bg-gray-50 ${touch} ${focusRing}`}>{"✕"}</button>
        </div>
        {/* The original, at its own size, scrolled inside the dialog only (pinch to zoom on a touch screen). */}
        <div className="min-h-0 flex-1 overflow-auto bg-white p-2 [touch-action:pan-x_pan-y_pinch-zoom]">
          {page ? (
            <>
              <iframe title={`Original ${noun(current)} ${current.n} of ${materialTitle}`} src={visualUrl(materialId, current.key)} className="h-[70vh] w-full rounded-lg border border-gray-200 bg-white" />
              <p className="mt-2 text-[13px] text-gray-700">If the page does not appear, <a href={visualUrl(materialId, current.key)} target="_blank" rel="noreferrer" className={`font-semibold underline ${focusRing}`}>open the original page</a>.</p>
            </>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- the learner's own file, served as it is: no optimiser may resize or recompress it
            <img src={visualUrl(materialId, current.key)} alt={`Original picture from ${noun(current)} ${current.n} of ${materialTitle}`} className="block h-auto max-w-none bg-white" />
          )}
        </div>
        <div className="space-y-3 border-t border-gray-200 p-4 text-[13px] text-gray-800">
          {current.aiRead && <p role="note" className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-semibold">{AI_NOTE}</p>}
          <section aria-label={`View original ${noun(current)} ${current.n}`}>
            <h3 className="text-[13.5px] font-bold text-gray-900">View original {noun(current)} {current.n}</h3>
            {same.length > 1 ? (
              <ul className="mt-2 flex flex-wrap gap-2">
                {same.map((v, i) => (
                  <li key={v.key}>
                    <button type="button" aria-pressed={v.key === current.key} aria-label={`Picture ${i + 1} of ${same.length} on ${noun(v)} ${v.n}`} onClick={() => setKey(v.key)}
                      className={`rounded-lg border bg-white p-1 ${touch} ${focusRing} ${v.key === current.key ? "border-gray-900" : "border-gray-300"}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
                      <img src={visualUrl(materialId, v.key)} alt="" loading="lazy" className="h-14 w-auto max-w-[120px] object-contain" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-1 text-gray-700">{page ? "This is the whole page, as it is in your file." : `This is the only picture on ${noun(current)} ${current.n}.`}</p>}
            <p className="mt-2 text-gray-700">{NOTE}</p>
            <p className="mt-2"><a href={`/api/individual/scholar/materials/${materialId}`} className={`inline-flex items-center font-semibold underline ${touch} ${focusRing}`}>{page ? "Download the original file" : "Download the original presentation"}</a></p>
          </section>
        </div>
      </div>
    </dialog>
  );
}

// ── THE STRIP UNDER A LESSON ──
export type LessonSection = { chunkId?: string; materialId: string; materialTitle: string; unit: "page" | "slide" | "section"; pageFrom: number | null; pageTo: number | null };

/** Shown by Learn after a lesson's teaching and before its actions: the original pictures of the slides / pages it cites. */
export function LearnVisuals({ sections, max, enabled }: { sections: readonly LessonSection[]; max: number; enabled: boolean }) {
  const materials = [...new Map(sections.filter(s => s.unit !== "section").map(s => [s.materialId, s.materialTitle])).entries()];
  if (!enabled || !materials.length) return null;
  return (
    <div className="mt-4 space-y-4">
      {materials.map(([id, title]) => (
        <MaterialStrip key={id} materialId={id} materialTitle={title} max={max} ranges={sections.filter(s => s.materialId === id)} />
      ))}
    </div>
  );
}

function MaterialStrip({ materialId, materialTitle, ranges, max }: { materialId: string; materialTitle: string; ranges: readonly LessonSection[]; max: number }) {
  const reply = useVisuals(materialId, true);
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const found = reply?.visuals?.length ? visualsForSections(reply.visuals, ranges) : [];
  if (!reply || reply.off || !found.length) return null;
  const shown = all ? found : found.slice(0, max);
  const pages = found[0].kind === "pdf_page";
  return (
    <section aria-label={pages ? "From your pages" : "From your slides"} className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
      <h3 className="text-[13.5px] font-bold text-gray-900">{pages ? "From your pages" : "From your slides"}</h3>
      <ul className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map(v => <li key={v.key} className="min-w-0"><VisualCard v={v} materialId={materialId} materialTitle={materialTitle} onOpen={() => setOpen(v.key)}
          textHref={v.aiRead ? textHrefOf(v, materialId, ranges) : null} /></li>)}
      </ul>
      {found.length > shown.length && (
        <button type="button" onClick={() => setAll(true)} className={`${ghostBtn} mt-2`}>Show all {found.length} pictures</button>
      )}
      {open && <VisualDialog materialId={materialId} materialTitle={materialTitle} visuals={reply.visuals} startKey={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

/** The section of the lesson whose text was read by AI from this slide / page, for the link beside its picture. */
function textHrefOf(v: Visual, materialId: string, ranges: readonly LessonSection[]): string | null {
  const s = ranges.find(r => r.chunkId && r.pageFrom !== null && v.n >= r.pageFrom && v.n <= (r.pageTo ?? r.pageFrom));
  return s?.chunkId ? sourceHref(materialId, s.chunkId) : null;
}

function VisualCard({ v, materialId, materialTitle, onOpen, textHref }: { v: Visual; materialId: string; materialTitle: string; onOpen: () => void; textHref: string | null }) {
  const page = v.kind === "pdf_page";
  return (
    <figure className="flex h-full flex-col overflow-hidden rounded-xl border border-gray-200 bg-white">
      {page ? (
        <div className="flex flex-1 flex-col items-start gap-2 p-3">
          <p className="text-[13px] font-semibold text-gray-900">Page {v.n} · original page</p>
          <button type="button" onClick={onOpen} className={ghostBtn}>Open the original page</button>
        </div>
      ) : (
        <button type="button" onClick={onOpen} aria-label={`Enlarge the original picture from slide ${v.n}`}
          className={`flex w-full items-center justify-center bg-white p-1 ${touch} ${focusRing}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- the learner's own file, shown as it is: never resized, cropped or stretched */}
          <img src={visualUrl(materialId, v.key)} loading="lazy" decoding="async" alt={`Original picture from slide ${v.n} of ${materialTitle}`}
            className="h-auto max-h-[220px] w-auto max-w-full bg-white object-contain md:max-h-[280px]" />
        </button>
      )}
      <figcaption className="border-t border-gray-200 px-3 py-2 text-[12.5px] text-gray-700">
        {!page && <span className="block font-semibold text-gray-900">Slide {v.n} · original picture from your presentation</span>}
        <span className="block">{ORIGINAL}</span>
        {v.aiRead && (
          <span className="mt-0.5 block font-semibold text-gray-900">{AI_NOTE}
            {textHref && <> <Link href={textHref} className={`underline ${focusRing}`}>See that section&apos;s text</Link></>}
          </span>
        )}
      </figcaption>
    </figure>
  );
}

// ── FLASHCARDS AND REVISE: "View the original slide / page picture" for the item's source ──
/** A button that, when pressed, asks for the material's pictures (once) and opens the dialog on the cited slide / page's. */
export function SourcePictureButton({ materialId, materialTitle, citation, className }: { materialId: string; materialTitle?: string; citation: string; className?: string }) {
  const range = pagesOfCitation(citation);
  const title = materialTitle || citation.replace(/,?\s*(?:slide|page)s?\s+\d.*$/i, "").trim() || "your material";
  const [state, setState] = useState<"idle" | "loading" | "none" | "failed">("idle");
  const [shown, setShown] = useState<{ visuals: Visual[]; start: string } | null>(null);
  if (!range) return null;
  const word = range.unit === "slide" ? "slide" : "page";
  const press = async () => {
    setState("loading");
    const reply = await loadVisuals(materialId);
    if (!reply) { setState("failed"); return; }
    const mine = reply.off ? [] : visualsForPages(reply.visuals, range.from, range.to);
    if (!mine.length) { setState("none"); return; }
    setState("idle");
    setShown({ visuals: reply.visuals, start: mine[0].key });
  };
  return (
    <>
      <button type="button" onClick={() => void press()} disabled={state === "loading"} className={className ?? ghostBtn}>
        {state === "loading" ? "Looking for the picture…" : `View the original ${word} picture`}
      </button>
      {state === "none" && <span role="status" className="self-center text-[12.5px] text-gray-700">This {word} has no separate original picture{range.unit === "page" ? " (only image-only pages are shown)" : ""}.</span>}
      {state === "failed" && <span role="status" className="self-center text-[12.5px] text-gray-700">The picture could not be fetched just now. Try again shortly.</span>}
      {shown && <VisualDialog materialId={materialId} materialTitle={title} visuals={shown.visuals} startKey={shown.start} onClose={() => setShown(null)} />}
    </>
  );
}
