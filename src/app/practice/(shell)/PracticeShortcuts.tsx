"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useModalFocus } from "@/components/ui/use-modal-focus";
import { SHORTCUTS } from "@/lib/practice/preference-constants";

// CPR-360 keyboard shortcuts. Real ones, bound to routes that exist.
//
// NOTHING FIRES WHILE SOMEBODY IS TYPING. The first rule of a global key handler in a clinical product:
// a practitioner writing "gp referral" into a consultation note must not be navigated away mid-sentence.
// Inputs, textareas, selects and contenteditable regions are all excluded before anything else runs.
//
// NO MODIFIERS, SO NOTHING IS TAKEN FROM THE BROWSER. The comp draws Ctrl+N and Ctrl+T, which are New
// Window and New Tab and cannot be reassigned by a web page. A two-key sequence -- g then p -- takes
// nothing, works on every keyboard layout that has letters, and is what editors have used for decades.

const SEQUENCE_WINDOW_MS = 900;

export default function PracticeShortcuts() {
  const router = useRouter();
  const [help, setHelp] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  // The help sheet declares aria-modal="true", which tells assistive technology the page behind is
  // inert. Without a trap that is a promise the dialog does not keep: Tab walked straight out into the
  // shell underneath the overlay. The hook moves focus in, wraps Tab at both ends, and returns focus to
  // whatever was focused when "?" was pressed.
  //
  // The global handler below ALSO closes on Escape. Both paths call setHelp(false) and that is
  // deliberate rather than redundant: the global one still has to clear a pending "g" sequence.
  useModalFocus(help, panel, () => setHelp(false));

  useEffect(() => {
    let pending = "";
    let expires = 0;

    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const el = e.target as HTMLElement | null;
      const tag = el?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || el?.isContentEditable) return;

      if (e.key === "Escape") { setHelp(false); pending = ""; return; }

      if (e.key === "?") { e.preventDefault(); setHelp(h => !h); return; }
      if (e.key === "/") { e.preventDefault(); router.push("/practice/search"); return; }

      const now = Date.now();
      if (pending && now > expires) pending = "";

      if (pending === "g") {
        const match = SHORTCUTS.find(([keys]) => keys === `g ${e.key.toLowerCase()}`);
        pending = "";
        if (match && match[2]) { e.preventDefault(); router.push(match[2]); }
        return;
      }
      if (e.key.toLowerCase() === "g") { pending = "g"; expires = now + SEQUENCE_WINDOW_MS; }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router]);

  if (!help) return null;

  return (
    // ⚠ THE DIALOG SEMANTICS BELONG ON THE PANEL, NOT THE SCRIM. They used to sit on this full-screen
    // backdrop, which declared the entire viewport -- overlay included -- to be the dialog. The panel is
    // the dialog; the scrim is a click target that dismisses it.
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => setHelp(false)}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" tabIndex={-1}
        className="max-w-md w-full rounded-xl bg-white p-4 shadow-lg" onClick={e => e.stopPropagation()}>
        <h2 className="text-[13px] font-bold text-gray-900">Keyboard shortcuts</h2>
        <ul className="mt-2 flex flex-col">
          {SHORTCUTS.map(([keys, label]) => (
            <li key={keys} className="flex items-baseline gap-3 border-b border-gray-100 py-1.5 last:border-0">
              <kbd className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-gray-700">{keys}</kbd>
              <span className="text-[12px] text-gray-700">{label}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[10px] text-gray-500">
          Press <kbd className="font-mono">g</kbd> then the second key. Nothing fires while you are typing
          in a field. Turn these off in Settings.
        </p>
        <button type="button" onClick={() => setHelp(false)}
          className="mt-3 rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
          Close
        </button>
      </div>
    </div>
  );
}
