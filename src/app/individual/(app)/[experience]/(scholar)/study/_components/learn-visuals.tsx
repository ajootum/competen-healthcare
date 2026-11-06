"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useModalFocus } from "@/components/ui/use-modal-focus";
import { sourceHref } from "./question-view";
import { arrangeStrip, pagesOfCitation, preferWhole, visualUrl, visualsForLesson, visualsForPages, visualsForSection, visualsListUrl, wholeSlidesUrl, type Visual, type VisualMode } from "@/lib/individual/scholar/material-visuals";

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
const labelOf = (v: Pick<Visual, "whole" | "unit">) => (v.whole ? `Whole ${v.unit === "slide" ? "slide" : "page"} drawn from your file — not AI-generated` : ORIGINAL);
const AI_NOTE = "Its text was read by AI: check it against the picture.";
const SAFE_TEXT_LABEL = "Text read by AI from this chart — do not use it for scores or thresholds; check the original";
const WHOLE_NOTE = (v: Pick<Visual, "unit">) => (v.unit === "slide" ? "Drawn once from your own file, so a font can differ slightly from PowerPoint." : "Drawn once from your own file. The original page is kept exactly as it is, and can be opened here.");
const WHOLE_NOTE_PICTURES = (v: Pick<Visual, "unit">) => `The original pictures on this ${v.unit === "slide" ? "slide" : "page"} are kept exactly as they are, and can be chosen here.`;
const NOTE = (unit: Visual["unit"]) => unit === "slide"
  ? "The slide’s own layout is not reproduced here; the pictures are shown exactly as in your file."
  : unit === "section" ? "The picture is shown exactly as in your file, after the text it follows there."
  : "The pictures are shown exactly as in your file. View the original page to see it whole.";

export type VisualsReply = { unit?: string; visuals: Visual[]; notShown?: number; off?: boolean; noSection?: number[]; notShownIn?: number[]; render?: "off" | "not_needed" | "not_started" | "running" | "finished" };

// ── ONE ASK PER MATERIAL PER PAGE VIEW (memoised; a failed ask is forgotten so a later click can try again) ──
const asked = new Map<string, Promise<VisualsReply | null>>();
export function loadVisuals(materialId: string): Promise<VisualsReply | null> {
  const known = asked.get(materialId);
  if (known) return known;
  const p = fetch(visualsListUrl(materialId), { credentials: "same-origin" })
    .then(r => (r.ok ? (r.json() as Promise<VisualsReply>) : null))
    .catch(() => null)
    .then(r => { if (!r) asked.delete(materialId); else followDrawing(materialId, r); return r; });
  asked.set(materialId, p);
  return p;
}

// ── WHOLE SLIDES (SCHOLAR-VISUAL-001 phase 2): opening a presentation asks for its slides to be drawn, at most once; the server decides. The original
// pictures show meanwhile. One quiet check per material per half minute swaps each slide in when it is ready, and stops after a few minutes.
const CHECK_EVERY_MS = 30_000;
const CHECKS_MAX = 12;
const listeners = new Map<string, Set<(reply: VisualsReply) => void>>();
const roundsLeft = new Map<string, number>();
const waiting = new Set<string>();
const askDraw = (materialId: string) => {
  void fetch(wholeSlidesUrl(materialId), { method: "POST", credentials: "same-origin" })
    .then(r => (r.ok ? (r.json() as Promise<{ state?: string }>) : null))
    // Off, or nothing to draw: there will be nothing to swap in, so no more checks.
    .then(r => { if (r?.state === "off" || r?.state === "not_needed") roundsLeft.set(materialId, 0); })
    .catch(() => {});
};
function followDrawing(materialId: string, reply: VisualsReply) {
  if (reply.render !== "not_started" && reply.render !== "running") return;
  // The server decides whether a job may start. An engine busy with another file: asked again at the next check.
  if (reply.render === "not_started") askDraw(materialId);
  if (waiting.has(materialId)) return;
  const left = roundsLeft.get(materialId) ?? CHECKS_MAX;
  if (left <= 0) return;
  roundsLeft.set(materialId, left - 1);
  waiting.add(materialId);
  window.setTimeout(() => {
    waiting.delete(materialId);
    asked.delete(materialId);
    void loadVisuals(materialId).then(next => { if (next) listeners.get(materialId)?.forEach(l => l(next)); });
  }, CHECK_EVERY_MS);
}

/** The material's visuals, or null while they load / when none can be had. Off, a failure or a non-presentation: an empty list. */
function useVisuals(materialId: string, enabled: boolean): VisualsReply | null {
  const [state, setState] = useState<{ id: string; reply: VisualsReply | null } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void loadVisuals(materialId).then(reply => { if (live) setState({ id: materialId, reply }); });
    const listen = (reply: VisualsReply) => { if (live) setState({ id: materialId, reply }); };
    const here = listeners.get(materialId) ?? new Set<(reply: VisualsReply) => void>();
    here.add(listen);
    listeners.set(materialId, here);
    return () => { live = false; here.delete(listen); };
  }, [materialId, enabled]);
  return enabled && state?.id === materialId ? state.reply : null;
}

const ZOOM_STEP = 0.5;
const ZOOM_MAX = 4;
const zoomBtn = `inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-gray-300 bg-white px-3 text-[13.5px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 ${touch} ${focusRing}`;
const noun = (v: Pick<Visual, "unit">) => v.unit;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ── THE DIALOG: the full-size original, the slide's other pictures, the original file ──
export function VisualDialog({ materialId, materialTitle, visuals, startKey, onClose }: {
  materialId: string; materialTitle: string; visuals: readonly Visual[]; startKey: string; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [key, setKey] = useState(startKey);
  // A picture taken out of a PDF page: the whole original page can be shown in its place (the single page, as it is in the file).
  const [whole, setWhole] = useState(false);
  // SCHOLAR-VISUAL-001 s4.3: fits the width first, with nothing cropped. Larger than that, it moves by scrolling, a swipe or the arrow keys.
  const [zoom, setZoom] = useState(1);
  const current = visuals.find(v => v.key === key) ?? visuals[0];
  // The native modal dialog already traps focus; the shared hook keeps the doctrine (pui-a11y) and returns focus to the trigger.
  // It is declared FIRST so it records the trigger before showModal() moves focus into the dialog.
  useModalFocus(true, panel, () => ref.current?.close());
  // Opened once. No close() in a cleanup: close() fires onClose, which unmounts this dialog -- under React's development
  // double-run of effects that closed it before it was seen. Removing the element on unmount closes it anyway.
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
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
            <p className="mt-0.5 text-[12.5px] font-semibold text-gray-700">{labelOf(current)}</p>
          </div>
          <button type="button" aria-label="Close" onClick={() => ref.current?.close()}
            className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-[15px] font-semibold hover:bg-gray-50 ${touch} ${focusRing}`}>{"✕"}</button>
        </div>
        {!page && !whole && (
          <div role="group" aria-label="Picture size" className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-2">
            <button type="button" aria-label="Make the picture smaller" disabled={zoom <= 1} onClick={() => setZoom(z => Math.max(1, z - ZOOM_STEP))} className={zoomBtn}>−</button>
            <button type="button" aria-label="Make the picture larger" disabled={zoom >= ZOOM_MAX} onClick={() => setZoom(z => Math.min(ZOOM_MAX, z + ZOOM_STEP))} className={zoomBtn}>+</button>
            <button type="button" disabled={zoom === 1} onClick={() => setZoom(1)} className={zoomBtn}>Fit to width</button>
            <span role="status" className="text-[12.5px] text-gray-700">{zoom === 1 ? "Fitted to width" : `${Math.round(zoom * 100)}% of the width`}</span>
          </div>
        )}
        {/* The original, never cropped, scrolled inside the dialog only (pinch to zoom on a touch screen). Focusable, so the arrow keys move it. */}
        <div tabIndex={0} role="group" aria-label="The picture" className={`min-h-0 flex-1 overflow-auto bg-white p-2 [touch-action:pan-x_pan-y_pinch-zoom] ${focusRing}`}>
          {page || whole ? (
            <>
              <iframe title={`Original ${noun(current)} ${current.n} of ${materialTitle}`} src={visualUrl(materialId, page ? current.key : `p${current.n}`)} className="h-[70vh] w-full rounded-lg border border-gray-200 bg-white" />
              <p className="mt-2 text-[13px] text-gray-700">If the page does not appear, <a href={visualUrl(materialId, page ? current.key : `p${current.n}`)} target="_blank" rel="noreferrer" className={`font-semibold underline ${focusRing}`}>open the original page</a>.</p>
            </>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- the learner's own file, served as it is: no optimiser may resize or recompress it
            <img src={visualUrl(materialId, current.key)} alt={current.whole ? `Whole ${noun(current)} ${current.n} of ${materialTitle}` : `Original picture from ${noun(current)} ${current.n} of ${materialTitle}`} style={zoom === 1 ? undefined : { width: `${zoom * 100}%`, maxWidth: "none" }} className={`block h-auto bg-white ${zoom === 1 ? "mx-auto max-w-full" : ""}`} />
          )}
        </div>
        <div className="space-y-3 border-t border-gray-200 p-4 text-[13px] text-gray-800">
          <p className="text-gray-700"><span className="mr-1 inline-block rounded-full border border-gray-300 bg-gray-50 px-2 py-0.5 text-[11.5px] font-semibold text-gray-800">{current.label}</span>{current.caption}</p>
          {current.aiRead && <p role="note" className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-semibold">{AI_NOTE}</p>}
          {current.safeText && <SafeText text={current.safeText} />}
          <section aria-label={same.some(v => v.whole) ? `${capital(noun(current))} ${current.n}: drawn whole, and its originals` : `View original ${noun(current)} ${current.n}`}>
            <h3 className="text-[13.5px] font-bold text-gray-900">{same.some(v => v.whole) ? `${capital(noun(current))} ${current.n}: drawn whole, and its originals` : `View original ${noun(current)} ${current.n}`}</h3>
            {same.length > 1 ? (
              <ul className="mt-2 flex flex-wrap gap-2">
                {same.map((v, i) => (
                  <li key={v.key}>
                    <button type="button" aria-pressed={v.key === current.key} aria-label={v.whole ? `The whole of ${noun(v)} ${v.n}` : v.kind === "pdf_page" ? `The original page ${v.n}` : `Original picture ${i + 1} of ${same.length} on ${noun(v)} ${v.n}`} onClick={() => { setZoom(1); setKey(v.key); setWhole(false); }}
                      className={`rounded-lg border bg-white p-1 ${touch} ${focusRing} ${v.key === current.key ? "border-gray-900" : "border-gray-300"}`}>
                      {v.kind === "pdf_page" ? (
                        <span className="flex h-14 items-center px-2 text-[12.5px] font-semibold text-gray-800">Original page</span>
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element -- see above
                        <img src={visualUrl(materialId, v.key)} alt="" className="h-14 w-auto min-w-14 max-w-[120px] object-contain" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-1 text-gray-700">{page ? "This is the whole page, as it is in your file." : current.whole ? `This is the whole of ${noun(current)} ${current.n}.` : `This is the only picture on ${noun(current)} ${current.n}.`}</p>}
            {!page && current.unit === "page" && !same.some(v => v.kind === "pdf_page") && (
              <button type="button" aria-pressed={whole} onClick={() => setWhole(w => !w)} className={`${ghostBtn} mt-2`}>{whole ? (current.whole ? "Back to the drawn page" : "Back to the picture") : current.whole ? `Open the original page ${current.n}` : `Show the whole page ${current.n}`}</button>
            )}
            <p className="mt-2 text-gray-700">{current.whole ? (same.some(v => !v.whole && v.kind !== "pdf_page") ? `${WHOLE_NOTE(current)} ${WHOLE_NOTE_PICTURES(current)}` : WHOLE_NOTE(current)) : same.some(v => v.whole) ? "This is the original picture, exactly as in your file." : NOTE(current.unit)}</p>
            <p className="mt-2"><a href={`/api/individual/scholar/materials/${materialId}`} className={`inline-flex items-center font-semibold underline ${touch} ${focusRing}`}>{current.unit === "slide" ? "Download the original presentation" : "Download the original file"}</a></p>
          </section>
        </div>
      </div>
    </dialog>
  );
}

// ── THE PICTURES IN THE NOTES ── SCHOLAR-VISUAL-001 s2 Rule 2, s4 ──
/**
 * The original pictures of one section, in the notes, shown without a click. Fitted to the width, never cropped, and enlarged by choosing
 * one. No AI. A failed load, policy off or no pictures: nothing here, and the notes are unaffected.
 */
export function SectionPictures({ materialId, materialTitle, from, to, first, last, leading }: { materialId: string; materialTitle: string; from: number | null; to: number | null; first: boolean; last: boolean; leading?: boolean }) {
  const reply = useVisuals(materialId, from !== null);
  const [open, setOpen] = useState<string | null>(null);
  // A drawn slide that cannot be loaded gives way to the original pictures. Never a broken image where a picture was.
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());
  if (!reply || reply.off || (!reply.visuals?.length && !reply.notShownIn?.length)) return null;
  const found = preferWhole(visualsForSection(reply.visuals, reply.noSection ?? [], { from, to, first, last, leading }).filter(v => !broken.has(v.key)));
  // A Word section holding a chart, a diagram or a picture no browser can show: said where it is, never silently left out.
  const hidden = reply.unit === "section" && from !== null && !!reply.notShownIn?.includes(from);
  if (!found.length && !hidden) return null;
  return (
    <div className="mt-3 space-y-3">
      {hidden && <p role="note" className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[13px] text-gray-800">This section holds a picture, chart or diagram that cannot be shown here. <a href={`/api/individual/scholar/materials/${materialId}`} className={`inline-flex items-center font-semibold underline ${touch} ${focusRing}`}>Download the original file</a> to see it.</p>}
      {found.map(v => {
        const where = `${capital(noun(v))} ${v.n}`;
        const usesPage = v.kind === "pdf_page";
        return (
          <figure key={v.key} className="m-0">
            <button type="button" onClick={() => setOpen(v.key)} aria-label={v.whole ? `Enlarge the whole of ${where.toLowerCase()}` : `Enlarge the original picture from ${where.toLowerCase()}`} className={`block w-full rounded-lg border border-gray-200 bg-white p-1 text-left hover:border-gray-400 ${touch} ${focusRing}`}>
              {usesPage ? (
                <span className="block px-3 py-6 text-center text-[13.5px] font-semibold text-gray-800">Open {where.toLowerCase()} as it is in your file</span>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- the learner's own file, served as it is: no optimiser may resize or recompress it
                <img src={visualUrl(materialId, v.key)} alt={v.whole ? `Whole ${where.toLowerCase()} of ${materialTitle}` : `Original picture from ${where.toLowerCase()} of ${materialTitle}`} onError={v.whole ? () => setBroken(b => new Set(b).add(v.key)) : undefined} loading="lazy" decoding="async" width={v.width ?? undefined} height={v.height ?? undefined}
                  style={v.width && v.height ? { width: `min(100%, ${v.width}px)`, aspectRatio: `${v.width} / ${v.height}` } : undefined}
                  className="mx-auto block h-auto max-h-[70vh] w-auto max-w-full rounded object-contain" />
              )}
            </button>
            <figcaption className="mt-1 text-[12.5px] text-gray-700">
              <span className="font-semibold text-gray-800">{where}</span> · {labelOf(v)}{!usesPage && " · Select to enlarge"}
              {v.aiRead && <span className="block">{AI_NOTE}</span>}
            </figcaption>
          </figure>
        );
      })}
      {open && <VisualDialog materialId={materialId} materialTitle={materialTitle} visuals={reply.visuals} startKey={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

// ── THE STRIP UNDER A LESSON ──
export type LessonSection = { chunkId?: string; materialId: string; materialTitle: string; unit: "page" | "slide" | "section"; pageFrom: number | null; pageTo: number | null; citation?: string };

/** A Word section has no page: its number comes from its citation ("Report, section 4"), and its pictures are filed under that number. */
const withSectionNumbers = (s: LessonSection): LessonSection => {
  if (s.unit !== "section") return s;
  const cited = s.citation ? pagesOfCitation(s.citation) : null;
  return cited?.unit === "section" ? { ...s, pageFrom: cited.from, pageTo: cited.to } : s;
};

/** Shown by Learn after a lesson's teaching and before its actions: the original pictures of the slides / pages it cites. */
export function LearnVisuals({ sections, max, enabled, word }: { sections: readonly LessonSection[]; max: number; enabled: boolean; word?: boolean }) {
  // Word pictures off: a section has nothing to ask for, as before.
  const numbered = sections.filter(s => word || s.unit !== "section").map(withSectionNumbers);
  const materials = [...new Map(numbered.filter(s => s.pageFrom !== null).map(s => [s.materialId, s.materialTitle])).entries()];
  if (!enabled || !materials.length) return null;
  return (
    <div className="mt-4 space-y-4">
      {materials.map(([id, title]) => (
        <MaterialStrip key={id} materialId={id} materialTitle={title} max={max} ranges={numbered.filter(s => s.materialId === id)} />
      ))}
    </div>
  );
}

// ── THE LEARNER'S OWN CHOICE, per material, on this device only (a convenience: never required, never sent anywhere) ──
const MODE_PREFIX = "scholar.visuals.mode.";
const MODES: { value: VisualMode; label: string }[] = [
  { value: "image", label: "Show original image" },
  { value: "text", label: "Use text explanation" },
  { value: "both", label: "Show both" },
];
const noSubscribe = () => () => {};
function readMode(materialId: string): VisualMode | null {
  try {
    const v = window.localStorage.getItem(MODE_PREFIX + materialId);
    return v === "image" || v === "text" || v === "both" ? v : null;
  } catch { return null; }
}
function writeMode(materialId: string, mode: VisualMode | null) {
  try { if (mode) window.localStorage.setItem(MODE_PREFIX + materialId, mode); else window.localStorage.removeItem(MODE_PREFIX + materialId); } catch { /* not remembered */ }
}

function MaterialStrip({ materialId, materialTitle, ranges, max }: { materialId: string; materialTitle: string; ranges: readonly LessonSection[]; max: number }) {
  const reply = useVisuals(materialId, true);
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());
  // The stored choice is read after hydration (the server renders the pictures' own behaviour), then kept in state.
  const stored = useSyncExternalStore(noSubscribe, () => readMode(materialId), () => null);
  const [chosen, setChosen] = useState<{ value: VisualMode | null } | null>(null);
  const mode = chosen ? chosen.value : stored;
  const pick = (value: VisualMode | null) => { setChosen({ value }); writeMode(materialId, value); };
  // SCHOLAR-VISUAL-001: with the picture-only slides that follow these sections, which have no section of their own to be cited by.
  const found = reply?.visuals?.length ? preferWhole(visualsForLesson(reply.visuals, reply.noSection ?? [], ranges).filter(v => !broken.has(v.key))) : [];
  if (!reply || reply.off || !found.length) return null;
  const arranged = arrangeStrip(found, mode, all ? found.length : max);
  const own = new Set(found.map(v => v.behaviour));
  const selected = mode ?? (own.size === 1 ? [...own][0] : null);
  const heading = found[0].unit === "page" ? "From your pages" : found[0].unit === "section" ? "From your document" : "From your slides";
  return (
    <section aria-label={heading} className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[13.5px] font-bold text-gray-900">{heading}</h3>
        <div role="radiogroup" aria-label="How to use these pictures" className="inline-flex flex-wrap overflow-hidden rounded-xl border border-gray-300 bg-white">
          {MODES.map(m => (
            <button key={m.value} type="button" role="radio" aria-checked={selected === m.value} onClick={() => pick(m.value)}
              className={`min-h-[40px] px-3 py-1.5 text-[12.5px] font-semibold ${touch} ${focusRing} ${selected === m.value ? "bg-gray-900 text-white" : "bg-white text-gray-800 hover:bg-gray-50"}`}>{m.label}</button>
          ))}
        </div>
      </div>
      {mode && <p className="mt-1 text-[12px] text-gray-700">Your choice, kept on this device. <button type="button" onClick={() => pick(null)} className={`font-semibold underline ${touch} ${focusRing}`}>Go back to automatic</button></p>}
      {arranged.shown.length > 0 && (
        <ul className={`mt-2 grid grid-cols-1 gap-3 ${arranged.shown.length === 1 ? "" : arranged.shown.length === 2 ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3"}`}>
          {arranged.shown.map(v => (
            <li key={v.key} className="min-w-0">
              <VisualCard v={v} materialId={materialId} materialTitle={materialTitle} onOpen={() => setOpen(v.key)} onBroken={() => setBroken(b => new Set(b).add(v.key))}
                textHref={v.aiRead ? textHrefOf(v, materialId, ranges) : null} />
            </li>
          ))}
        </ul>
      )}
      {arranged.more > 0 && <button type="button" onClick={() => setAll(true)} className={`${ghostBtn} mt-2`}>Show all {arranged.shown.length + arranged.more} pictures</button>}
      {arranged.textOnly.length > 0 && (
        <ul className="mt-2 space-y-1">
          {arranged.textOnly.map(v => (
            <li key={v.key}>
              <details className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800">
                <summary className={`cursor-pointer font-semibold ${touch} ${focusRing}`}>{v.caption}: {v.whole ? `the whole ${noun(v)}` : `the original ${noun(v)}`}</summary>
                <p className="mt-1 text-gray-700">{v.hasText ? `The text of this ${noun(v)} teaches it; the original is kept here.` : "No text was read from this picture."}</p>
                <button type="button" onClick={() => setOpen(v.key)} className={`${ghostBtn} mt-2`}>{v.whole ? `Open the whole ${noun(v)}` : `Open the original ${noun(v)}`}</button>
              </details>
            </li>
          ))}
        </ul>
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

/** The AI-read text of a chart or table page: never open by default, never to be used for scores or thresholds. */
function SafeText({ text }: { text: string }) {
  return (
    <details className="mt-1 rounded-lg border border-gray-300 bg-gray-50 px-2 py-1 text-[12.5px] text-gray-800">
      <summary className={`cursor-pointer font-semibold ${touch} ${focusRing}`}>{SAFE_TEXT_LABEL}</summary>
      <p className="mt-1 whitespace-pre-line break-words">{text}</p>
    </details>
  );
}

function VisualCard({ v, materialId, materialTitle, onOpen, onBroken, textHref }: { v: Visual; materialId: string; materialTitle: string; onOpen: () => void; onBroken: () => void; textHref: string | null }) {
  const page = v.kind === "pdf_page";
  return (
    <figure className="flex h-full flex-col overflow-hidden rounded-xl border border-gray-200 bg-white">
      {page ? (
        <div className="flex flex-1 flex-col items-start gap-2 p-3">
          <p className="text-[13px] font-semibold text-gray-900">{v.caption}</p>
          <button type="button" onClick={onOpen} className={ghostBtn}>Open the original page</button>
        </div>
      ) : (
        <button type="button" onClick={onOpen} aria-label={v.whole ? `Enlarge the whole of ${noun(v)} ${v.n}` : `Enlarge the original picture from ${noun(v)} ${v.n}`}
          className={`flex w-full items-center justify-center bg-white p-1 ${touch} ${focusRing}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- the learner's own file, shown as it is: never resized, cropped or stretched */}
          <img src={visualUrl(materialId, v.key)} onError={v.whole ? onBroken : undefined} loading="lazy" decoding="async" alt={v.whole ? `Whole ${noun(v)} ${v.n} of ${materialTitle}` : `Original picture from ${noun(v)} ${v.n} of ${materialTitle}`}
            className="h-auto max-h-[220px] w-auto max-w-full bg-white object-contain md:max-h-[280px]" />
        </button>
      )}
      <figcaption className="border-t border-gray-200 px-3 py-2 text-[12.5px] text-gray-700">
        {!page && <span className="block font-semibold text-gray-900">{v.caption}</span>}
        <span className="block"><span className="mr-1 inline-block rounded-full border border-gray-300 bg-gray-50 px-2 py-0.5 text-[11.5px] font-semibold text-gray-800">{v.label}</span>{labelOf(v)}</span>
        {v.aiRead && (
          <span className="mt-0.5 block font-semibold text-gray-900">{AI_NOTE}
            {textHref && <> <Link href={textHref} className={`underline ${focusRing}`}>See that section&apos;s text</Link></>}
          </span>
        )}
        {v.safeText && <SafeText text={v.safeText} />}
      </figcaption>
    </figure>
  );
}

// ── FLASHCARDS AND REVISE: "View the original slide / page picture" for the item's source ──
/** A button that, when pressed, asks for the material's pictures (once) and opens the dialog on the cited slide / page's. */
export function SourcePictureButton({ materialId, materialTitle, citation, className }: { materialId: string; materialTitle?: string; citation: string; className?: string }) {
  const cited = pagesOfCitation(citation);
  // A Word section's pictures show in its notes. Here, as before, only a slide or page has a picture to look up.
  const range = cited?.unit === "section" ? null : cited;
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
        {state === "loading" ? "Looking for the picture…" : `View the ${word}'s pictures`}
      </button>
      {state === "none" && <span role="status" className="self-center text-[12.5px] text-gray-700">This {word} has no separate original picture{range.unit === "page" ? " (only image-only pages are shown)" : ""}.</span>}
      {state === "failed" && <span role="status" className="self-center text-[12.5px] text-gray-700">The picture could not be fetched just now. Try again shortly.</span>}
      {shown && <VisualDialog materialId={materialId} materialTitle={title} visuals={shown.visuals} startKey={shown.start} onClose={() => setShown(null)} />}
    </>
  );
}
