"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { primary, ghost, input, Message } from "@/app/super-admin/ai/fair-use/_components/FairUseControls";

// The studio's controls (C2, C3). Each posts one action to /api/hq/cases, which fixes the capability per action and
// takes the person from the session. Refusals come back in words, with the case's problems when it is not ready.

export function useCaseSend() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  async function send(body: Record<string, unknown>, done: string, after?: (j: any) => void) {
    setBusy(true); setMsg(null); setProblems([]);
    try {
      const res = await fetch("/api/hq/cases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: j?.error ?? "That could not be done. Nothing has changed." }); setProblems(Array.isArray(j?.problems) ? j.problems : []); return; }
      setMsg({ ok: true, text: done });
      if (Array.isArray(j?.problems) || Array.isArray(j?.screen)) setProblems([...(j.screen ?? []).map((s: string) => `It contains ${s}.`), ...(j.problems ?? [])]);
      after?.(j);
      router.refresh();
    } catch { setMsg({ ok: false, text: "That could not be done. Check your connection." }); } finally { setBusy(false); }
  }
  return { busy, msg, problems, send };
}

export function Problems({ items, title = "Still to do before clinical review" }: { items: string[]; title?: string }) {
  if (!items.length) return null;
  return (
    <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-950">
      <p className="font-semibold">{title} ({items.length})</p>
      <ul className="mt-1 list-disc pl-5">{items.slice(0, 40).map((p, i) => <li key={i}>{p}</li>)}</ul>
    </div>
  );
}

/** Take, release, decline or promote one candidate. */
export function CandidateActions({ id, status, mine, title }: { id: string; status: string; mine: boolean; title: string }) {
  const { busy, msg, send } = useCaseSend();
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [code, setCode] = useState("");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {status === "eligible" && <button type="button" className={primary} disabled={busy} onClick={() => send({ action: "take", candidateId: id }, "Taken into development. It is yours to promote, release or decline.")}>Take into development</button>}
        {status === "in_development" && mine && <button type="button" className={ghost} disabled={busy} onClick={() => send({ action: "release", candidateId: id }, "Released back to the queue.")}>Release</button>}
      </div>
      {status === "in_development" && mine && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); send({ action: "promote", candidateId: id, code: code.trim().toUpperCase(), title }, "Promoted: a new library draft you author.", j => j?.caseId && router.push(`/super-admin/cases/${j.caseId}`)); }}>
          <label className="text-[12.5px] text-gray-700">New case code
            <input className={`${input} ml-2 w-44`} value={code} onChange={e => setCode(e.target.value)} placeholder="CASE-RESP-002" required pattern="CASE-[A-Za-z0-9][A-Za-z0-9-]{2,40}" />
          </label>
          <button type="submit" className={primary} disabled={busy}>Promote to a library draft</button>
        </form>
      )}
      {(status === "eligible" || (status === "in_development" && mine)) && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); send({ action: "decline", candidateId: id, reason }, "Declined. Its content has been removed."); }}>
          <label className="text-[12.5px] text-gray-700">Reason
            <input className={`${input} ml-2 w-64`} value={reason} onChange={e => setReason(e.target.value)} placeholder="Too close to a published case" required minLength={2} />
          </label>
          <button type="submit" className={ghost} disabled={busy}>Decline</button>
        </form>
      )}
      <Message msg={msg} />
    </div>
  );
}

/** Create a case by hand: a code, a title, and an empty draft to fill in. */
export function CreateCase() {
  const { busy, msg, send } = useCaseSend();
  const router = useRouter();
  const [code, setCode] = useState(""), [title, setTitle] = useState("");
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); send({ action: "create", code: code.trim().toUpperCase(), title }, "Case created.", j => j?.caseId && router.push(`/super-admin/cases/${j.caseId}`)); }}>
      <label className="text-[12.5px] text-gray-700">Code<input className={`${input} ml-2 w-44`} value={code} onChange={e => setCode(e.target.value)} placeholder="CASE-SEPSIS-001" required pattern="CASE-[A-Za-z0-9][A-Za-z0-9-]{2,40}" /></label>
      <label className="text-[12.5px] text-gray-700">Title<input className={`${input} ml-2 w-72`} value={title} onChange={e => setTitle(e.target.value)} required minLength={2} maxLength={200} /></label>
      <button type="submit" className={primary} disabled={busy}>Create case</button>
      <Message msg={msg} />
    </form>
  );
}

/** Draft a case with AI, on the platform's budget. The draft is shown for reading. Nothing is saved until you create it. */
export function AiDraft({ competencies }: { competencies: { id: string; label: string }[] }) {
  const { busy, msg, problems, send } = useCaseSend();
  const router = useRouter();
  const [brief, setBrief] = useState(""), [level, setLevel] = useState("intermediate"), [risk, setRisk] = useState("standard");
  const [picked, setPicked] = useState<string[]>([]), [draft, setDraft] = useState<any>(null), [code, setCode] = useState("");
  return (
    <div className="space-y-3">
      <form className="space-y-2" onSubmit={e => { e.preventDefault(); setDraft(null); send({ action: "ai_draft", brief, level, risk, competencyIds: picked, requestKey: crypto.randomUUID() }, "AI draft ready. Read every finding before you use it.", j => setDraft(j.content)); }}>
        <label className="block text-[12.5px] text-gray-700">What should the case teach? (no patient details)
          <textarea className={`${input} mt-1 block w-full`} rows={4} value={brief} onChange={e => setBrief(e.target.value)} required minLength={20} maxLength={4000} />
        </label>
        <div className="flex flex-wrap gap-3">
          <label className="text-[12.5px] text-gray-700">Level <select className={input} value={level} onChange={e => setLevel(e.target.value)}><option value="foundation">Foundation</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></label>
          <label className="text-[12.5px] text-gray-700">Risk <select className={input} value={risk} onChange={e => setRisk(e.target.value)}><option value="standard">Standard</option><option value="high">High</option></select></label>
        </div>
        <fieldset className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 p-2"><legend className="px-1 text-[12px] text-gray-600">CFCA competencies it serves</legend>
          {competencies.map(c => <label key={c.id} className="block text-[12.5px]"><input type="checkbox" className="mr-2" checked={picked.includes(c.id)} onChange={e => setPicked(p => e.target.checked ? [...p, c.id] : p.filter(x => x !== c.id))} />{c.label}</label>)}
        </fieldset>
        <button type="submit" className={primary} disabled={busy}>Draft with AI (platform budget)</button>
      </form>
      <Message msg={msg} />
      {draft && (
        <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <p className="text-[12.5px] text-gray-700"><span className="font-semibold">AI draft, unchecked.</span> {draft.title}: {draft.facts?.length ?? 0} findings, {draft.stages?.length ?? 0} stages, {draft.decisionPoints?.length ?? 0} decisions.</p>
          <Problems items={problems} title="What the draft still needs" />
          <CreateFromDraft draft={draft} code={code} setCode={setCode} onDone={id => router.push(`/super-admin/cases/${id}`)} />
        </div>
      )}
    </div>
  );
}

function CreateFromDraft({ draft, code, setCode, onDone }: { draft: any; code: string; setCode: (s: string) => void; onDone: (caseId: string) => void }) {
  const { busy, msg, send } = useCaseSend();
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={async e => {
      e.preventDefault();
      await send({ action: "create", code: code.trim().toUpperCase(), title: draft.title ?? "Clinical case" }, "Case created with the AI draft as its first version.", async j => {
        if (!j?.versionId) return;
        await fetch("/api/hq/cases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save", versionId: j.versionId, content: draft }) });
        onDone(j.caseId);
      });
    }}>
      <label className="text-[12.5px] text-gray-700">Code<input className={`${input} ml-2 w-44`} value={code} onChange={e => setCode(e.target.value)} placeholder="CASE-SEPSIS-001" required pattern="CASE-[A-Za-z0-9][A-Za-z0-9-]{2,40}" /></label>
      <button type="submit" className={primary} disabled={busy}>Create a case from this draft</button>
      <Message msg={msg} />
    </form>
  );
}

/** Submit, delete, publish, retire, or start a new draft. */
export function VersionActions({ caseId, versionId, state, clinical, canPublish, hasDraft }: { caseId: string; versionId: string; state: string; clinical: string; canPublish: boolean; hasDraft: boolean }) {
  const { busy, msg, problems, send } = useCaseSend();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {state === "draft" && <button type="button" className={primary} disabled={busy} onClick={() => send({ action: "submit", versionId }, "Submitted for independent clinical review. The content is now frozen.")}>Submit for clinical review</button>}
        {state === "draft" && <button type="button" className={ghost} disabled={busy} onClick={() => { if (confirm("Delete this unsubmitted draft?")) send({ action: "delete_draft", versionId }, "Draft deleted."); }}>Delete draft</button>}
        {state !== "draft" && !hasDraft && <button type="button" className={ghost} disabled={busy} onClick={() => send({ action: "new_draft", caseId, kind: "revision" }, "A new draft revision was started.")}>New revision</button>}
        {state !== "draft" && !hasDraft && <button type="button" className={ghost} disabled={busy} onClick={() => send({ action: "new_draft", caseId, kind: "variation" }, "A new draft variation was started.")}>New variation</button>}
        {canPublish && clinical === "approved" && <button type="button" className={primary} disabled={busy} onClick={() => send({ action: "publish", versionId }, "Published. The previous published version is superseded.")}>Publish this approved version</button>}
      </div>
      <Message msg={msg} />
      <Problems items={problems} />
    </div>
  );
}

export function RetireCase({ caseId }: { caseId: string }) {
  const { busy, msg, send } = useCaseSend();
  return (<div><button type="button" className={ghost} disabled={busy} onClick={() => { if (confirm("Retire this case? It will no longer be offered. Its record stays.")) send({ action: "retire", caseId }, "Retired."); }}>Retire case</button><Message msg={msg} /></div>);
}

/** The case policy (s13): drafted, then published as a version through the configuration engine. */
export function CasePolicyEditor({ initial }: { initial: any }) {
  const { busy, msg, send } = useCaseSend();
  const [p, setP] = useState(initial);
  const set = (k: string, v: unknown) => setP((x: any) => ({ ...x, [k]: v }));
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-[12.5px] text-gray-700">Candidate retention (days)<input type="number" min={7} max={730} className={`${input} mt-1 block w-full`} value={p.candidateRetentionDays} onChange={e => set("candidateRetentionDays", Number(e.target.value))} /></label>
        <label className="text-[12.5px] text-gray-700">Queue opens on<select className={`${input} mt-1 block w-full`} value={p.queueWindow} onChange={e => set("queueWindow", e.target.value)}><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></select></label>
        <label className="text-[12.5px] text-gray-700">Library cases offered at most<input type="number" min={1} max={20} className={`${input} mt-1 block w-full`} value={p.offerLimit} onChange={e => set("offerLimit", Number(e.target.value))} /></label>
        <label className="text-[12.5px] text-gray-700">Permission text version<input className={`${input} mt-1 block w-full`} value={p.attestationVersion} onChange={e => set("attestationVersion", e.target.value)} /></label>
        <label className="text-[12.5px] text-gray-700"><input type="checkbox" className="mr-2" checked={p.reuseFirst} onChange={e => set("reuseFirst", e.target.checked)} />Offer a library case before generating a private one</label>
        <label className="text-[12.5px] text-gray-700"><input type="checkbox" className="mr-2" checked={p.variationsEnabled} onChange={e => set("variationsEnabled", e.target.checked)} />Deliver approved variations</label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={ghost} disabled={busy} onClick={() => send({ action: "policy_draft", policy: p }, "Draft saved. Nothing changes until it is published.")}>Save draft</button>
        <button type="button" className={primary} disabled={busy} onClick={() => send({ action: "policy_publish" }, "Published as a new configuration version.")}>Publish</button>
      </div>
      <Message msg={msg} />
    </div>
  );
}
