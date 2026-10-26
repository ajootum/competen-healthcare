"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// The write half of /super-admin/competencies/publication (migration 580). Every control posts to
// /api/hq/competency/publication, which re-checks hq.quality.competency.publish and refuses a publisher who put the
// framework forward or contributed to it. The database (466) still refuses unapproved competencies.

const PATH = "/api/hq/competency/publication";
const btn = "inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-[13px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)]";
const primary = `${btn} bg-teal-700 text-white hover:bg-teal-800`;
const ghost = `${btn} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`;
const input = "w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[13px] text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 pointer-coarse:min-h-[var(--cmp-touch-min)]";
const label = "block text-[12.5px] font-semibold text-gray-700";

function useSend() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function send(body: Record<string, unknown>, done: (j: any) => string): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: j?.error ?? "That could not be done. Nothing has changed." }); return; }
      setMsg({ ok: true, text: done(j) }); router.refresh();
    } catch { setMsg({ ok: false, text: "That could not be done. Check your connection." }); } finally { setBusy(false); }
  }
  return { busy, msg, send };
}

function Msg({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return <p role={msg.ok ? "status" : "alert"} className={`text-[12.5px] font-medium ${msg.ok ? "text-green-800" : "text-red-700"}`}>{msg.text}</p>;
}

const KINDS = [
  ["major", "Major: competencies added, removed or materially changed"],
  ["minor", "Minor: content refined, nothing removed"],
  ["revision", "Revision: corrections and wording only"],
] as const;

/** Publish or return what was put forward. A republication says what kind of change it is. */
export function Decide({ frameworkId, firstPublication, version }: { frameworkId: string; firstPublication: boolean; version: string }) {
  const { busy, msg, send } = useSend();
  const [kind, setKind] = useState("");
  const [note, setNote] = useState("");
  return (
    <form className="mt-2 space-y-2" onSubmit={e => e.preventDefault()}>
      {!firstPublication && (
        <fieldset>
          <legend className={label}>What kind of change is this? (now {version})</legend>
          {KINDS.map(([v, l]) => (
            <label key={v} className="flex items-start gap-2 text-[13px] text-gray-800">
              <input type="radio" name={`kind-${frameworkId}`} value={v} checked={kind === v} onChange={() => setKind(v)} className="mt-0.5" /> {l}
            </label>
          ))}
        </fieldset>
      )}
      <label className={label}>Note (required to return: what should change)
        <textarea className={input} rows={2} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={primary} disabled={busy || (!firstPublication && !kind)}
          onClick={() => void send({ action: "decide", frameworkId, decision: "publish", changeKind: kind || null, note }, j => `Published as version ${j.version}.${j.warning ? ` ${j.warning}` : ""}`)}>
          Publish
        </button>
        <button type="button" className={ghost} disabled={busy || !note.trim()}
          onClick={() => void send({ action: "decide", frameworkId, decision: "return", note }, () => "Returned to the author with your note.")}>
          Return to author
        </button>
        <Msg msg={msg} />
      </div>
    </form>
  );
}

/** Withdraw a published framework from use. Its versions stay on record. */
export function Archive({ frameworkId }: { frameworkId: string }) {
  const { busy, msg, send } = useSend();
  const [note, setNote] = useState("");
  return (
    <form className="mt-2 space-y-2" onSubmit={e => { e.preventDefault(); void send({ action: "archive", frameworkId, note }, () => "Archived. Scholar and Professional no longer offer it."); }}>
      <label className={label}>Why is it archived?<textarea className={input} rows={2} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} required /></label>
      <div className="flex flex-wrap items-center gap-2"><button className={ghost} disabled={busy || !note.trim()}>Archive</button><Msg msg={msg} /></div>
    </form>
  );
}

/** For the author's page: put a framework forward for publication. */
export function SubmitForPublication({ frameworkId, revision }: { frameworkId: string; revision: boolean }) {
  const { busy, msg, send } = useSend();
  const [note, setNote] = useState("");
  return (
    <form className="mt-2 space-y-2" onSubmit={e => { e.preventDefault(); void send({ action: "submit", frameworkId, note }, () => revision ? "Revision put forward. The published version stays in use until a publisher decides." : "Put forward for publication. An independent publisher decides."); }}>
      <label className={label}>Note for the publisher (optional)<textarea className={input} rows={2} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} /></label>
      <div className="flex flex-wrap items-center gap-2"><button className={ghost} disabled={busy}>{revision ? "Put this revision forward for publication" : "Put forward for publication"}</button><Msg msg={msg} /></div>
    </form>
  );
}
