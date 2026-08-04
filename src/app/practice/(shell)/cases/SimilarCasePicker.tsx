"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// The comp's "Find Similar Cases" panel has five tabs -- Natural Language, Condition, Procedure,
// Patient Profile, Advanced -- and a row of popular-search chips.
//
// FOUR OF THE FIVE TABS ARE THE SAME QUESTION. Condition, Procedure and Patient Profile are all "find
// cases sharing this fact", and the engine already matches on every one of those at once, so splitting
// them into tabs would make a reader choose which fact to search by when they can have all four.
// Natural Language needs the AI assistant, which is not built.
//
// So: name a case, get the cases that share something with it. The chips are gone because a popular
// search across a private practice is a count of one person's own habits, and there is nothing to
// aggregate them from.

export default function SimilarCasePicker({ current }: { current: string }) {
  const router = useRouter();
  const [value, setValue] = useState(current);

  return (
    <form
      className="mt-2 flex flex-wrap items-center gap-2"
      onSubmit={e => {
        e.preventDefault();
        const id = value.trim();
        router.push(id ? `/practice/cases?similarTo=${encodeURIComponent(id)}` : "/practice/cases");
      }}
    >
      <input
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder="Paste a consultation's id, or open one and use Find similar"
        aria-label="Consultation to compare against"
        className="min-w-0 flex-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] text-gray-800 placeholder:text-gray-400"
      />
      <button type="submit"
        className="rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-semibold text-white">
        Find similar
      </button>
      {current && (
        <button type="button" onClick={() => { setValue(""); router.push("/practice/cases"); }}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
          Clear
        </button>
      )}
    </form>
  );
}
