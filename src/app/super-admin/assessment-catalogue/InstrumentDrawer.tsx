"use client";

import { useRef, type ReactNode } from "react";
import { useModalFocus } from "@/components/ui/use-modal-focus";
import { btnGhost } from "./ui";

// The right-hand detail drawer. A real dialog: focus moves in, Tab wraps inside, Escape and the shade close it, and focus
// returns to the row that opened it. Full width on phones, a side panel from the sm edge up.
export default function InstrumentDrawer({ onClose, label, children }: { onClose: () => void; label: string; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useModalFocus(true, panel, onClose);
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-teal-950/40" onClick={onClose} aria-hidden="true" />
      <div ref={panel} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}
        className="relative flex h-full w-full flex-col bg-white shadow-xl sm:max-w-[560px] lg:max-w-[640px]">
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-3">
          <p className="text-[12px] font-bold uppercase tracking-wide text-gray-600">Instrument</p>
          <button type="button" className={btnGhost} onClick={onClose} aria-label="Close the instrument panel">Close</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
