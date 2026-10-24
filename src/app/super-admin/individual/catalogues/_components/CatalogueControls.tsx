"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// The write half of /super-admin/individual/catalogues (migration 394). Every control posts to
// /api/hq/individual/catalogues, which re-checks the capability, that the catalogue is shared, and the
// content-status rule. The 394 trigger refuses any change once the catalogue leaves draft.

const btn = "inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-[13px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)]";
const primary = `${btn} bg-teal-700 text-white hover:bg-teal-800`;
const ghost = `${btn} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`;
const input = "rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[13px] text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 pointer-coarse:min-h-[var(--cmp-touch-min)]";

function useSend(catalogueId: string) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function send(body: Record<string, unknown>, done: (j: Record<string, unknown>) => string) {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/hq/individual/catalogues", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ catalogueId, ...body }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: j?.error ?? "That could not be saved. Nothing has changed." }); return; }
      setMsg({ ok: true, text: done(j) });
      router.refresh();
    } catch { setMsg({ ok: false, text: "That could not be saved. Check your connection." }); } finally { setBusy(false); }
  }
  return { busy, msg, send };
}

function Message({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return <p role={msg.ok ? "status" : "alert"} className={`text-[12.5px] ${msg.ok ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-critical)]"}`}>{msg.text}</p>;
}

export function EntryStatus({ catalogueId, entryId, status, note, idPrefix }: { catalogueId: string; entryId: string; status: string; note: string | null; idPrefix: string }) {
  const [s, setS] = useState(status);
  const [n, setN] = useState(note ?? "");
  const { busy, msg, send } = useSend(catalogueId);
  const changed = s !== status || n !== (note ?? "");
  return (
    <div className="flex flex-wrap items-end gap-2">
      {/* D2: approval is clinical review (migration 395), never a catalogue setting. */}
      <label className="text-[12px] text-gray-700" htmlFor={`${idPrefix}-s`}>Curation</label>
      <select id={`${idPrefix}-s`} value={s} onChange={e => setS(e.target.value)} className={input}>
        <option value="unreviewed">Not clinically reviewed</option>
        <option value="draft">Draft content</option>
      </select>
      <label className="sr-only" htmlFor={`${idPrefix}-n`}>Note</label>
      <input id={`${idPrefix}-n`} value={n} onChange={e => setN(e.target.value)} maxLength={500} className={`${input} min-w-[14rem]`} placeholder="Note (optional)" />
      <button type="button" disabled={busy || !changed} className={ghost} onClick={() => send({ action: "status", entryId, status: s, note: n }, () => "Saved.")}>Save</button>
      <button type="button" disabled={busy} className={ghost} onClick={() => send({ action: "remove", entryId }, () => "Removed from the catalogue.")}>Remove</button>
      <Message msg={msg} />
    </div>
  );
}

/** D2: put this entry's current content forward for independent clinical review. Separate from publication. */
export function RequestReview({ catalogueId, entryId }: { catalogueId: string; entryId: string }) {
  const { busy, msg, send } = useSend(catalogueId);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" disabled={busy} className={ghost}
        onClick={() => send({ action: "review", entryId }, () => "Put forward for clinical review. You cannot review it yourself.")}>Request clinical review</button>
      <Message msg={msg} />
    </span>
  );
}

export function AddEntries({ catalogueId, options }: { catalogueId: string; options: { id: string; label: string }[] }) {
  const [pick, setPick] = useState<Set<string>>(new Set());
  const { busy, msg, send } = useSend(catalogueId);
  if (!options.length) return <p className="text-[13px] text-gray-600">Nothing to add here: every competency listed is already in the catalogue.</p>;
  return (
    <div className="space-y-2">
      <fieldset className="max-h-80 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-3">
        <legend className="px-1 text-[12px] font-semibold text-gray-700">Existing competencies (referenced, never copied)</legend>
        {options.map(o => (
          <label key={o.id} className="flex items-start gap-2 text-[13px] text-gray-800">
            <input type="checkbox" className="mt-0.5" checked={pick.has(o.id)}
              onChange={e => setPick(p => { const q = new Set(p); if (e.target.checked) q.add(o.id); else q.delete(o.id); return q; })} />
            <span>{o.label}</span>
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy || !pick.size} className={primary}
          onClick={() => send({ action: "add", competencyIds: [...pick] }, j => { setPick(new Set()); return `${j.added ?? 0} added, each marked not clinically reviewed.`; })}>
          Add {pick.size || ""} to the catalogue
        </button>
        <Message msg={msg} />
      </div>
    </div>
  );
}
