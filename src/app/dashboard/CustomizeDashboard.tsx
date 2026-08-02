"use client";
import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { useDismiss } from "@/components/ui/use-dismiss";

// Ch.11 WS8 — the "Customize" control on the Personal Dashboard. Users show/hide OPTIONAL widgets, reorder widgets
// within a zone (keyboard-accessible up/down — §11.5.1 forbids pointer-drag-only), and reset to the organizational
// default. Required/locked/org-disabled widgets are surfaced but not hideable (policy before preference). Changes
// persist as user-scope overrides the manifest resolver reads → take effect on refresh.
/* eslint-disable @typescript-eslint/no-explicit-any */
const ZONES: [string, string][] = [["main", "Main area"], ["rail", "Sidebar"], ["full", "Footer"]];

export default function CustomizeDashboard({ controls }: { controls: any[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // The scrim below closes on an outside click only; this is the keyboard half.
  const trigger = useRef<HTMLButtonElement>(null);
  useDismiss(open, () => setOpen(false), trigger);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const post = (body: any) => start(async () => {
    setMsg(null);
    const r = await fetch("/api/me/dashboard-prefs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    if (r?.ok) router.refresh(); else { const j = await r?.json().catch(() => null); setMsg(j?.error ?? "Couldn't update"); }
  });

  // Reorder a widget within its zone: renumber the zone and persist all orders (avoids collisions).
  const move = (zone: string, idx: number, dir: -1 | 1) => {
    const arr = controls.filter((c: any) => c.zone === zone);
    const j = idx + dir;
    if (j < 0 || j >= arr.length) return;
    const re = [...arr];
    [re[idx], re[j]] = [re[j], re[idx]];
    post({ updates: re.map((c: any, i: number) => ({ key: c.key, order: i * 10 })) });
  };

  return (
    <div className="relative">
      <button ref={trigger} onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="menu"
        className="text-[12px] font-medium text-gray-600 border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-50">⚙ Customize</button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 z-40 w-80 bg-white rounded-xl border border-gray-200 shadow-xl p-3 max-h-[70vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[13px] font-semibold text-gray-900">Customize dashboard</h3>
              <button onClick={() => post({ reset: true })} disabled={pending} className="text-[11px] font-medium text-[var(--cmp-text-information)] hover:underline disabled:opacity-50">Reset</button>
            </div>
            {msg && <p className="text-[11px] text-[var(--cmp-text-error)] mb-1.5">{msg}</p>}

            {ZONES.map(([zone, zlabel]) => {
              const items = controls.filter((c: any) => c.zone === zone);
              if (!items.length) return null;
              return (
                <div key={zone} className="mb-2">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide px-1 mb-0.5">{zlabel}</p>
                  {items.map((c: any, i: number) => (
                    <div key={c.key} className="flex items-center gap-1.5 py-1 px-1">
                      <div className="flex flex-col leading-none">
                        <button onClick={() => move(zone, i, -1)} disabled={pending || i === 0} className="text-[9px] text-gray-400 hover:text-gray-700 disabled:opacity-25" title="Move up">▲</button>
                        <button onClick={() => move(zone, i, 1)} disabled={pending || i === items.length - 1} className="text-[9px] text-gray-400 hover:text-gray-700 disabled:opacity-25" title="Move down">▼</button>
                      </div>
                      <span className={`text-[12px] flex-1 ${c.visible ? "text-gray-700" : "text-gray-400"}`}>{c.label}</span>
                      {c.canToggle ? (
                        <button onClick={() => post({ key: c.key, hidden: c.visible })} disabled={pending} title={c.visible ? "Hide" : "Show"} className={`w-9 h-5 rounded-full relative shrink-0 transition-colors ${c.visible ? "bg-[var(--cmp-color-information)]" : "bg-gray-300"}`}>
                          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${c.visible ? "translate-x-4" : "translate-x-0.5"}`} />
                        </button>
                      ) : (
                        <span className="text-[10px] text-gray-400 flex items-center gap-1 shrink-0">🔒 {c.state}</span>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
            <p className="text-[10px] text-gray-400 mt-1 pt-2 border-t border-gray-100">Reorder with ▲▼. Required &amp; locked widgets are set by your organization.</p>
          </div>
        </>
      )}
    </div>
  );
}
