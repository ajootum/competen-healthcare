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
          // CPR-MOB-001 s4: 44px minimum below md, where this field is the prominent Ask module s13
          // asks for. text-[16px] on the phone is not a style choice -- iOS Safari zooms the whole
          // page in when a focused input's text is under 16px, which would break s4's no-horizontal-
          // scroll rule on the one control s13 most wants used. Desktop keeps text-[12px] exactly.
          className="w-full rounded-lg border border-gray-200 py-1.5 pl-7 pr-2.5 text-[12px] text-gray-800 outline-none placeholder:text-gray-400 focus:border-sky-400 focus:ring-2 focus:ring-sky-100 max-md:min-h-[var(--cp-touch)] max-md:text-[16px]"
        />
      </label>
      <button type="button" onClick={submit} disabled={q.trim().length < 3}
        className="rounded-lg bg-sky-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-sky-700 disabled:opacity-40 max-md:min-h-[var(--cp-touch)] max-md:px-5 max-md:text-[13px]">
        Ask
      </button>
    </div>
  );
}
