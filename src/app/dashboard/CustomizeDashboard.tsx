"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// Ch.11 WS8 — the "Customize" control on the Personal Dashboard. Users show/hide OPTIONAL widgets and reset to the
// organizational default; required/locked/org-disabled widgets are surfaced but not toggleable (policy before
// preference). Changes persist as user-scope overrides the manifest resolver already reads → take effect on refresh.
/* eslint-disable @typescript-eslint/no-explicit-any */
export default function CustomizeDashboard({ controls }: { controls: any[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const post = (body: any) => start(async () => {
    setMsg(null);
    const r = await fetch("/api/me/dashboard-prefs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    if (r?.ok) router.refresh(); else { const j = await r?.json().catch(() => null); setMsg(j?.error ?? "Couldn't update"); }
  });

  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} className="text-[12px] font-medium text-gray-600 border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-50">⚙ Customize</button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 z-40 w-72 bg-white rounded-xl border border-gray-200 shadow-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[13px] font-semibold text-gray-900">Customize dashboard</h3>
              <button onClick={() => post({ reset: true })} disabled={pending} className="text-[11px] font-medium text-blue-600 hover:underline disabled:opacity-50">Reset</button>
            </div>
            {msg && <p className="text-[11px] text-rose-600 mb-1.5">{msg}</p>}
            <div className="space-y-0.5 max-h-80 overflow-y-auto">
              {controls.map((c: any) => (
                <div key={c.key} className="flex items-center justify-between py-1.5 px-1">
                  <span className="text-[12px] text-gray-700">{c.label}</span>
                  {c.canToggle ? (
                    <button onClick={() => post({ key: c.key, hidden: c.visible })} disabled={pending} title={c.visible ? "Hide" : "Show"} className={`w-9 h-5 rounded-full relative shrink-0 transition-colors ${c.visible ? "bg-blue-600" : "bg-gray-300"}`}>
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${c.visible ? "translate-x-4" : "translate-x-0.5"}`} />
                    </button>
                  ) : (
                    <span className="text-[10px] text-gray-400 flex items-center gap-1">🔒 {c.state}</span>
                  )}
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-2 pt-2 border-t border-gray-100">Required &amp; locked widgets are set by your organization and can&apos;t be hidden.</p>
          </div>
        </>
      )}
    </div>
  );
}
