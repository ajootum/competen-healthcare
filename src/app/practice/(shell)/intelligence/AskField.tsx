"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// CPR-PI-001 s7.1's "universal intelligence search or Ask field".
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// IT HANDS THE QUESTION TO THE ASSISTANT AREA. IT DOES NOT ANSWER ONE.
//
// The comps draw this field with an answer appearing beneath it -- "I found 6 patients with overdue
// follow-ups" -- and a set of suggestion chips. The chips are fine and are on the Assistant area where
// the consent gate, the model name and the grounding links are all visible beside them.
//
// Answering INLINE here is not. Every route into this assistant goes through one consent gate, one
// disclosure log and one grounding contract; a second entry point that skipped straight to an answer
// would be a second implementation of all three, and the one somebody forgot to update. So this field
// navigates -- one line of behaviour, no fetch, no answer, no state that outlives the keystroke.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export default function AskField({ tabHref }: { tabHref: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");

  const submit = () => {
    const question = q.trim();
    if (question.length < 3) return;
    const sep = tabHref.includes("?") ? "&" : "?";
    router.push(`${tabHref}${sep}q=${encodeURIComponent(question)}`);
  };

  return (
    <div className="flex items-center gap-1.5">
      <label className="relative flex-1">
        <span className="sr-only">Ask about your practice</span>
        <span aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] text-sky-600">✦</span>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") submit(); }}
          placeholder="Ask about your own records…"
          className="w-full rounded-lg border border-gray-200 py-1.5 pl-7 pr-2.5 text-[12px] text-gray-800 outline-none placeholder:text-gray-400 focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
        />
      </label>
      <button type="button" onClick={submit} disabled={q.trim().length < 3}
        className="rounded-lg bg-sky-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-sky-700 disabled:opacity-40">
        Ask
      </button>
    </div>
  );
}
