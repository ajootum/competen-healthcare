"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// The write half of /super-admin/clinical-review and its governance page (migration 395). Each control posts
// to its route, which re-checks the capability. The 395 triggers decide every review decision and scope.

const btn = "inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-[13px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)]";
const primary = `${btn} bg-teal-700 text-white hover:bg-teal-800`;
const ghost = `${btn} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`;
const input = "rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[13px] text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 pointer-coarse:min-h-[var(--cmp-touch-min)]";

function useSend(path: string) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function send(body: Record<string, unknown>, done: string) {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: j?.error ?? "That could not be saved. Nothing has changed." }); return; }
      setMsg({ ok: true, text: done });
      router.refresh();
    } catch { setMsg({ ok: false, text: "That could not be saved. Check your connection." }); } finally { setBusy(false); }
  }
  return { busy, msg, send };
}

function Message({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return <p role={msg.ok ? "status" : "alert"} className={`text-[12.5px] ${msg.ok ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-critical)]"}`}>{msg.text}</p>;
}

export function Decide({ versionId, appointmentId, idPrefix }: { versionId: string; appointmentId: string; idPrefix: string }) {
  const [comment, setComment] = useState("");
  const { busy, msg, send } = useSend("/api/hq/clinical-review");
  return (
    <div className="space-y-2">
      <label htmlFor={`${idPrefix}-c`} className="block text-[12.5px] font-semibold text-gray-700">Your clinical review comment (required to request changes)</label>
      <textarea id={`${idPrefix}-c`} rows={2} maxLength={2000} value={comment} onChange={e => setComment(e.target.value)} className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-[14px]" />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} className={primary} onClick={() => send({ versionId, appointmentId, decision: "approved", comment }, "Approved for this exact content.")}>Approve this content</button>
        <button type="button" disabled={busy || !comment.trim()} className={ghost} onClick={() => send({ versionId, appointmentId, decision: "rejected", comment }, "Changes requested.")}>Request changes</button>
        <Message msg={msg} />
      </div>
    </div>
  );
}

export function AddScope({ appointmentId, options, idPrefix }: { appointmentId: string; options: { kind: string; ref: string; label: string }[]; idPrefix: string }) {
  const [pick, setPick] = useState("");
  const { busy, msg, send } = useSend("/api/hq/clinical-review/governance");
  const [kind, ref] = pick.split("|");
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label htmlFor={`${idPrefix}-s`} className="sr-only">Scope to add</label>
      <select id={`${idPrefix}-s`} value={pick} onChange={e => setPick(e.target.value)} className={`${input} max-w-md`}>
        <option value="">Add a scope…</option>
        {options.map(o => <option key={`${o.kind}|${o.ref}`} value={`${o.kind}|${o.ref}`}>{o.label}</option>)}
      </select>
      <button type="button" disabled={busy || !pick} className={ghost} onClick={() => send({ action: "add_scope", appointmentId, kind, ref }, "Scope added.")}>Add</button>
      <Message msg={msg} />
    </div>
  );
}

export function EndScope({ scopeId }: { scopeId: string }) {
  const { busy, msg, send } = useSend("/api/hq/clinical-review/governance");
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" disabled={busy} className={ghost} onClick={() => send({ action: "end_scope", scopeId }, "Scope ended.")}>End</button>
      <Message msg={msg} />
    </span>
  );
}

export function RequiredCounts({ standard, high }: { standard: number; high: number }) {
  const [s, setS] = useState(String(standard));
  const [h, setH] = useState(String(high));
  const [note, setNote] = useState("");
  const { busy, msg, send } = useSend("/api/hq/clinical-review/governance");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-[13px] text-gray-800">Standard content <input type="number" min={1} max={5} value={s} onChange={e => setS(e.target.value)} className={`${input} ml-1 w-20`} /></label>
        <label className="text-[13px] text-gray-800">Higher-risk content <input type="number" min={1} max={5} value={h} onChange={e => setH(e.target.value)} className={`${input} ml-1 w-20`} /></label>
      </div>
      <label className="block text-[12.5px] font-semibold text-gray-700" htmlFor="rc-note">Why this change (recorded with the version)</label>
      <textarea id="rc-note" rows={2} maxLength={500} value={note} onChange={e => setNote(e.target.value)} className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-[14px]" />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} className={primary} onClick={() => send({ action: "set_required", standard: Number(s), high: Number(h), note }, "Published. Content put forward from now on needs these counts.")}>Publish counts</button>
        <Message msg={msg} />
      </div>
    </div>
  );
}

export function FrameworkSpecialty({ frameworkId, termId, specialties, idPrefix }: { frameworkId: string; termId: string | null; specialties: { id: string; value: string }[]; idPrefix: string }) {
  const [v, setV] = useState(termId ?? "");
  const { busy, msg, send } = useSend("/api/hq/clinical-review/governance");
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <label htmlFor={`${idPrefix}-sp`} className="sr-only">Specialty</label>
      <select id={`${idPrefix}-sp`} value={v} onChange={e => setV(e.target.value)} className={input}>
        <option value="">No specialty</option>
        {specialties.map(t => <option key={t.id} value={t.id}>{t.value}</option>)}
      </select>
      <button type="button" disabled={busy || v === (termId ?? "")} className={ghost} onClick={() => send({ action: "set_specialty", frameworkId, termId: v || null }, "Saved.")}>Save</button>
      <Message msg={msg} />
    </span>
  );
}
