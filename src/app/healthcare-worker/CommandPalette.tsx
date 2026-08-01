"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Command palette (HWW-UI-005 s18). Cmd/Ctrl-K from any HWW screen.
//
// KEYBOARD FIRST, because the people using it are holding something in the other hand. Arrow keys move,
// Enter opens, Escape closes, and the input takes focus on open. Focus is NOT trapped -- tabbing can still
// leave the dialog, which is a genuine gap against s20 rather than something to claim is handled.
// The trigger is also a visible button: a shortcut nobody is told about is a feature only its author uses.
//
// Requests are DEBOUNCED and superseded. Without the sequence guard a slow response for "br" can land after
// a fast one for "brian" and repaint the older results under the newer query -- the classic race that makes
// a search box feel haunted.

type Hit = { kind: string; label: string; sub?: string | null; href: string; icon: string };

const KIND_LABEL: Record<string, string> = {
  patient: "Patients", action: "Actions", module: "Modules", record: "Records",
};

export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState(false);
  const [scoped, setScoped] = useState<number | null>(null);
  const seq = useRef(0);

  // Closing RESETS here rather than in an effect watching `open`. Doing it in an effect means a render
  // pass with the old results still mounted under a closing dialog, and React's own guidance is that state
  // caused by an event belongs in the handler that fired it.
  const close = useCallback(() => {
    setOpen(false); setQ(""); setHits([]); setCursor(0); setBusy(false); seq.current++;
  }, []);

  // Cmd/Ctrl-K toggles from anywhere in the workspace.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(o => { if (o) { setQ(""); setHits([]); setCursor(0); setBusy(false); } return !o; });
      }
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    // Short queries are cleared by the change handler, so the effect body sets no state synchronously.
    if (term.length < 2) return;
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const r = await fetch(`/api/hww/search?q=${encodeURIComponent(term)}`);
        const d = await r.json().catch(() => ({ hits: [] }));
        // Drop a response that a newer keystroke has already superseded.
        if (mine !== seq.current) return;
        setHits(d.hits ?? []);
        setScoped(typeof d.scopedPatients === "number" ? d.scopedPatients : null);
        setCursor(0);
      } finally {
        if (mine === seq.current) setBusy(false);
      }
    }, 180);
    return () => clearTimeout(t);
  }, [q, open]);

  const go = useCallback((h: Hit | undefined) => {
    if (!h) return;
    close();
    router.push(h.href);
  }, [router, close]);

  function onQueryChange(v: string) {
    setQ(v);
    // Clearing lives with the keystroke that caused it.
    if (v.trim().length < 2) { setHits([]); setBusy(false); seq.current++; }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor(c => Math.min(c + 1, Math.max(hits.length - 1, 0))); }
    if (e.key === "ArrowUp") { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
    if (e.key === "Enter") { e.preventDefault(); go(hits[cursor]); }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Search patients, actions and modules (Control K)"
        className="hidden md:flex items-center gap-2 w-full text-left rounded-lg border border-emerald-800/60 bg-emerald-950/40 px-3 py-2 text-[12px] text-emerald-200/50 hover:border-emerald-700 hover:text-emerald-100/70 transition-colors"
      >
        <span aria-hidden>🔍</span>
        <span className="flex-1 truncate">Search patients, actions…</span>
        <kbd className="text-[9px] font-sans border border-emerald-800/80 rounded px-1 py-0.5 text-emerald-300/60">Ctrl K</kbd>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="absolute inset-0 bg-black/40" onClick={close} />
      <div className="relative w-full max-w-xl bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden">
        <input
          autoFocus
          value={q}
          onChange={e => onQueryChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search your patients, actions, modules and records…"
          aria-label="Search"
          className="w-full px-4 py-3.5 text-sm outline-none border-b border-gray-100"
        />

        <div className="max-h-[50vh] overflow-y-auto">
          {q.trim().length < 2 && (
            <p className="px-4 py-6 text-center text-[12px] text-gray-400">
              Type at least two characters. Searches only the patients assigned to you.
            </p>
          )}
          {q.trim().length >= 2 && !busy && hits.length === 0 && (
            <p className="px-4 py-6 text-center text-[12px] text-gray-400">
              No matches{scoped === 0 ? " — you have no patients assigned yet" : ""}.
            </p>
          )}
          {hits.map((h, i) => {
            // Derived from the PREVIOUS hit rather than a running variable: mutating during render is a
            // real bug (React may re-run this), not just a lint preference.
            const header = i === 0 || hits[i - 1].kind !== h.kind ? (KIND_LABEL[h.kind] ?? h.kind) : null;
            return (
              <div key={`${h.kind}-${h.href}-${i}`}>
                {header && <p className="px-4 pt-2.5 pb-1 text-[9px] font-bold uppercase tracking-widest text-gray-300">{header}</p>}
                <button
                  onClick={() => go(h)}
                  onMouseEnter={() => setCursor(i)}
                  aria-current={i === cursor ? "true" : undefined}
                  className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left ${i === cursor ? "bg-emerald-50" : "hover:bg-gray-50"}`}
                >
                  <span className="w-5 text-center" aria-hidden>{h.icon}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] text-gray-800 truncate">{h.label}</span>
                    {h.sub && <span className="block text-[11px] text-gray-400 truncate">{h.sub}</span>}
                  </span>
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-3 px-4 py-2 border-t border-gray-100 text-[10px] text-gray-400">
          <span>↑↓ move</span><span>↵ open</span><span>esc close</span>
          {/* Says what it searched. A palette that silently covers only your own patients could otherwise
              be read as "this patient is not on the ward". */}
          <span className="ml-auto">{scoped != null ? `${scoped} assigned patient${scoped === 1 ? "" : "s"} in scope` : ""}</span>
        </div>
      </div>
    </div>
  );
}
