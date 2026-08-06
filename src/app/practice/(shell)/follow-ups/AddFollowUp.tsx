"use client";

import { useEffect, useState } from "react";
import { FOLLOW_UP_KINDS, FOLLOW_UP_PRIORITIES } from "@/lib/practice/follow-up-constants";
import { BUTTON } from "@/lib/practice/palette";

// CPR-FUP-001 s6/s7 -- "Optional source: Manual follow-up for non-encounter commitments", with
// "editable fields limited to due date, priority, status, assignee (future), and a short operational
// note."
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE SOURCE IS NOT A FIELD ON THIS FORM, AND THAT IS DELIBERATE. Everything raised here is MANUAL by
// definition -- there is no encounter, document or investigation behind it, because if there were, the
// obligation would have been raised from that screen. Offering a source dropdown would let somebody
// file a commitment as "investigation" with no investigation behind it, and the column would stop
// answering the one question it exists for. The engine refuses that claim; this form never makes it.
//
// ASSIGNEE IS NOT HERE EITHER. s7 lists it as future, and this build has no per-follow-up assignment --
// a disabled field promising one would be a promise in a form.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

type Patient = { id: string; displayName?: string; display_name?: string };
const nameOf = (p: Patient) => p.displayName ?? p.display_name ?? "(unnamed)";

export default function AddFollowUp({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [patients, setPatients] = useState<Patient[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [incomplete, setIncomplete] = useState<string | null>(null);
  const [patientId, setPatientId] = useState("");
  const [patientName, setPatientName] = useState("");
  const [reason, setReason] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [kind, setKind] = useState("review");
  const [priority, setPriority] = useState("routine");
  const [asDraft, setAsDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A SEARCH, NOT A DROPDOWN OF EVERY PATIENT. The registry endpoint answers a query and returns nothing
  // for an empty one, which is the right shape for a practice with four thousand records.
  useEffect(() => {
    let live = true;
    // Every state change happens INSIDE the timer callback, never in the effect body: a synchronous
    // setState here is a cascading render, and the lint rule is right about it.
    const timer = setTimeout(() => {
      if (!live) return;
      const q = query.trim();
      if (q.length < 2) { setPatients([]); setIncomplete(null); setSearching(false); return; }
      setSearching(true);
      fetch(`/api/v1/practice/patients?q=${encodeURIComponent(q)}`)
        .then(r => r.json())
        .then(d => {
          if (!live) return;
          setPatients((d?.results ?? []) as Patient[]);
          // ⚠ `complete: false` MEANS THE EMPTY RESULT IS NOT AN ANSWER. One of the registry's probes was
          // refused, so "no patient matches" would be a claim this screen has no basis for -- and acting
          // on it is how a duplicate record gets made.
          setIncomplete(d?.complete === false ? (d?.incompleteDetail ?? "one of the registry probes did not run") : null);
          setSearching(false);
        })
        .catch(e => { if (live) { setLoadError(String(e)); setSearching(false); } });
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [query]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const res = await fetch("/api/v1/practice/follow-ups", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        patientId, reason, dueOn, kind, priority,
        source: "manual", originWorkspace: "follow_ups",
        status: asDraft ? "DRAFT" : undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data?.error?.message ?? data?.error ?? "That did not work."); setBusy(false); return; }
    window.location.reload();
  }

  const field = "w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";

  return (
    <form onSubmit={submit} className="rounded-2xl border border-[var(--cp-primary)]/25 bg-[var(--cp-primary)]/[0.04] p-4">
      <h2 className="text-[13px] font-bold text-gray-900">Add a manual follow-up</h2>
      <p className="mt-0.5 max-w-3xl text-[11.5px] leading-relaxed text-gray-500">
        For a commitment with no consultation behind it &mdash; a call to make, a letter to chase. Anything
        arising from a consultation should be raised from that consultation instead, so it carries the
        encounter with it. Nothing clinical is recorded here.
      </p>

      {loadError && (
        <p className="mt-2 rounded-lg bg-[var(--cmp-surface-warning)] px-2.5 py-1.5 text-[12px] text-[var(--cmp-text-warning)]">
          The patient search could not be reached, so this form cannot be completed. It is not that there
          are no patients. <span className="font-mono text-[11px] opacity-80">{loadError}</span>
        </p>
      )}
      {incomplete && (
        <p className="mt-2 rounded-lg bg-[var(--cmp-surface-warning)] px-2.5 py-1.5 text-[12px] text-[var(--cmp-text-warning)]">
          <span className="font-semibold">This search is incomplete.</span> One of the registry&rsquo;s
          probes did not run, so an absent name here does not mean the patient is not registered.
          <span className="mt-0.5 block font-mono text-[11px] opacity-80">{incomplete}</span>
        </p>
      )}

      <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
        <div className="flex flex-col gap-0.5 lg:col-span-1">
          <span className="text-[11px] font-semibold text-gray-600">Patient</span>
          {patientId ? (
            <div className="flex items-center gap-2 rounded-lg border border-[var(--cp-primary)]/30 bg-white px-2.5 py-1.5">
              <span className="truncate text-[13px] font-semibold text-gray-800">{patientName}</span>
              <button type="button" onClick={() => { setPatientId(""); setPatientName(""); setQuery(""); }}
                className="ml-auto text-[11px] font-semibold text-gray-500 hover:text-gray-800">change</button>
            </div>
          ) : (
            <>
              <input value={query} onChange={e => setQuery(e.target.value)} className={field}
                placeholder="Search by name, phone or ID" />
              {query.trim().length >= 2 && (
                <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-gray-200 bg-white">
                  {searching && <p className="px-2 py-1.5 text-[11.5px] text-gray-400">Searching&hellip;</p>}
                  {!searching && patients.length === 0 && (
                    <p className="px-2 py-1.5 text-[11.5px] text-gray-400">
                      {incomplete ? "Nothing came back, and the search was incomplete." : "No patient matches that."}
                    </p>
                  )}
                  {patients.map(p => (
                    <button key={p.id} type="button"
                      onClick={() => { setPatientId(p.id); setPatientName(nameOf(p)); }}
                      className="block w-full px-2 py-1.5 text-left text-[12.5px] text-gray-700 hover:bg-gray-50">
                      {nameOf(p)}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <label className="flex flex-col gap-0.5 lg:col-span-2">
          <span className="text-[11px] font-semibold text-gray-600">What is it for</span>
          <input required value={reason} onChange={e => setReason(e.target.value)} className={field}
            placeholder="Ring the family about the audiology appointment" />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] font-semibold text-gray-600">Due date</span>
          <input required type="date" value={dueOn} onChange={e => setDueOn(e.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] font-semibold text-gray-600">Type</span>
          <select value={kind} onChange={e => setKind(e.target.value)} className={field}>
            {FOLLOW_UP_KINDS.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] font-semibold text-gray-600">Priority</span>
          <select value={priority} onChange={e => setPriority(e.target.value)} className={field}>
            {FOLLOW_UP_PRIORITIES.map(p => <option key={p} value={p} className="capitalize">{p}</option>)}
          </select>
        </label>
      </div>

      <label className="mt-2 flex items-center gap-2">
        <input type="checkbox" checked={asDraft} onChange={e => setAsDraft(e.target.checked)} />
        <span className="text-[12px] text-gray-600">
          Save as a draft &mdash; composed, and owed by nobody yet. Drafts appear in the Drafts tab and on
          no board.
        </span>
      </label>

      {error && <p className="mt-2 text-[12px] text-[var(--cmp-text-critical)]">{error}</p>}

      <div className="mt-3 flex gap-2">
        <button type="submit" disabled={busy || !patientId}
          className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ${BUTTON.primary}`}>
          {asDraft ? "Save draft" : "Add follow-up"}
        </button>
        <button type="button" onClick={onClose}
          className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ${BUTTON.quiet}`}>
          Cancel
        </button>
      </div>
    </form>
  );
}
