"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// The write half of /super-admin/individual/configuration (COMPETEN-CONFIG-002). Every control posts to
// /api/hq/individual/config, which re-checks the capability and the hard limit itself: the min/max on
// these inputs are a convenience, not the control.

const btn = "inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-[13px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)]";
const primary = `${btn} bg-teal-700 text-white hover:bg-teal-800`;
const ghost = `${btn} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`;

function useSend() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function send(body: Record<string, unknown>, done: string) {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/hq/individual/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
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

export function IntDraft({ policyKey, label, unit, min, max, draft, hasOverride }: {
  policyKey: string; label: string; unit: string; min: number; max: number; draft: number; hasOverride: boolean;
}) {
  const [v, setV] = useState(String(draft));
  const { busy, msg, send } = useSend();
  const id = `p-${policyKey}`;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[12.5px] font-semibold text-gray-700">Draft value ({unit})</label>
      <div className="flex flex-wrap items-center gap-2">
        <input id={id} type="number" inputMode="numeric" min={min} max={max} step={1} value={v} onChange={e => setV(e.target.value)}
          aria-describedby={`${id}-limit`} className="w-28 rounded-lg border border-gray-300 px-2.5 py-1.5 text-[14px] pointer-coarse:min-h-[var(--cmp-touch-min)]" />
        <button type="button" className={primary} disabled={busy} onClick={() => send({ action: "set", key: policyKey, value: v }, `Draft saved. Publish to make it effective.`)}>Save draft</button>
        {hasOverride && <button type="button" className={ghost} disabled={busy} onClick={() => send({ action: "reset", key: policyKey }, "Removed. The default applies now, and the change is in the history.")}>Use default now</button>}
      </div>
      <p id={`${id}-limit`} className="text-[12px] text-gray-500">{label}: {min} to {max} {unit}. That range is fixed.</p>
      <Message msg={msg} />
    </div>
  );
}

export function SetDraft({ policyKey, options, draft, hasOverride, legend = "Draft: offered kinds" }: {
  policyKey: string; options: { value: string; label: string }[]; draft: string[]; hasOverride: boolean; legend?: string;
}) {
  const [on, setOn] = useState<Set<string>>(new Set(draft));
  const { busy, msg, send } = useSend();
  const toggle = (v: string) => setOn(s => { const n = new Set(s); if (n.has(v)) n.delete(v); else n.add(v); return n; });
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-[12.5px] font-semibold text-gray-700">{legend}</legend>
      {options.length === 0 && <p className="text-[13px] text-gray-600">Nothing can be chosen yet: no shared catalogue is published.</p>}
      {options.map(o => (
        <label key={o.value} className="flex items-center gap-2 text-[14px] text-gray-800 pointer-coarse:min-h-[var(--cmp-touch-min)]">
          <input type="checkbox" checked={on.has(o.value)} onChange={() => toggle(o.value)} className="h-4 w-4 rounded border-gray-400" />
          {o.label}
        </label>
      ))}
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" className={primary} disabled={busy} onClick={() => send({ action: "set", key: policyKey, value: options.map(o => o.value).filter(v => on.has(v)) }, "Draft saved. Publish to make it effective.")}>Save draft</button>
        {hasOverride && <button type="button" className={ghost} disabled={busy} onClick={() => send({ action: "reset", key: policyKey }, "Removed. The default applies now, and the change is in the history.")}>Use default now</button>}
      </div>
      <Message msg={msg} />
    </fieldset>
  );
}

/** One value from a fixed list (radio). The route refuses anything not listed. */
export function ChoiceDraft({ policyKey, options, draft, hasOverride, legend = "Draft" }: {
  policyKey: string; options: { value: string; label: string }[]; draft: string; hasOverride: boolean; legend?: string;
}) {
  const [v, setV] = useState(draft);
  const { busy, msg, send } = useSend();
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-[12.5px] font-semibold text-gray-700">{legend}</legend>
      {options.map(o => (
        <label key={o.value} className="flex items-center gap-2 text-[14px] text-gray-800 pointer-coarse:min-h-[var(--cmp-touch-min)]">
          <input type="radio" name={`${policyKey}-choice`} checked={v === o.value} onChange={() => setV(o.value)} className="h-4 w-4 border-gray-400" />
          {o.label}
        </label>
      ))}
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" className={primary} disabled={busy || v === draft} onClick={() => send({ action: "set", key: policyKey, value: v }, "Draft saved. Publish to make it effective.")}>Save draft</button>
        {hasOverride && <button type="button" className={ghost} disabled={busy} onClick={() => send({ action: "reset", key: policyKey }, "Removed. The default applies now, and the change is in the history.")}>Use default now</button>}
      </div>
      <Message msg={msg} />
    </fieldset>
  );
}

export function PublishBar({ pending }: { pending: number }) {
  const [note, setNote] = useState("");
  const { busy, msg, send } = useSend();
  return (
    <div className="space-y-2">
      <label htmlFor="pub-note" className="block text-[12.5px] font-semibold text-gray-700">Why this change (recorded with the version)</label>
      <textarea id="pub-note" rows={2} maxLength={500} value={note} onChange={e => setNote(e.target.value)} className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-[14px]" />
      <button type="button" className={primary} disabled={busy || pending === 0}
        onClick={() => send({ action: "publish", note }, "Published. The new values are effective now.")}>
        {pending === 0 ? "Nothing to publish" : `Publish ${pending} change${pending === 1 ? "" : "s"}`}
      </button>
      <Message msg={msg} />
    </div>
  );
}

export function RollbackButton({ versionId, when }: { versionId: string; when: string }) {
  const { busy, msg, send } = useSend();
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button type="button" className={ghost} disabled={busy}
        onClick={() => { if (window.confirm(`Restore the policy as published on ${when}? This is recorded as a new version.`)) send({ action: "rollback", versionId }, "Restored as a new version."); }}>
        Restore this version
      </button>
      <Message msg={msg} />
    </span>
  );
}
