"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState } from "react";
import { useRouter } from "next/navigation";

// Shared Handover Centre workflow actions (SSW-HC-004/005/011) over the handover API.
// CompleteButton (outgoing), AcceptButton (incoming), AnswerClarification, and SignOff
// (bulk-accept all reviewed patients with an electronic signature). Thin clients — all
// persistence + audit is server-side.
async function call(body: Record<string, unknown>, method = "POST") {
  const res = await fetch("/api/operations/handover", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error ?? "Failed"); }
}
const BTN = "text-xs font-semibold rounded-lg py-2 px-3 disabled:opacity-50";

export function CompleteButton({ patientId, patientLabel, done }: { patientId: string; patientLabel: string; done: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  if (done) return <span className={`${BTN} bg-emerald-50 text-emerald-700 cursor-default`}>✓ Completed</span>;
  return <span><button onClick={async () => { setBusy(true); setErr(null); try { await call({ action: "complete", patient_id: patientId, patient_label: patientLabel }); router.refresh(); } catch (e: any) { setErr(e.message); } setBusy(false); }} disabled={busy} className={`${BTN} bg-emerald-600 text-white`}>{busy ? "Saving…" : "Mark as Completed"}</button>{err && <span className="text-[10px] text-rose-600 ml-2">{err}</span>}</span>;
}

export function AcceptButton({ patientId, patientLabel, accepted }: { patientId: string; patientLabel: string; accepted: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  if (accepted) return <span className={`${BTN} bg-emerald-50 text-emerald-700 cursor-default`}>✓ Accepted</span>;
  return <span><button onClick={async () => { setBusy(true); setErr(null); try { await call({ action: "accept", patient_id: patientId, patient_label: patientLabel }); router.refresh(); } catch (e: any) { setErr(e.message); } setBusy(false); }} disabled={busy} className={`${BTN} bg-emerald-600 text-white`}>{busy ? "Accepting…" : "Accept Responsibility"}</button>{err && <span className="text-[10px] text-rose-600 ml-2">{err}</span>}</span>;
}

export function AnswerClarification({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return <button onClick={async () => { const a = window.prompt("Answer:", ""); if (a === null || !a.trim()) return; setBusy(true); try { await call({ action: "answer", id, answer: a }, "PATCH"); router.refresh(); } catch { /* surfaced by refresh */ } setBusy(false); }} disabled={busy} className="text-[10px] font-semibold text-emerald-700 hover:underline disabled:opacity-50">Answer</button>;
}

export function SignOff({ patientIds }: { patientIds: string[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function signoff() {
    if (!name.trim()) { setErr("Type your name to sign"); return; }
    setBusy(true); setErr(null);
    try { for (const pid of patientIds) await call({ action: "accept", patient_id: pid }); setDone(true); router.refresh(); }
    catch (e: any) { setErr(e.message); }
    setBusy(false);
  }

  if (done) return <p className="text-xs text-emerald-700 font-semibold">✓ Handover accepted &amp; signed off by {name}.</p>;
  return (
    <div className="space-y-2">
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Type your name to sign" className="w-full text-sm rounded-lg border border-gray-200 px-3 py-2 focus:border-emerald-400 focus:outline-none" />
      {err && <p className="text-[10px] text-rose-600">{err}</p>}
      <button onClick={signoff} disabled={busy || patientIds.length === 0} className="w-full text-xs font-semibold rounded-lg py-2.5 px-4 bg-emerald-600 text-white disabled:opacity-50">{busy ? "Signing…" : `✓ Accept Handover & Sign-off (${patientIds.length})`}</button>
      <p className="text-[10px] text-gray-400">By signing you confirm you have reviewed the handover and accept responsibility for the patients, tasks and clinical decisions from this point forward. Sign-offs are auditable.</p>
    </div>
  );
}
