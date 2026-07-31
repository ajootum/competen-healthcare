"use client";
import { useState } from "react";
import { Badge } from "@/components/ui/primitives";

// UMW-TLS-005 client. Every control is disabled when policy locks it, and the reason is shown next to it —
// a control that silently refuses to save would be worse than no control.
/* eslint-disable @typescript-eslint/no-explicit-any */

const SOURCE: Record<string, { label: string; tone: any }> = {
  user: { label: "Yours", tone: "primary" },
  policy: { label: "Inherited", tone: "info" },
  default: { label: "Default", tone: "neutral" },
};

export default function PersonalisationForm({ groups, provisioned }: { groups: any[]; provisioned: boolean }) {
  const [state, setState] = useState<Record<string, any>>(
    Object.fromEntries(groups.flatMap(g => g.items).map((i: any) => [i.key, i.value])),
  );
  const [source, setSource] = useState<Record<string, string>>(
    Object.fromEntries(groups.flatMap(g => g.items).map((i: any) => [i.key, i.source])),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const save = async (key: string, value: any) => {
    setBusy(key); setMsg(null);
    const prev = state[key];
    setState(s => ({ ...s, [key]: value }));
    try {
      const res = await fetch("/api/personalisation/preferences", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences: { [key]: value } }),
      });
      const json = await res.json();
      if (!res.ok) { setState(s => ({ ...s, [key]: prev })); setMsg({ tone: "err", text: json.error ?? "Could not save." }); }
      else { setSource(s => ({ ...s, [key]: "user" })); setMsg({ tone: "ok", text: "Saved. This applies wherever you sign in." }); }
    } catch {
      setState(s => ({ ...s, [key]: prev })); setMsg({ tone: "err", text: "Could not reach the server." });
    } finally { setBusy(null); }
  };

  const reset = async (key: string) => {
    setBusy(key); setMsg(null);
    try {
      const res = await fetch("/api/personalisation/preferences", {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }),
      });
      const json = await res.json();
      if (!res.ok) setMsg({ tone: "err", text: json.error ?? "Could not reset." });
      else { setState(s => ({ ...s, [key]: json.value })); setSource(s => ({ ...s, [key]: "policy" })); setMsg({ tone: "ok", text: "Reset to the inherited value." }); }
    } catch { setMsg({ tone: "err", text: "Could not reach the server." }); }
    finally { setBusy(null); }
  };

  return (
    <div className="space-y-4">
      {msg && (
        <p role="status" aria-live="polite" className="text-sm rounded-lg px-3 py-2"
          style={{ background: msg.tone === "ok" ? "var(--cmp-surface-success)" : "var(--cmp-surface-critical)",
                   color: msg.tone === "ok" ? "var(--cmp-text-success)" : "var(--cmp-text-critical)" }}>
          {msg.text}
        </p>
      )}

      {groups.map((g: any) => (
        <div key={g.key} className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">{g.label}</h2>
          <div className="space-y-3.5">
            {g.items.map((i: any) => {
              const id = `pref-${i.key}`;
              const src = SOURCE[source[i.key]] ?? SOURCE.default;
              return (
                <div key={i.key} className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-50 last:border-0 pb-3 last:pb-0">
                  <div className="min-w-[220px] flex-1">
                    <label htmlFor={id} className="text-sm font-medium text-gray-900">{i.def.label}</label>
                    <p className="text-[11px] text-gray-500">{i.def.blurb}</p>
                    {!i.editable && (
                      <p className="text-[11px] mt-0.5" style={{ color: "var(--cmp-text-warning)" }}>
                        Set by your {i.lockedBy} and cannot be changed here.{i.note ? ` ${i.note}` : ""}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {i.def.type === "boolean" ? (
                      <input id={id} type="checkbox" className="h-4 w-4 accent-teal-600" disabled={!provisioned || !i.editable || busy === i.key}
                        checked={state[i.key] === true} onChange={e => save(i.key, e.target.checked)} />
                    ) : i.def.type === "enum" ? (
                      <select id={id} className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white disabled:bg-gray-50 disabled:text-gray-400"
                        disabled={!provisioned || !i.editable || busy === i.key}
                        value={String(state[i.key] ?? "")} onChange={e => save(i.key, e.target.value)}>
                        {i.def.options.map((o: string) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input id={id} type="text" className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 w-48 disabled:bg-gray-50 disabled:text-gray-400"
                        disabled={!provisioned || !i.editable || busy === i.key}
                        defaultValue={String(state[i.key] ?? "")}
                        onBlur={e => e.target.value !== String(state[i.key] ?? "") && save(i.key, e.target.value)} />
                    )}
                    <Badge tone={src.tone}>{src.label}</Badge>
                    {provisioned && i.editable && source[i.key] === "user" && (
                      <button onClick={() => reset(i.key)} disabled={busy === i.key}
                        className="text-[11px] text-gray-500 hover:text-gray-900 underline underline-offset-2">Reset</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
