"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// The write half of /super-admin/competency-requests (CCHU Competency Assessment Implementation, migration 690).
// One POST to /api/hq/competency-requests, which re-checks hq.competency.verification.request, and the database decides
// again: a real person (650), never the lead, a published and clinically approved method with pinned criteria.
//
// Choosing a person or a competency puts it in the address (?person=&competency=) so the SERVER loads the methods that
// apply and the person's renewable decisions. Nothing here decides what applies.

export type PersonOption = { id: string; label: string };
export type CompetencyOption = { id: string; label: string; group: string };
export type LevelOption = { id: string; label: string };
export type MethodChoice = { versionId: string; label: string; levels: LevelOption[] };
export type RenewalChoice = { id: string; label: string };
/** none: nothing published applies. unreadable: the methods could not be read. unavailable: 510 absent. null: no competency chosen. */
export type MethodState = { kind: "ok"; methods: MethodChoice[] } | { kind: "none" } | { kind: "unreadable" } | { kind: "unavailable" } | null;

const btn = "inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-[13px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)]";
const primary = `${btn} bg-teal-700 text-white hover:bg-teal-800`;
const input = "w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[13px] text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 pointer-coarse:min-h-[var(--cmp-touch-min)]";
const label = "block text-[12.5px] font-semibold text-gray-700";
const SHOW = 200;

export function RequestForm({ people, competencies, personId, competencyId, methodState, renewals, peopleTotal }: {
  people: PersonOption[]; competencies: CompetencyOption[]; personId: string; competencyId: string;
  methodState: MethodState; renewals: RenewalChoice[]; peopleTotal: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [person, setPerson] = useState(personId);
  const [competency, setCompetency] = useState(competencyId);
  const [personQ, setPersonQ] = useState("");
  const [compQ, setCompQ] = useState("");
  const [version, setVersion] = useState("");
  const [level, setLevel] = useState("");
  const [renews, setRenews] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const go = (p: string, c: string) => {
    const q = new URLSearchParams();
    if (p) q.set("person", p);
    if (c) q.set("competency", c);
    startTransition(() => router.replace(q.size ? `?${q}` : "?", { scroll: false }));
  };

  const personHits = useMemo(() => {
    const q = personQ.trim().toLowerCase();
    return q ? people.filter(p => p.label.toLowerCase().includes(q)) : people;
  }, [people, personQ]);
  const shownPeople = useMemo(() => {
    const cut = personHits.slice(0, SHOW);
    const chosen = people.find(p => p.id === person);
    return chosen && !cut.some(p => p.id === chosen.id) ? [chosen, ...cut] : cut;
  }, [personHits, people, person]);

  const groups = useMemo(() => {
    const q = compQ.trim().toLowerCase();
    const m = new Map<string, CompetencyOption[]>();
    for (const c of competencies) {
      if (q && !c.label.toLowerCase().includes(q) && c.id !== competency) continue;
      m.set(c.group, [...(m.get(c.group) ?? []), c]);
    }
    return [...m.entries()];
  }, [competencies, compQ, competency]);

  const methods = methodState?.kind === "ok" ? methodState.methods : [];
  const method = methods.find(m => m.versionId === version) ?? (methods.length === 1 ? methods[0] : null);
  const levels = method?.levels ?? [];
  const ready = !!person && !!competency && !!method && !pending;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!method) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/hq/competency-requests", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request_for", userId: person, competencyId: competency, methodVersionId: method.versionId,
          targetLevelId: level || undefined, note: note.trim() || undefined, renewsDecisionId: renews || undefined }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: j?.error ?? "That could not be saved. Nothing has changed." }); return; }
      setMsg({ ok: true, text: "Asked. The person has been told, and can now add their evidence or withdraw the request." });
      setNote(""); setLevel(""); setRenews(""); setVersion("");
      router.refresh();
    } catch { setMsg({ ok: false, text: "That could not be saved. Check your connection." }); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="space-y-4" aria-busy={pending || busy}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="rq-person-q" className={label}>Find the person</label>
          <input id="rq-person-q" type="search" value={personQ} onChange={e => setPersonQ(e.target.value)} className={input} placeholder="Name or email" autoComplete="off" />
          <label htmlFor="rq-person" className={label}>Person to be assessed</label>
          <select id="rq-person" required value={person} onChange={e => { setPerson(e.target.value); setRenews(""); go(e.target.value, competency); }} className={input}>
            <option value="">Choose a person</option>
            {shownPeople.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <p className="text-[12px] text-gray-600">
            {people.length === 0 ? "No account is confirmed as a real person yet." : personHits.length > SHOW ? `Showing the first ${SHOW} of ${personHits.length}. Type to narrow the list.` : `${personHits.length} real ${personHits.length === 1 ? "person" : "people"}.`}
            {peopleTotal > people.length ? " Accounts not confirmed as a real person are not listed." : ""}
          </p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="rq-comp-q" className={label}>Find the competency</label>
          <input id="rq-comp-q" type="search" value={compQ} onChange={e => setCompQ(e.target.value)} className={input} placeholder="Code or name" autoComplete="off" />
          <label htmlFor="rq-comp" className={label}>Competency</label>
          <select id="rq-comp" required value={competency} onChange={e => { setCompetency(e.target.value); setVersion(""); setLevel(""); setRenews(""); go(person, e.target.value); }} className={input}>
            <option value="">Choose a competency</option>
            {groups.map(([g, list]) => <optgroup key={g} label={g}>{list.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</optgroup>)}
          </select>
          <p className="text-[12px] text-gray-600">From published frameworks.</p>
        </div>
      </div>

      {competency && (
        <div className="space-y-1.5" aria-live="polite">
          <label htmlFor="rq-method" className={label}>Assessment method</label>
          {pending ? <p className="text-[13px] text-gray-600">Looking for methods.</p>
            : methodState?.kind === "ok" ? (
              <select id="rq-method" required value={method?.versionId ?? ""} onChange={e => { setVersion(e.target.value); setLevel(""); }} className={input}>
                {methods.length > 1 && <option value="">Choose a method</option>}
                {methods.map(m => <option key={m.versionId} value={m.versionId}>{m.label}</option>)}
              </select>
            ) : methodState?.kind === "none" ? <p className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-2.5 text-[13px] text-gray-800">No clinically approved assessment method is published for this competency yet.</p>
            : methodState?.kind === "unavailable" ? <p className="text-[13px] text-gray-700">Competency verification is not set up on this environment yet.</p>
            : <p role="alert" className="text-[13px] text-red-700">The methods could not be read just now. Try again.</p>}
        </div>
      )}

      {method && (
        <div className="grid gap-4 sm:grid-cols-2">
          {levels.length > 0 && (
            <div>
              <label htmlFor="rq-level" className={label}>Level to assess (optional)</label>
              <select id="rq-level" value={level} onChange={e => setLevel(e.target.value)} className={input}>
                <option value="">The assessor decides</option>
                {levels.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
            </div>
          )}
          {renewals.length > 0 && (
            <div>
              <label htmlFor="rq-renews" className={label}>Renews an earlier verification (optional)</label>
              <select id="rq-renews" value={renews} onChange={e => setRenews(e.target.value)} className={input}>
                <option value="">A new assessment, not a renewal</option>
                {renewals.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </div>
          )}
          <div className="sm:col-span-2">
            <label htmlFor="rq-note" className={label}>Note for the person (optional)</label>
            <textarea id="rq-note" rows={3} maxLength={2000} value={note} onChange={e => setNote(e.target.value)} className={input} placeholder="Why this assessment, and anything they should add" />
          </div>
        </div>
      )}

      <p className="text-[12.5px] text-gray-600">The person is told, adds their own evidence and may withdraw the request. You cannot assess it: an appointed assessor decides, and nobody decides their own assessment.</p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={!ready || busy} className={primary}>{busy ? "Asking" : "Ask for the assessment"}</button>
        {msg && <p role={msg.ok ? "status" : "alert"} className={`text-[12.5px] ${msg.ok ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-critical)]"}`}>{msg.text}</p>}
      </div>
    </form>
  );
}
