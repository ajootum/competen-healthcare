"use client";

// SALE-2026-11 R1 / SALE-04 learner control: correct the topics of a section behind a topic's evidence. The EXISTING correction
// (POST /api/individual/scholar/topics: the learner's own list for their own section, screened for identifiers, no AI). The page
// re-reads after a save, so the evidence moves to the corrected topic. Nothing reaches a shared catalogue.

import { useState } from "react";
import { useRouter } from "next/navigation";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const ghost = `inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-[13px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;

export function TopicFix({ sections }: { sections: { chunkId: string; label: string; topics: string[] }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [state, setState] = useState<{ chunkId: string; msg: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  async function save(chunkId: string) {
    setBusy(true); setState(null);
    const r = await fetch("/api/individual/scholar/topics", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chunkId, topics: text.split("\n") }) }).catch(() => null);
    const json = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    if (r?.ok) { setState({ chunkId, msg: "Saved. Your evidence now follows these topics.", ok: true }); setOpen(null); router.refresh(); }
    else setState({ chunkId, msg: typeof json?.error === "string" ? json.error : "Your topics could not be saved just now.", ok: false });
  }
  return (
    <ul className="mt-1.5 space-y-1.5">
      {sections.map(s => (
        <li key={s.chunkId} className="text-[12.5px] text-gray-800">
          <span className="font-semibold">{s.label}</span>{s.topics.length ? `: ${s.topics.join(", ")}` : ""}{" "}
          {open !== s.chunkId && <button type="button" className={`${ghost} ml-1`} onClick={() => { setOpen(s.chunkId); setText(s.topics.join("\n")); setState(null); }}>Correct topics</button>}
          {open === s.chunkId && (
            <div className="mt-1">
              <label htmlFor={`fix-${s.chunkId}`} className="block text-[12.5px] font-semibold text-gray-700">This section&apos;s topics, one per line</label>
              <textarea id={`fix-${s.chunkId}`} rows={3} value={text} onChange={e => setText(e.target.value)} className={`mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-2 text-[14px] ${focusRing}`} />
              <div className="mt-1 flex flex-wrap gap-2">
                <button type="button" className={ghost} disabled={busy || !text.trim()} onClick={() => void save(s.chunkId)}>{busy ? "Saving…" : "Save topics"}</button>
                <button type="button" className={ghost} disabled={busy} onClick={() => setOpen(null)}>Cancel</button>
              </div>
            </div>
          )}
          {state?.chunkId === s.chunkId && <p role={state.ok ? "status" : "alert"} className={`mt-1 ${state.ok ? "text-gray-800" : "text-red-700"}`}>{state.msg}</p>}
        </li>
      ))}
    </ul>
  );
}
