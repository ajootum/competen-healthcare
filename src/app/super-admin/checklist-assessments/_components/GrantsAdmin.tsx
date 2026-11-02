"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useModalFocus } from "@/components/ui/use-modal-focus";
import { Btn, Chip, fieldBase, mutedText, type Tone } from "@/components/assessment/ui";
import { GRANT_STATE_LABEL, type GrantState } from "@/lib/assessment/assessor/common";
import type { AssessableInstrument, GrantView, PersonMatch, RespondentCandidate } from "@/lib/assessment/assessor/grants";

const API = "/api/hq/checklist-assessments/grants";
const TONE: Record<GrantState, Tone> = { live: "success", pending: "warning", not_yet: "info", ended: "neutral", expired: "neutral" };
const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");
const card = "rounded-xl border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] p-4";

async function call<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, init);
    const b = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, data: b as T } : { ok: false, error: b.error ?? "That did not work." };
  } catch { return { ok: false, error: "There is no connection. Try again." }; }
}

export function GrantsAdmin({ initialGrants, instruments }: { initialGrants: GrantView[]; instruments: AssessableInstrument[] }) {
  const router = useRouter();
  const [instrumentId, setInstrumentId] = useState(instruments[0]?.instrument_id ?? "");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState<PersonMatch | null>(null);
  const [candidates, setCandidates] = useState<RespondentCandidate[] | null>(null);
  const [respondent, setRespondent] = useState("");
  const [reason, setReason] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [ending, setEnding] = useState<{ id: string; reason: string } | null>(null);
  const endPanel = useRef<HTMLDivElement>(null);
  // The end-grant dialog: focus in, Tab trapped, Escape cancels, focus back on the End button.
  useModalFocus(ending !== null, endPanel, () => setEnding(null));

  async function findSubject() {
    setError(null); setSubject(null); setCandidates(null); setRespondent("");
    const r = await call<{ matches: (PersonMatch & { isSelf?: boolean })[] }>(`${API}/people?email=${encodeURIComponent(email.trim())}`);
    if (!r.ok) { setError(r.error); return; }
    const m = r.data.matches[0];
    if (!m) { setError("No account has that email address."); return; }
    if ((m as { isSelf?: boolean }).isSelf) { setError("You cannot give authority to assess yourself."); return; }
    setSubject(m);
    await loadRespondents(instrumentId, m.id);
  }

  async function loadRespondents(ins: string, subjectId: string) {
    if (!ins) return;
    const r = await call<RespondentCandidate[]>(`${API}/respondents?instrumentId=${ins}&subjectUserId=${subjectId}`);
    if (!r.ok) { setError(r.error); return; }
    setCandidates(r.data); setRespondent("");
  }

  async function create() {
    const pick = candidates?.find(c => c.appointment_id === respondent);
    if (!subject || !pick) return;
    setBusy(true); setError(null); setDone(null);
    const r = await call<{ id: string }>(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      instrumentId, subjectUserId: subject.id, respondentId: pick.person_id, appointmentId: pick.appointment_id, reason, validUntil: validUntil || undefined }) });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setDone("The grant was made. It is ready once the person accepts it."); setReason(""); setValidUntil(""); setSubject(null); setEmail(""); setCandidates(null); setRespondent("");
    router.refresh();
  }

  async function end() {
    if (!ending) return;
    setBusy(true); setError(null);
    const r = await call(`${API}/${ending.id}/end`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: ending.reason }) });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setEnding(null); router.refresh();
  }

  const canCreate = !!subject && !!respondent && reason.trim().length >= 3 && !busy;
  return (
    <div className="space-y-6">
      <section aria-labelledby="new-h" className={`${card} space-y-3`}>
        <h2 id="new-h" className="text-base font-semibold text-[var(--cmp-app-text)]">Make a grant</h2>
        {instruments.length === 0 ? <p className={`text-sm ${mutedText}`}>No published checklist admits an assessor yet.</p> : (
          <>
            <label className={`flex flex-col gap-1 text-xs font-semibold ${mutedText}`}>
              <span>Checklist</span>
              <select value={instrumentId} onChange={e => { setInstrumentId(e.target.value); if (subject) void loadRespondents(e.target.value, subject.id); }} className={fieldBase}>
                {instruments.map(i => <option key={i.instrument_id} value={i.instrument_id}>{i.code}, {i.name} (version {i.version_no})</option>)}
              </select>
            </label>
            <div className="flex flex-wrap items-end gap-2">
              <label className={`flex min-w-[16rem] flex-1 flex-col gap-1 text-xs font-semibold ${mutedText}`}>
                <span>Email of the person to be assessed</span>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={fieldBase} autoComplete="off" />
              </label>
              <Btn onClick={findSubject} disabled={!email.trim()}>Find the person</Btn>
            </div>
            {subject ? <p className="text-sm text-[var(--cmp-app-text)]">Person: <span className="font-semibold">{subject.name ?? "Unnamed"}</span> <span className={mutedText}>({subject.email})</span></p> : null}
            {subject && candidates ? (
              candidates.length === 0 ? <p className="text-sm text-[var(--cmp-text-warning)]">No one currently holds the authority to assess with this checklist.</p> : (
                <label className={`flex flex-col gap-1 text-xs font-semibold ${mutedText}`}>
                  <span>Assessor (holds the assess capability by appointment)</span>
                  <select value={respondent} onChange={e => setRespondent(e.target.value)} className={fieldBase}>
                    <option value="">Choose an assessor</option>
                    {candidates.map(c => <option key={c.appointment_id} value={c.appointment_id}>{c.name ?? "Unnamed"}, {c.position.replace(/_/g, " ")}</option>)}
                  </select>
                </label>
              )
            ) : null}
            <label className={`flex flex-col gap-1 text-xs font-semibold ${mutedText}`}>
              <span>Reason (kept with the grant)</span>
              <textarea rows={2} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} className={fieldBase} />
            </label>
            <label className={`flex max-w-xs flex-col gap-1 text-xs font-semibold ${mutedText}`}>
              <span>Ends on (optional)</span>
              <input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} className={fieldBase} />
            </label>
            <div><Btn kind="primary" onClick={create} disabled={!canCreate}>{busy ? "Working" : "Make the grant"}</Btn></div>
          </>
        )}
        {error ? <p role="alert" className="text-sm text-[var(--cmp-text-error)]">{error}</p> : null}
        {done ? <p role="status" className="text-sm text-[var(--cmp-text-success)]">{done}</p> : null}
      </section>

      <section aria-labelledby="mine-h" className="space-y-3">
        <h2 id="mine-h" className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--cmp-app-text-secondary)]">Grants you made</h2>
        {initialGrants.length === 0 ? <p className={`${card} border-dashed text-sm ${mutedText}`}>You have made no grants.</p> : initialGrants.map(g => (
          <article key={g.id} className={`${card} flex flex-wrap items-center justify-between gap-3`}>
            <div className="min-w-0 text-sm text-[var(--cmp-app-text)]">
              <p className="font-semibold">{g.instrument_name ?? "Checklist"} <span className="font-normal">for {g.subject_name ?? "a person"}</span></p>
              <p className={`text-xs ${mutedText}`}>Assessor {g.respondent_name ?? "unnamed"}. Made {fmt(g.created_at)}{g.accepted_at ? `, accepted ${fmt(g.accepted_at)}` : ""}{g.valid_until ? `, until ${fmt(g.valid_until)}` : ""}.{g.end_reason ? ` Ended: ${g.end_reason}` : ""}</p>
            </div>
            <div className="flex items-center gap-2">
              <Chip tone={TONE[g.state]}>{GRANT_STATE_LABEL[g.state]}</Chip>
              {g.state !== "ended" ? <Btn size="sm" kind="danger" onClick={() => setEnding({ id: g.id, reason: "" })}>End</Btn> : null}
            </div>
          </article>
        ))}
      </section>

      {ending ? (
        <div role="dialog" aria-modal="true" aria-labelledby="end-h" className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div ref={endPanel} tabIndex={-1} className="w-full max-w-md space-y-3 rounded-xl border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] p-5 text-[var(--cmp-app-text)]">
            <h2 id="end-h" className="text-lg font-semibold">End this grant?</h2>
            <p className={`text-sm ${mutedText}`}>The assessor can no longer start or submit under it. Assessments already submitted stay as they are. An ended grant is never reopened: make a new one instead.</p>
            <label className={`flex flex-col gap-1 text-xs font-semibold ${mutedText}`}>
              <span>Reason</span>
              <textarea rows={2} maxLength={1000} value={ending.reason} onChange={e => setEnding({ ...ending, reason: e.target.value })} className={fieldBase} />
            </label>
            {error ? <p role="alert" className="text-sm text-[var(--cmp-text-error)]">{error}</p> : null}
            <div className="flex justify-end gap-2"><Btn onClick={() => setEnding(null)}>Cancel</Btn><Btn kind="danger" onClick={end} disabled={busy || ending.reason.trim().length < 3}>End the grant</Btn></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
