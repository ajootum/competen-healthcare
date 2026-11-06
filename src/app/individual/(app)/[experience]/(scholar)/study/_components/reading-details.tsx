"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { focusRing } from "@/app/individual/_components/primitives";
import { aiReadLabel } from "@/lib/individual/scholar/extract";
import { SLIDE_READING_EVENT, slideCounts, type SlideRow, type SlideStatus } from "@/lib/individual/scholar/slide-classify";

// SCHOLAR-PPTX-READING-01: what happened to each slide of a learner's own presentation. Compact and closed by default. Choosing an
// affected slide shows its picture from the original file and what Scholar took from it. No AI, and nothing here changes a section.

const STATUS_LABEL: Record<SlideStatus, string> = {
  text: "Text read",
  image: "Interpreted from a picture",
  mixed: "Text and picture read",
  blank: "Blank, skipped",
  preserved: "Picture kept, not interpreted yet",
  review: "Needs review",
  processing: "Reading now",
};

const chip = `min-h-[36px] rounded-lg border px-3 text-[12.5px] font-semibold pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;

function SlidePanel({ materialId, row, extract }: { materialId: string; row: SlideRow; extract: string | undefined }) {
  const [noPicture, setNoPicture] = useState<number | null>(null);
  const usedAi = row.methods.includes("ai_picture");
  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-[13px] text-gray-800" aria-live="polite">
      <p className="font-semibold text-gray-900">Slide {row.slide}: {STATUS_LABEL[row.status]}</p>
      {row.status === "blank" && <p className="mt-1">This slide has no learning content, so Scholar does not teach from it or count it.</p>}
      {row.reasons.length > 0 && <p className="mt-1">It holds {row.reasons.join(", and ")}.</p>}
      {row.status === "preserved" && <p className="mt-1">The original picture is kept and shown with your notes. Scholar has not interpreted it yet, so nothing has been said about it.</p>}
      {row.grouped && <p className="mt-1">Scholar looked inside the grouped items on this slide.</p>}
      {usedAi && <p className="mt-1 font-medium">{aiReadLabel("slide", row.slide)}.</p>}
      {row.status !== "blank" && noPicture !== row.slide && (
        // The learner's own picture, by their own material id. Its size is unknown, so it is limited rather than optimised.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/individual/scholar/materials/${materialId}/slides?slide=${row.slide}`} alt={`A picture from slide ${row.slide} of your file`} loading="lazy"
          onError={() => setNoPicture(row.slide)} className="mt-2 max-h-64 max-w-full rounded border border-gray-200 bg-white" />
      )}
      {extract ? (
        <>
          <p className="mt-2 font-semibold text-gray-900">What Scholar took from this slide</p>
          <p className="mt-0.5 whitespace-pre-wrap break-words">{extract}</p>
        </>
      ) : row.status !== "blank" && <p className="mt-2">Scholar has taken no text from this slide.</p>}
      <p className="mt-2"><a href={`/api/individual/scholar/materials/${materialId}`} className={`font-semibold underline underline-offset-2 ${focusRing}`}>Open your original file</a></p>
    </div>
  );
}

export function ReadingDetails({ materialId, rows, extracts }: { materialId: string; rows: SlideRow[]; extracts: Record<number, string> }) {
  const [reading, setReading] = useState<number[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ materialId: string; slides: number[] }>).detail;
      if (d?.materialId === materialId) setReading(d.slides);
    };
    window.addEventListener(SLIDE_READING_EVENT, on);
    return () => window.removeEventListener(SLIDE_READING_EVENT, on);
  }, [materialId]);
  const shown = useMemo(() => rows.map(r => (reading.includes(r.slide) ? { ...r, status: "processing" as const } : r)), [rows, reading]);
  const c = slideCounts(shown);
  const affected = shown.filter(r => r.status !== "text");
  const row = shown.find(r => r.slide === selected) ?? null;
  const counts: [string, number][] = [
    ["Total slides", c.total], ["Slides with readable text", c.text], ["Slides interpreted from images", c.image], ["Slides with mixed content", c.mixed],
    ["Pictures kept, not interpreted yet", c.preserved], ["Blank slides skipped", c.blank], ["Slides requiring review", c.review], ...(c.processing ? [["Slides being read now", c.processing] as [string, number]] : []),
  ];
  return (
    <details className="mb-4 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-[13.5px] text-gray-800">
      <summary className={`cursor-pointer font-semibold text-gray-900 ${focusRing}`}>Reading details</summary>
      <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        {counts.map(([label, n]) => (
          <div key={label} className="flex justify-between gap-3 border-b border-gray-100 py-1">
            <dt className="text-gray-700">{label}</dt>
            <dd className="font-semibold tabular-nums text-gray-900">{n}</dd>
          </div>
        ))}
      </dl>
      {affected.length > 0 && (
        <>
          <p className="mt-3 font-medium text-gray-900">Choose a slide to see what happened to it</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {affected.map(r => (
              <button key={r.slide} type="button" aria-pressed={selected === r.slide} aria-label={`Slide ${r.slide}: ${STATUS_LABEL[r.status]}`} onClick={() => setSelected(selected === r.slide ? null : r.slide)}
                className={`${chip} ${selected === r.slide ? "border-gray-900 bg-gray-900 text-white" : r.status === "review" ? "border-amber-300 bg-amber-50 text-amber-950" : "border-gray-300 bg-white text-gray-800"}`}>
                {r.slide}
              </button>
            ))}
          </div>
        </>
      )}
      {row && <SlidePanel materialId={materialId} row={row} extract={extracts[row.slide]} />}
    </details>
  );
}

/** A presentation uploaded before slides were classified. Checking again uses no AI and changes only this record. */
export function CheckSlidesAgain({ materialId }: { materialId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const check = async () => {
    setBusy(true); setError("");
    const r = await fetch(`/api/individual/scholar/materials/${materialId}/reading`, { method: "POST" }).catch(() => null);
    setBusy(false);
    if (r?.ok) { router.refresh(); return; }
    const body = await r?.json().catch(() => null);
    setError(body?.error ?? "The check did not finish. Try again shortly.");
  };
  return (
    <div className="mb-4 rounded-xl border border-gray-200 bg-white px-4 py-3 text-[13.5px] text-gray-800">
      <p>Scholar can now check each slide more closely, including grouped items and blank slides. This uses no AI, and your lessons, plans and answers stay as they are.</p>
      <button type="button" onClick={check} disabled={busy} className={`${chip} mt-2 border-gray-300 bg-white text-gray-900 hover:bg-gray-50 disabled:opacity-60`}>{busy ? "Checking…" : "Check the slides again"}</button>
      {error && <p role="alert" className="mt-2 text-red-700">{error}</p>}
    </div>
  );
}
