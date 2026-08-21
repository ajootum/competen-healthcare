"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { IDENTIFIER_LABELS, humaniseMatchKind } from "@/lib/practice/patient-workspace-constants";
import type { SearchMatchView, SearchView } from "./types";

// CPR-REG-002 s20/s21 -- search before you register, inside the registration drawer.
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
// SEARCH IS ON PAUSE, NOT PER KEYSTROKE. s21 asks for duplicates "in real time"; every prefix of a
// surname typed into a live search is a separate read of clinical records into a real access log
// (CPR-370). Debounced on pause rather than on every character, and the box says so.
//
// ⚠ IT NOW CALLS universalSearch, NOT searchPatients. The old endpoint (GET /api/v1/practice/patients?q=)
// discards every query error, so a database that refused the identifier read answered "nobody matches"
// for a national ID sitting in the table -- and this box's whole purpose is to stop a duplicate being
// created on the strength of that answer. The new one reports which probes failed, and this component
// refuses to say "nobody matches" when any of them did.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

const LENSES = [
  { key: "all", label: "Everything" },
  { key: "name", label: "Name" },
  { key: "identifier", label: "Any number" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "guardian", label: "Parent or guardian" },
];

function matchLabel(m: SearchMatchView): string {
  const [kind, detail] = m.matchedBy.split(":");
  if (kind === "identifier") return IDENTIFIER_LABELS[detail] ?? humaniseMatchKind(detail);
  if (kind === "guardian_phone") return `${m.matchedGuardian?.relationshipLabel ?? "guardian"}'s phone`;
  if (kind === "guardian_email") return `${m.matchedGuardian?.relationshipLabel ?? "guardian"}'s email`;
  if (kind === "name_partial") return "name contains";
  // Never the raw kind: an unmapped one is humanised in the shared constants, not printed as a column.
  return humaniseMatchKind(kind);
}

function inLens(m: SearchMatchView, lens: string): boolean {
  if (lens === "all") return true;
  if (lens === "guardian") return m.matchedVia === "guardian";
  if (lens === "identifier") return m.matchedBy.startsWith("identifier");
  if (lens === "name") return m.matchedBy.startsWith("name");
  return m.matchedBy === lens;
}

export default function SearchSection({ canCreate }: { canCreate: boolean }) {
  const [q, setQ] = useState("");
  const [lens, setLens] = useState("all");
  const [view, setView] = useState<SearchView | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  async function run(term: string) {
    if (term.trim().length < 2) { setView(null); setFailed(null); return; }
    const mine = ++seq.current;
    setBusy(true); setFailed(null);
    try {
      const r = await fetch(`/api/v1/practice/patients/search?q=${encodeURIComponent(term.trim())}`);
      if (mine !== seq.current) return;
      if (!r.ok) { setView(null); setFailed(`The duplicate check did not run (HTTP ${r.status}).`); return; }
      setView(await r.json() as SearchView);
    } catch (e) {
      if (mine !== seq.current) return;
      setView(null);
      setFailed(`The duplicate check did not reach the server: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (mine === seq.current) setBusy(false);
    }
  }

  function onType(v: string) {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void run(v), 450);
  }

  const results = view?.results ?? [];
  const shown = results.filter(m => inLens(m, lens));
  const incomplete = view?.ran === true && view.complete === false;

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
          autoComplete="off"
          placeholder="Name, phone, Practice ID, hospital number, national ID, passport or email"
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-[14px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10"
        />
        <button type="button" onClick={() => void run(q)} disabled={busy || q.trim().length < 2}
          className="shrink-0 rounded-lg bg-[var(--cp-primary)] px-4 py-2 text-[14px] font-semibold text-white disabled:opacity-40">
          {busy ? "Searching…" : "Search"}
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {LENSES.map(l => (
          <button key={l.key} type="button" onClick={() => setLens(l.key)} aria-pressed={lens === l.key}
            className={`rounded-lg border px-2.5 py-1 text-[12px] font-semibold ${lens === l.key
              ? "border-[var(--cp-primary)] bg-[var(--cp-primary)]/5 text-[var(--cp-primary-deep)]"
              : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
            {l.label}
          </button>
        ))}
        <span className="ml-1 text-[11px] text-gray-400">
          Every search looks everywhere &mdash; these only narrow what is shown.
        </span>
      </div>

      {failed && (
        <p className="mt-3 rounded-lg bg-[var(--cmp-surface-critical)] px-3 py-2 text-[12px] text-[var(--cmp-text-critical)]">
          {failed} Do not register a new record on the strength of an answer nobody got.
        </p>
      )}

      {view?.unavailable && view.reason === "capability" && (
        <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-[12px] text-gray-600">
          Checking for an existing record needs patient.view as well as patient.list, and your role does
          not carry it. The server still checks for duplicates when you submit.
        </p>
      )}

      {incomplete && (
        <p className="mt-3 rounded-lg bg-[var(--cmp-surface-warning)] px-3 py-2 text-[12px] text-[var(--cmp-text-warning)]">
          <span className="font-semibold">Part of this check did not answer.</span> Whatever it shows,
          it is not evidence that this person is absent from the register.
        </p>
      )}

      {view?.ran && !view.unavailable && (
        <div className="mt-3">
          <p className="text-[12px] font-semibold text-gray-600">
            {shown.length === 0
              ? results.length === 0
                ? (view.complete ? "Nobody matches." : "Nothing matched in what could be searched.")
                : `Nothing matched that way — ${results.length} matched another way.`
              : `${shown.length} possible match${shown.length === 1 ? "" : "es"}`}
          </p>
          {shown.length > 0 && (
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {shown.map(m => (
                <li key={m.patientId}>
                  <Link href={`/practice/patients/${m.patientId}`}
                    className="flex flex-wrap items-baseline gap-2 rounded-lg border border-gray-100 px-3 py-2 transition hover:border-[var(--cp-primary)]">
                    <span className="text-[14px] font-semibold text-gray-900">{m.displayName}</span>
                    {(m.patientNumber ?? m.practiceId) && <span className="font-mono text-[12px] text-gray-500">{m.patientNumber ?? m.practiceId}</span>}
                    {m.hospitalNumbers.map(h => (
                      <span key={h.id} className="rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-[11px] text-emerald-800">{h.value}</span>
                    ))}
                    {m.birthDate && <span className="text-[12px] text-gray-400">b. {m.birthDate}</span>}
                    <span className="ml-auto rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-semibold text-gray-500">
                      {matchLabel(m)}
                    </span>
                    {m.matchedVia === "guardian" && m.matchedGuardian && (
                      <span className="w-full text-[11px] text-gray-500">
                        Found through {m.matchedGuardian.name} ({m.matchedGuardian.relationshipLabel}).
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {results.length === 0 && view.complete && canCreate && (
            <p className="mt-2 text-[12px] text-gray-500">
              Nobody on the register matches &mdash; the form below is the right next step.
            </p>
          )}
        </div>
      )}

      {/* THE COMP'S "SCAN ID" BUTTON, in its designed position and honest about itself. */}
      <p className="mt-3 border-t border-gray-100 pt-2 text-[11px] text-gray-400">
        There is no &ldquo;Scan ID&rdquo; button here yet. Reading a national ID or a passport needs a camera and a document parser, neither of
        which exists yet &mdash; and every number a scan would produce is already searchable by typing it.
      </p>
    </section>
  );
}
