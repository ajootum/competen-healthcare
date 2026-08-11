"use client";

import { useEffect, useRef, useState } from "react";
import { IDENTIFIER_LABELS } from "@/lib/practice/patient-workspace-constants";
import { MIN_PICKER_QUERY } from "@/lib/practice/encounter-start";
import { CARD } from "./Honesty";
import type { SearchMatchView, SearchView } from "./types";

// CPR-V5-006 s1 -- Universal Search, the primary workflow on this screen.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// LIVE, BUT NOT PER-KEYSTROKE.
//
// The specification asks for "live results as the user types". Every search on this box is a read of
// clinical records into a real access log (universalSearch calls logAccess, CPR-370), so firing on each
// character would write eleven rows for one surname and make the log useless for the thing it exists
// for. It fires when typing pauses, which is live in every sense a person at a desk experiences, and the
// box says so rather than leaving somebody wondering whether it is working.
//
// THE CHIPS NARROW THE ANSWER, NOT THE SEARCH. Somebody hands over a card; you do not know which KIND of
// number is on it, and a chip that restricted the query would return "nobody matches" about a patient
// standing in front of you. Every search covers everything the engine indexes -- Practice ID, hospital
// numbers, national ID, passport, insurance, name, phone, email AND the parent or guardian's phone and
// email -- and a chip only highlights which of those routes found the person.
//
// "NOBODY MATCHES" IS A CLAIM, AND IT IS ONLY MADE WHEN IT CAN BE. universalSearch reports each probe
// separately; when any of them failed or hit its cap, `complete` is false and the honest sentence is
// "nothing found in what could be searched". Those are different answers at a registration desk: the
// second one means DO NOT register a new record yet.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

const LENSES = [
  { key: "all", label: "Everything" },
  { key: "name", label: "Name" },
  { key: "identifier", label: "Any number" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "guardian", label: "Parent or guardian" },
];

// ⚠ ONE FLOOR, SHARED WITH THE ENCOUNTER PICKER THAT ALSO MOUNTS THIS BOX. Two constants would drift,
// and the sentence below prints the number -- so a box that refused at two while saying three is a
// smaller change away than it looks.
const MIN_QUERY = MIN_PICKER_QUERY;
const PAUSE_MS = 350;

function matchLabel(m: SearchMatchView): string {
  const [kind, detail] = m.matchedBy.split(":");
  if (kind === "identifier") return IDENTIFIER_LABELS[detail] ?? detail ?? "identifier";
  if (kind === "guardian_phone") return `${m.matchedGuardian?.relationshipLabel ?? "guardian"}'s phone`;
  if (kind === "guardian_email") return `${m.matchedGuardian?.relationshipLabel ?? "guardian"}'s email`;
  if (kind === "name") return "name";
  if (kind === "name_partial") return "name contains";
  return kind;
}

function inLens(m: SearchMatchView, lens: string): boolean {
  if (lens === "all") return true;
  if (lens === "guardian") return m.matchedVia === "guardian";
  if (lens === "identifier") return m.matchedBy.startsWith("identifier");
  if (lens === "name") return m.matchedBy.startsWith("name");
  return m.matchedBy === lens;
}

export default function UniversalSearch({
  initialQuery, initial, canCreate, selectedPatientId, onSelect, onRegister, onSubmitQuery,
}: {
  initialQuery: string;
  /** Server-rendered results for a linked ?q=, so a shared search opens with its answer already on it. */
  initial: SearchView | null;
  canCreate: boolean;
  selectedPatientId: string | null;
  onSelect: (patientId: string) => void;
  onRegister: () => void;
  onSubmitQuery: (q: string) => void;
}) {
  const [q, setQ] = useState(initialQuery);
  const [lens, setLens] = useState("all");
  const [view, setView] = useState<SearchView | null>(initial);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Every fetch carries a sequence number and only the newest may write. Without it a slow read of "ma"
  // can land after a fast read of "makumbi" and put the wrong patients under the right query.
  const seq = useRef(0);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function run(term: string) {
    const trimmed = term.trim();
    if (trimmed.length < MIN_QUERY) { setView(null); setFailed(null); return; }
    const mine = ++seq.current;
    setBusy(true); setFailed(null);
    try {
      const r = await fetch(`/api/v1/practice/patients/search?q=${encodeURIComponent(trimmed)}`);
      if (mine !== seq.current) return;
      if (!r.ok) {
        // A SEARCH THAT DID NOT RUN IS NOT A SEARCH THAT FOUND NOBODY -- the same rule the engine
        // applies to its own probes, applied to the transport.
        setView(null);
        setFailed(r.status === 403 ? "Your role does not allow searching the patient register."
          : `The search did not run (HTTP ${r.status}).`);
        return;
      }
      setView(await r.json() as SearchView);
    } catch (e) {
      if (mine !== seq.current) return;
      setView(null);
      setFailed(`The search did not reach the server: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (mine === seq.current) setBusy(false);
    }
  }

  function onType(v: string) {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void run(v), PAUSE_MS);
  }

  const results = view?.results ?? [];
  const shown = results.filter(m => inLens(m, lens));
  const incomplete = view?.ran === true && view.complete === false;
  const brokenProbes = Object.entries(view?.probes ?? {}).filter(([, p]) => p.unavailable || p.truncated);

  return (
    <section className={`${CARD} p-4`}>
      <form
        className="flex gap-2"
        onSubmit={e => { e.preventDefault(); if (timer.current) clearTimeout(timer.current); onSubmitQuery(q.trim()); void run(q); }}
      >
        <label className="sr-only" htmlFor="patient-universal-search">Search patients</label>
        <input
          id="patient-universal-search"
          value={q}
          onChange={e => onType(e.target.value)}
          autoComplete="off"
          placeholder="Name, Practice ID, hospital number, national ID, passport, phone, email — or a parent's phone"
          className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-[14px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10"
        />
        <button
          type="submit"
          disabled={q.trim().length < MIN_QUERY}
          className="shrink-0 rounded-lg bg-[var(--cp-primary)] px-4 py-2 text-[14px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-40"
        >
          {busy ? "Searching…" : "Search"}
        </button>
      </form>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {LENSES.map(l => (
          <button
            key={l.key}
            type="button"
            onClick={() => setLens(l.key)}
            aria-pressed={lens === l.key}
            className={`rounded-lg border px-2.5 py-1 text-[12px] font-semibold ${lens === l.key
              ? "border-[var(--cp-primary)] bg-[var(--cp-primary)]/5 text-[var(--cp-primary-deep)]"
              : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}
          >
            {l.label}
          </button>
        ))}
        <span className="ml-1 text-[11px] text-gray-400">
          Every search looks everywhere &mdash; these only narrow what is shown. Results appear when you stop typing.
        </span>
      </div>

      {/* ⚠ A BOX THAT REFUSES SILENTLY LOOKS LIKE A BOX THAT IS STILL THINKING. Below the floor nothing
          is sent -- no read, no access-log row -- and until now nothing said so either: somebody who
          typed one character and waited was waiting for a search that was never going to happen. The
          number is printed because the rule is the number. */}
      {q.trim().length > 0 && q.trim().length < MIN_QUERY && (
        <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-[12px] text-gray-600">
          <span className="font-semibold">Nothing has been searched yet.</span> A search needs at least{" "}
          {MIN_QUERY} characters, so this one was not sent &mdash; a single character matches a large
          part of the register rather than a patient. Nothing here is a statement about who is registered.
        </p>
      )}

      {failed && (
        <p className="mt-3 rounded-lg bg-[var(--cmp-surface-critical)] px-3 py-2 text-[12px] text-[var(--cmp-text-critical)]">
          {failed}
        </p>
      )}

      {view?.unavailable && view.reason === "capability" && (
        <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-[12px] text-gray-600">
          <span className="font-semibold">Not shown to you.</span> Searching the register needs both
          patient.list and patient.view; without the second, results would name people you may not see,
          so the search was not run at all.
        </p>
      )}

      {incomplete && (
        <p className="mt-3 rounded-lg bg-[var(--cmp-surface-warning)] px-3 py-2 text-[12px] text-[var(--cmp-text-warning)]">
          <span className="font-semibold">Part of this search did not answer.</span>{" "}
          {shown.length === 0
            ? "Nothing was found in what COULD be searched — which is not the same as nobody matching. Do not register a new record on the strength of this."
            : "There may be matches these results do not include."}
          <span className="mt-1 block font-mono text-[11px] opacity-80">
            {brokenProbes.map(([k, p]) => `${k}: ${p.error ?? (p.truncated ? "more rows than could be read" : "unavailable")}`).join(" · ")}
          </span>
        </p>
      )}

      {view?.ran && !view.unavailable && (
        <div className="mt-3">
          <p className="text-[12px] font-semibold text-gray-600">
            {shown.length === 0
              ? results.length === 0
                ? (view.complete ? "Nobody matches." : "Nothing matched in what could be searched.")
                : `Nothing matched that way — ${results.length} matched another way.`
              : `${shown.length} possible match${shown.length === 1 ? "" : "es"}${view.truncated ? ", and more than this box will show" : ""}`}
          </p>

          {shown.length > 0 && (
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {shown.map(m => (
                <li key={m.patientId}>
                  <button
                    type="button"
                    onClick={() => onSelect(m.patientId)}
                    aria-current={selectedPatientId === m.patientId}
                    className={`flex w-full flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg border px-3 py-2 text-left transition ${selectedPatientId === m.patientId
                      ? "border-[var(--cp-primary)] bg-[var(--cp-primary)]/5"
                      : "border-gray-100 hover:border-[var(--cp-primary)]"}`}
                  >
                    <span className="text-[14px] font-semibold text-gray-900">{m.displayName}</span>
                    {(m.patientNumber ?? m.practiceId) && <span className="font-mono text-[12px] text-gray-500">{m.patientNumber ?? m.practiceId}</span>}
                    {/* HOSPITAL NUMBERS BESIDE THE NAME, not hidden in demographics -- s1's own words. */}
                    {m.hospitalNumbers.map(h => (
                      <span key={h.id} className="rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-[11px] text-emerald-800">
                        {h.value}{h.facilityName ? ` · ${h.facilityName}` : ""}
                      </span>
                    ))}
                    <span className="text-[12px] text-gray-400">
                      {m.age ? m.age.label : m.ageEstimateYears != null ? `about ${m.ageEstimateYears} years (estimated)` : "age not recorded"}
                      {m.sex && m.sex !== "unspecified" ? ` · ${m.sex}` : ""}
                    </span>
                    {m.status !== "active" && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">{m.status}</span>
                    )}
                    <span className="ml-auto rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-semibold text-gray-500">
                      {matchLabel(m)}
                    </span>
                    {m.matchedVia === "guardian" && m.matchedGuardian && (
                      <span className="w-full text-[11px] text-gray-500">
                        Found through {m.matchedGuardian.name} ({m.matchedGuardian.relationshipLabel}) &mdash;
                        the number belongs to them, not to this patient.
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {results.length === 0 && view.complete && canCreate && (
            <button
              type="button"
              onClick={onRegister}
              className="mt-2 rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-[var(--cp-primary-deep)]"
            >
              Register {q.trim() ? `“${q.trim()}”` : "a new patient"}
            </button>
          )}
        </div>
      )}

      <p className="mt-3 border-t border-gray-100 pt-2 text-[11px] text-gray-400">
        Searched: {(view?.searchedBy ?? [
          "Practice ID", "Hospital numbers", "National ID", "Passport", "Insurance", "Name",
          "Phone", "Email", "Parent/guardian phone", "Parent/guardian email",
        ]).join(" · ")}.{" "}
        {/* THE SPEC MARKS BARCODE AND QR SCANNING AS FUTURE. It is said here, in the place the control
            would sit, rather than rendered as a button that does nothing. */}
        Barcode and QR scanning are marked future in the specification and are not built &mdash; every
        number a scan would read can be typed into this box.
      </p>
    </section>
  );
}
