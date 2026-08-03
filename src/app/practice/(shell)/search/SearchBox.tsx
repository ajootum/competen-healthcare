"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// The box only. Results are rendered by the server page from the query string -- see its header for why
// clinical search results are not held in client state.
//
// SUBMIT, NOT SEARCH-AS-YOU-TYPE. A keystroke-triggered search over clinical notes fires a query for
// every prefix of what somebody is typing, which means "hiv" is searched on the way to "hives" and every
// one of those partial searches is a real read of a real record in a real log. The deliberate submit is
// one search per intention.

export default function SearchBox({ initial }: { initial: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);

  return (
    <form
      className="mt-4 flex gap-2"
      onSubmit={e => {
        e.preventDefault();
        router.push(q.trim() ? `/practice/search?q=${encodeURIComponent(q.trim())}` : "/practice/search");
      }}
    >
      <input
        autoFocus
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="A name, a diagnosis, something you remember writing..."
        aria-label="Search this practice"
        className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-[14px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10"
      />
      <button
        type="submit"
        className="shrink-0 rounded-lg bg-[var(--cp-primary)] px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-[var(--cp-primary-deep)]"
      >
        Search
      </button>
      {initial && (
        <button
          type="button"
          onClick={() => { setQ(""); router.push("/practice/search"); }}
          className="shrink-0 rounded-lg border border-gray-200 px-3 py-2.5 text-[13px] font-semibold text-gray-600 hover:bg-gray-50"
        >
          Clear
        </button>
      )}
    </form>
  );
}
