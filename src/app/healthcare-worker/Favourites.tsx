"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

// Favourites / pinned modules (HWW-UI-005 s19).
//
// The server resolves pins against the LIVE nav, so this component never sees a pin whose module has since
// been renamed, disabled by the hospital, or removed -- it renders what it is given. That is why the pin
// table stores keys and not labels: a cached label would drift, and a cached href would rot.
//
// Edit mode is explicit. An always-visible remove control on a four-item bar is four chances to unpin the
// thing you were reaching for, on a touchscreen, mid-shift.

export type Pinnable = { key: string; label: string; href: string; icon: string };

export default function Favourites({ pinned, options }: { pinned: Pinnable[]; options: Pinnable[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function toggle(key: string, on: boolean) {
    setBusy(key); setMsg(null);
    const r = on
      ? await fetch("/api/hww/pins", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ module_key: key }) })
      : await fetch(`/api/hww/pins?module_key=${encodeURIComponent(key)}`, { method: "DELETE" });
    setBusy(null);
    if (!r.ok) { const d = await r.json().catch(() => ({})); setMsg(d.error ?? "Could not save"); return; }
    router.refresh();
  }

  const pinnedKeys = new Set(pinned.map(p => p.key));

  return (
    <div className="mb-1" data-sb-label>
      <div className="flex items-center justify-between px-3 pt-1 pb-0.5">
        <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-400/50">Favourites</span>
        <button onClick={() => { setEditing(e => !e); setMsg(null); }}
          className="text-[9px] text-emerald-300/60 hover:text-emerald-100 transition-colors">
          {editing ? "Done" : "Edit"}
        </button>
      </div>

      {!editing && (
        pinned.length === 0 ? (
          <p className="px-3 pb-1 text-[10px] text-emerald-200/35 leading-snug">
            Nothing pinned. Choose <span className="text-emerald-200/60">Edit</span> to pin the modules you use most.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1 px-2 pb-1">
            {pinned.map(p => (
              <Link key={p.key} href={p.href} title={p.label}
                className="flex items-center gap-1 rounded-md bg-emerald-900/50 hover:bg-emerald-800/70 px-1.5 py-1 text-[10px] text-emerald-100/80 transition-colors max-w-full">
                <span aria-hidden className="leading-none">{p.icon}</span>
                <span className="truncate">{p.label}</span>
              </Link>
            ))}
          </div>
        )
      )}

      {editing && (
        <div className="px-2 pb-1.5 max-h-44 overflow-y-auto">
          {options.map(o => {
            const on = pinnedKeys.has(o.key);
            return (
              <button key={o.key} onClick={() => toggle(o.key, !on)} disabled={busy === o.key}
                className="w-full flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[10px] text-emerald-100/70 hover:bg-emerald-900/50 disabled:opacity-50 transition-colors">
                <span aria-hidden className={on ? "text-amber-300" : "text-emerald-100/25"}>{on ? "★" : "☆"}</span>
                <span aria-hidden className="leading-none">{o.icon}</span>
                <span className="flex-1 text-left truncate">{o.label}</span>
              </button>
            );
          })}
          {msg && <p className="px-1.5 pt-1 text-[10px] text-amber-300/90">{msg}</p>}
        </div>
      )}
    </div>
  );
}
