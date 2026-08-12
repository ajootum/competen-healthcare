"use client";

import { useEffect, useRef, useState } from "react";

/**
 * s5: "Export is a single menu rather than two permanent buttons. Initial options: Print / Save as PDF
 * and Download CSV."
 *
 * ⚠ PRINT IS NAMED FOR WHAT IT DOES. This product has no PDF generator, so the entry says "Print / Save
 * as PDF" and opens the browser's own dialogue -- a bare "Download PDF" would claim a feature that does
 * not exist, and one that silently produced a different layout from the screen would be worse.
 *
 * ⚠ AND THE MENU IS KEYBOARD-REACHABLE (s17): Escape closes it, focus is returned to the trigger, and a
 * click outside dismisses it. A dropdown that can only be dismissed with a mouse traps a keyboard user
 * on the last thing they opened.
 */
export default function ExportMenu({ csvHref }: { csvHref: string }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    };
    const onClick = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const item = "block w-full px-3 py-2 text-left text-[12.5px] text-gray-700 hover:bg-gray-50";

  return (
    <div ref={wrap} className="relative">
      <button ref={trigger} type="button" onClick={() => setOpen(o => !o)}
        aria-haspopup="menu" aria-expanded={open}
        className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-[13px] font-semibold text-gray-700 hover:bg-gray-50">
        <span aria-hidden="true">&#11015;</span> Export
        <span aria-hidden="true" className="text-[9px] text-gray-400">&#9660;</span>
      </button>
      {open && (
        <div role="menu"
          className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
          <button type="button" role="menuitem" className={item}
            onClick={() => { setOpen(false); window.print(); }}>
            Print / Save as PDF
          </button>
          {/* A real navigation, so it is an anchor -- middle-click and "save link as" keep working. */}
          <a role="menuitem" href={csvHref} className={item} onClick={() => setOpen(false)}>
            Download CSV
          </a>
        </div>
      )}
    </div>
  );
}
