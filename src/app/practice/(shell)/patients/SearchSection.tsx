"use client";

import Link from "next/link";
import { useState } from "react";

// CPR-REG-002 s20/s21 -- search first, and show possible duplicates as you type.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE CHIPS NARROW THE ANSWER, THEY DO NOT NARROW THE SEARCH.
//
// The comp draws Name · Phone · Hospital Number · National ID · Practice ID · Email · More as filter
// buttons. Making them restrict what is searched would be worse than useless at a desk: somebody hands
// over a card, you do not know which KIND of number is on it, and picking the wrong chip returns
// "nobody matches" about a patient who is right there. So every search covers everything the engine
// indexes, and a chip HIGHLIGHTS the results that matched that way -- turning the filter into a lens.
//
// SEARCH IS EXPLICIT, NOT PER-KEYSTROKE. s21 asks for duplicates "in real time"; every prefix of a
// surname typed into a live search is a separate read of clinical records into a real access log
// (CPR-370). Debounced-on-pause rather than on every character, and the page says search happens when
// you stop typing.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

const MATCH_LABEL: Record<string, string> = {
  name: "exact name", "name-partial": "name contains", phone: "phone", email: "email",
};

const LENSES = [
  { key: "all", label: "Everything" },
  { key: "name", label: "Name" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "identifier", label: "Any number" },
];

export default function SearchSection({ canCreate, onRegisterClick }: {
  canCreate: boolean;
  onRegisterClick: () => void;
}) {
  const [q, setQ] = useState("");
  const [lens, setLens] = useState("all");
  const [results, setResults] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  async function run(term: string) {
    if (term.trim().length < 2) { setResults(null); return; }
    setBusy(true);
    const r = await fetch(`/api/v1/practice/patients?q=${encodeURIComponent(term.trim())}`);
    setResults(r.ok ? (await r.json()).results : []);
    setBusy(false);
  }

  function onType(v: string) {
    setQ(v);
    if (timer) clearTimeout(timer);
    // ON PAUSE, NOT ON KEYSTROKE. See the header: each read is logged against a named patient.
    setTimer(setTimeout(() => void run(v), 450));
  }

  const shown = (results ?? []).filter(r =>
    lens === "all" ||
    (lens === "name" && String(r.matchedBy).startsWith("name")) ||
    (lens === "phone" && r.matchedBy === "phone") ||
    (lens === "email" && r.matchedBy === "email") ||
    (lens === "identifier" && String(r.matchedBy).startsWith("identifier")));

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex items-baseline gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--cp-primary)] text-[12px] font-bold text-white">1</span>
        <h2 className="text-[14px] font-bold text-gray-900">Search first</h2>
        <span className="text-[12px] text-gray-500">Register only when nobody matches.</span>
      </div>

      <div className="mt-3 flex gap-2">
        <input
          value={q}
          onChange={e => onType(e.target.value)}
          placeholder="Name, phone, Practice ID, hospital number, national ID, passport or email"
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-[14px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10"
        />
        <button type="button" onClick={() => void run(q)} disabled={busy || q.trim().length < 2}
          className="shrink-0 rounded-lg bg-[var(--cp-primary)] px-4 py-2 text-[14px] font-semibold text-white disabled:opacity-40">
          {busy ? "Searching…" : "Search"}
        </button>
      </div>

      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
        {LENSES.map(l => (
          <button key={l.key} type="button" onClick={() => setLens(l.key)}
            className={`rounded-lg border px-2.5 py-1 text-[12px] font-semibold ${
              lens === l.key ? "border-[var(--cp-primary)] bg-[var(--cp-primary)]/5 text-[var(--cp-primary-deep)]"
                : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
            {l.label}
          </button>
        ))}
        <span className="ml-1 text-[11px] text-gray-400">
          Every search looks everywhere &mdash; these only narrow what is shown.
        </span>
      </div>

      {results !== null && (
        <div className="mt-3">
          <p className="text-[12px] font-semibold text-gray-600">
            {shown.length === 0
              ? results.length === 0 ? "Nobody matches." : `Nothing matched that way — ${results.length} match other ways.`
              : `${shown.length} possible match${shown.length === 1 ? "" : "es"}`}
          </p>
          {shown.length > 0 && (
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {shown.map(r => (
                <li key={r.id}>
                  <Link href={`/practice/patients/${r.id}`}
                    className="flex items-center gap-2 rounded-lg border border-gray-100 px-3 py-2 hover:border-[var(--cp-primary)] transition">
                    <span className="text-[14px] font-semibold text-gray-900">{r.displayName}</span>
                    {r.practiceId && <span className="font-mono text-[12px] text-gray-500">{r.practiceId}</span>}
                    {r.birthDate && <span className="text-[12px] text-gray-400">b. {r.birthDate}</span>}
                    <span className="ml-auto rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-semibold text-gray-500">
                      {MATCH_LABEL[r.matchedBy] ?? r.matchedBy}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {results.length === 0 && canCreate && (
            <button type="button" onClick={onRegisterClick}
              className="mt-2 rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[13px] font-semibold text-white">
              Register {q.trim() ? `“${q.trim()}”` : "a new patient"}
            </button>
          )}
        </div>
      )}

      {/* THE COMP'S "SCAN ID" BUTTON, in its designed position and honest about itself. */}
      <p className="mt-3 border-t border-gray-100 pt-2 text-[11px] text-gray-400">
        The design puts a &ldquo;Scan ID&rdquo; button here. Reading a national ID or a passport needs a
        camera and a document parser, neither of which exists yet &mdash; and every number a scan would
        produce is already searchable by typing it.
      </p>
    </section>
  );
}
