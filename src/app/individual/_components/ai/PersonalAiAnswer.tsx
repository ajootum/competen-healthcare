"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import { ScholarAnswer } from "../scholar-answer/ScholarAnswer";
import {
  DEPTHS, DEPTH_LABEL, FOLLOW_UPS, FOLLOW_UP_LABEL, readPersonalAi,
  type FollowUpKind, type PersonalAiDepth, type PersonalAiSourceRef, type ReadOutcome,
} from "@/lib/individual/personal-ai-options";
import { splitNotCovered } from "@/lib/individual/scholar/answer-format";
import { experienceHref } from "@/lib/individual/experiences";
import { LEARN_MODE_LABEL } from "@/lib/individual/scholar/config";

// SCHOLAR-PAI-EXPERIENCE-01: what the Scholar Personal AI shows in both places it answers (the Personal AI page and
// Learn's "Continue with your personal assistant"): the depth control, the streamed structured answer, the follow-ups,
// and the HONEST way to keep a practice flashcard.
//
// ⚠ AN AI-WRITTEN CARD IS NEVER SAVED AS IF THE LEARNER WROTE IT. The only store for a learner's own card is
// POST /api/individual/scholar/flashcards, which records it as hand-written (migration 730 binds provenance 'learner').
// So "Save" here opens "Edit and save as my card": the front and back, editable, with what saving means said plainly,
// and nothing is stored until the learner confirms it as their own. Never into a shared or clinically approved library.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const touch = "min-h-[40px] pointer-coarse:min-h-[var(--cmp-touch-min)]";
const chip = `inline-flex ${touch} items-center justify-center rounded-lg border border-gray-300 bg-white px-3 text-[13.5px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 ${focusRing}`;

/** POST one Personal AI request, asking for a stream; the answer so far goes to `onText`. Never throws. */
export async function askPersonalAi(url: string, body: Record<string, unknown>, onText: (soFar: string) => void, signal?: AbortSignal): Promise<ReadOutcome> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/x-ndjson, application/json" }, body: JSON.stringify({ ...body, stream: true }), signal });
    return await readPersonalAi(res, onText);
  } catch {
    return { kind: "json", ok: false, status: 0, json: { error: "The assistant could not be reached. Check your connection and try again." } };
  }
}

/** Quick / Standard / Deep. Length only: depth never changes the safeguards or the model. */
export function DepthControl({ value, onChange, disabled }: { value: PersonalAiDepth; onChange: (d: PersonalAiDepth) => void; disabled?: boolean }) {
  return (
    <div role="group" aria-label="Answer depth" className="inline-flex overflow-hidden rounded-lg border border-gray-300">
      {DEPTHS.map((d, i) => (
        <button key={d} type="button" aria-pressed={value === d} disabled={disabled} onClick={() => onChange(d)}
          className={`${touch} px-3 text-[13.5px] font-semibold ${i ? "border-l border-gray-300" : ""} ${value === d ? "bg-gray-900 text-white" : "bg-white text-gray-800 hover:bg-gray-50"} disabled:opacity-50 ${focusRing}`}>
          {DEPTH_LABEL[d]}
        </button>
      ))}
    </div>
  );
}

/** Simplify / Go deeper / Practise, under a finished answer. Each is a fixed request on the server, never free text. */
export function FollowUpActions({ onPick, disabled }: { onPick: (k: FollowUpKind) => void; disabled?: boolean }) {
  return (
    <div role="group" aria-label="Follow up on this answer" className="flex flex-wrap gap-2">
      {FOLLOW_UPS.map(k => <button key={k} type="button" className={chip} disabled={disabled} onClick={() => onPick(k)}>{FOLLOW_UP_LABEL[k]}</button>)}
    </div>
  );
}

/** Where a learner's own card may be filed: one of their own materials (the flashcards route checks it is theirs). */
export type OwnCardTarget = { materials: readonly { id: string; title: string }[]; materialId?: string | null };

// Learn remembers the learner's source mode on this device under this key (learn-client MODE_KEY); "Explore with Research &
// Explain" sets the same choice, then opens Learn on the missing topic -- the learner's own choice, made by their own click.
const LEARN_MODE_KEY = "scholar.learn.mode";

/**
 * A Scholar Personal AI answer, with "Edit and save as my card" when the learner has somewhere to file one.
 * SCHOLAR-PAI-RESEARCH-01 (Learn-step answers): `sources` are the numbered notes the answer cites (from the reply's `sources`), and
 * `research` is whether Research & Explain is a Learn mode this learner is offered (the shown Learn modes include "research"); with it,
 * an answer that names what the notes did not cover links to Learn's Research & Explain on that topic.
 */
export function PersonalAiAnswer({ text, streaming, label, save, sources, research }: {
  text: string; streaming?: boolean; label?: string; save?: OwnCardTarget | null; sources?: readonly PersonalAiSourceRef[]; research?: boolean;
}) {
  const [draft, setDraft] = useState<{ front: string; back: string } | null>(null);
  const [n, setN] = useState(0);
  const canSave = !!save && save.materials.length > 0 && !streaming;
  const missing = research && !streaming ? splitNotCovered(text).items : [];
  const explore = missing.length ? (
    <Link href={`${experienceHref("scholar", "study/learn")}?topic=${encodeURIComponent(missing[0])}`} className={chip}
      onClick={() => { try { window.localStorage.setItem(LEARN_MODE_KEY, "research"); } catch { /* not remembered: Learn opens in its usual mode */ } }}>
      Explore with {LEARN_MODE_LABEL.research}
    </Link>
  ) : undefined;
  return (
    <div className="min-w-0">
      <ScholarAnswer text={text} streaming={streaming} label={label} sources={sources} notCoveredAction={explore}
        onSaveFlashcard={canSave ? async card => { setDraft(card); setN(x => x + 1); return "Check the card below, then save it as your own."; } : undefined} />
      {canSave && draft && <OwnCardEditor key={n} card={draft} target={save!} onClose={() => setDraft(null)} />}
    </div>
  );
}

function OwnCardEditor({ card, target, onClose }: { card: { front: string; back: string }; target: OwnCardTarget; onClose: () => void }) {
  const id = useId();
  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back);
  const first = target.materials.find(m => m.id === target.materialId) ?? target.materials[0];
  const [materialId, setMaterialId] = useState(first?.id ?? "");
  const [state, setState] = useState<"edit" | "saving" | "saved">("edit");
  const [msg, setMsg] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state !== "edit") return;
    setState("saving"); setMsg(null);
    try {
      const res = await fetch("/api/individual/scholar/flashcards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ materialId, front, back }) });
      const json = await res.json().catch(() => ({})) as { error?: string; note?: string | null };
      if (!res.ok) { setMsg(json.error ?? "Your card could not be saved just now."); setState("edit"); return; }
      setMsg(json.note ?? "Saved to your flashcards as your own card."); setState("saved");
    } catch { setMsg("Competen could not be reached. Check your connection and try again."); setState("edit"); }
  }
  return (
    <section aria-labelledby={`${id}-h`} className="mt-4 rounded-xl border border-gray-300 bg-white p-4">
      <h4 id={`${id}-h`} ref={heading} tabIndex={-1} className="text-[15px] font-semibold text-gray-900">Edit and save as my card</h4>
      <p className="mt-1 text-[13.5px] leading-relaxed text-gray-700">Your Personal AI drafted this card. Saving makes it your own card: it is recorded as written by you, not as made by AI and not as clinically reviewed. Check it and change anything that is not right first.</p>
      {state === "saved" ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p role="status" className="text-[14px] font-semibold text-gray-900">{msg}</p>
          <button type="button" className={chip} onClick={onClose}>Close</button>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-3 space-y-3">
          <div>
            <label htmlFor={`${id}-f`} className="block text-[13.5px] font-semibold text-gray-900">Front (a question)</label>
            <textarea id={`${id}-f`} rows={2} maxLength={300} value={front} onChange={e => setFront(e.target.value)} className={`mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-2 text-[14.5px] text-gray-900 ${focusRing}`} />
          </div>
          <div>
            <label htmlFor={`${id}-b`} className="block text-[13.5px] font-semibold text-gray-900">Back</label>
            <textarea id={`${id}-b`} rows={3} maxLength={600} value={back} onChange={e => setBack(e.target.value)} className={`mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-2 text-[14.5px] text-gray-900 ${focusRing}`} />
          </div>
          {target.materials.length > 1 ? (
            <div>
              <label htmlFor={`${id}-m`} className="block text-[13.5px] font-semibold text-gray-900">File it under</label>
              <select id={`${id}-m`} value={materialId} onChange={e => setMaterialId(e.target.value)} className={`mt-1 w-full rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-[14px] text-gray-900 ${touch} ${focusRing}`}>
                {target.materials.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
              </select>
            </div>
          ) : first && <p className="text-[13px] text-gray-700">Filed under {first.title}.</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={state === "saving" || !front.trim() || !back.trim() || !materialId}
              className={`inline-flex ${touch} items-center justify-center rounded-lg bg-gray-900 px-4 text-[14px] font-semibold text-white hover:opacity-90 disabled:opacity-50 ${focusRing}`}>
              {state === "saving" ? "Saving…" : "Save as my card"}
            </button>
            <button type="button" className={chip} onClick={onClose} disabled={state === "saving"}>Cancel</button>
          </div>
          <p role="status" className="text-[13.5px] text-gray-800">{msg ?? ""}</p>
        </form>
      )}
    </section>
  );
}
