"use client";

import { useCallback, useRef, useState } from "react";
import { useModalFocus } from "@/components/ui/use-modal-focus";

// COMPETEN-HQ-IA-02 — the HQ navigation below md.
//
// HQ rendered no navigation at all on a phone: its aside is `hidden md:flex` and its header `hidden
// md:block`, so the search launcher was the only way to move. This is a BAR, not a rail -- height is the
// one dimension a phone can spare -- and a drawer holding the SAME sidebar the desktop renders, passed in
// as children by the server layout, so the two can never disagree about what a viewer may see.
// The pattern is the Product Director drawer's (CPR-PD-001 s5): focus moves in, Tab wraps, Escape closes,
// focus returns to the opener, and a click on any link closes it.

export default function HqMobileNav({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <div className="sticky top-0 z-30 flex items-center gap-2 bg-[#0f1923] px-3 py-2 md:hidden">
        <button type="button" onClick={() => setOpen(true)} aria-expanded={open} aria-haspopup="dialog"
          aria-label="Open Competen HQ navigation"
          className="flex items-center justify-center rounded-lg px-2 py-1.5 text-lg leading-none text-white hover:bg-white/10 pointer-coarse:min-h-[var(--cp-touch)] pointer-coarse:min-w-[var(--cp-touch)]">
          <span aria-hidden>☰</span>
        </button>
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-white">{title}</span>
      </div>
      {open && <Drawer onClose={close}>{children}</Drawer>}
    </>
  );
}

function Drawer({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  // Mounted only while open, so unmounting runs the hook's cleanup and hands focus back to the opener.
  useModalFocus(true, panel, onClose);
  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Competen HQ navigation"
        // ⚠ CLOSES ON THE CLICK, NOT IN AN EFFECT WATCHING THE PATHNAME (the PD drawer's reasoning):
        // handling the event is not synchronising state, and an effect would be a cascading render.
        onClick={e => { if ((e.target as HTMLElement).closest("a")) onClose(); }}
        className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-[#0f1923] px-4 py-6 shadow-2xl">
        <button type="button" onClick={onClose} aria-label="Close navigation"
          className="absolute right-3 top-3 rounded-lg px-2 py-1 text-slate-300 hover:bg-white/10 hover:text-white pointer-coarse:min-h-[var(--cp-touch)] pointer-coarse:min-w-[var(--cp-touch)]">
          <span aria-hidden>✕</span>
        </button>
        {children}
      </div>
    </div>
  );
}
