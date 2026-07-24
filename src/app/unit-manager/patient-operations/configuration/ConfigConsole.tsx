"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Patient Operations configuration editor (POS-112). Inline-edit an editable rule; saving versions
// the override through /api/operations/pos-config (append-a-new-version, effective-dated, audited).
/* eslint-disable @typescript-eslint/no-explicit-any */

const unit = (type: string) => (type === "minutes" ? "min" : type === "score" ? "pts" : "");

export default function ConfigConsole({ domains }: { domains: any[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const toast = (kind: "ok" | "err", text: string) => { setMsg({ kind, text }); setTimeout(() => setMsg(null), 4000); };

  function edit(domain: string, rule: any) { setEditing(`${domain}::${rule.key}`); setDraft(String(rule.value)); }

  async function save(domain: string, rule: any) {
    setBusy(true);
    const r = await fetch("/api/operations/pos-config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domain, rule_key: rule.key, value: draft }) });
    setBusy(false);
    if (r.ok) { setEditing(null); toast("ok", `${rule.label} updated`); router.refresh(); }
    else { const d = await r.json().catch(() => ({})); toast("err", d?.error || "Failed"); }
  }

  return (
    <>
      {msg && <div className={`fixed bottom-4 right-4 z-50 text-sm rounded-lg px-4 py-2.5 shadow-lg ${msg.kind === "ok" ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"}`}>{msg.text}</div>}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {domains.map(d => (
          <div key={d.domain} className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-bold text-gray-900 mb-1 flex items-center gap-2">{d.icon} {d.name}</h3>
            <p className="text-[11px] text-gray-400 mb-3">{d.consumerNote}</p>
            <div className="divide-y divide-gray-50">
              {d.rules.map((rule: any) => {
                const key = `${d.domain}::${rule.key}`;
                const isEditing = editing === key;
                return (
                  <div key={rule.key} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0"><p className="text-sm text-gray-700 truncate">{rule.label}</p><p className="text-[10px] text-gray-400">{rule.overridden ? `Tenant override · v${rule.version}` : "Platform default"}</p></div>
                    {isEditing ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <input type="number" min={0} value={draft} onChange={e => setDraft(e.target.value)} className="w-20 border border-gray-300 rounded-lg px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-emerald-500/40" />
                        <span className="text-[11px] text-gray-400 w-6">{unit(rule.type)}</span>
                        <button onClick={() => save(d.domain, rule)} disabled={busy} className="text-[11px] font-medium text-white bg-emerald-600 rounded px-2 py-1 hover:bg-emerald-700 disabled:opacity-50">Save</button>
                        <button onClick={() => setEditing(null)} className="text-[11px] text-gray-400 hover:text-gray-600">Cancel</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-sm font-bold text-gray-900 tabular-nums">{rule.value}<span className="text-[11px] text-gray-400 font-normal ml-0.5">{unit(rule.type)}</span></span>
                        <button onClick={() => edit(d.domain, rule)} className="text-[11px] font-medium text-emerald-700 hover:underline">Edit</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
