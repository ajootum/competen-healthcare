"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { SHORTCUTS, isTypingTarget } from "@/lib/platform/shortcuts";

// Keyboard shortcut bindings (PUI-005 s2).
//
// THIS EXISTS BECAUSE THE SHORTCUTS WERE DOCUMENTED BEFORE THEY WORKED. The Help page listed them from the
// shared table, which made them look real; nothing bound them. Documentation that describes a key doing
// nothing is the same defect as a nav item pointing nowhere, so the bindings now come from that same table
// — one source, so the docs and the behaviour cannot diverge.
//
// Two rules that make shortcuts safe rather than annoying:
//   1. NEVER fire while the user is typing. Otherwise "n" becomes unusable in any note field, and a nurse
//      writing a handover gets navigated away mid-sentence.
//   2. Modifier combinations belong to the browser and the OS. A shortcut with Ctrl/Meta/Alt held is not
//      ours to intercept — Ctrl+N must still open a window.

const SEQUENCE_WINDOW_MS = 1200;

export default function ShortcutBinder() {
  const router = useRouter();
  const prefix = useRef<{ key: string; at: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;   // not ours to take
      if (isTypingTarget(e.target)) return;             // never steal a keystroke from a field

      const key = e.key.toLowerCase();

      // Two-key sequences ("g then h"). The prefix expires, so a stray "g" does not lie in wait.
      const active = prefix.current && Date.now() - prefix.current.at < SEQUENCE_WINDOW_MS ? prefix.current.key : null;
      if (active) {
        prefix.current = null;
        const seq = SHORTCUTS.find(s => s.combo === `${active}+${key}`);
        if (seq?.href) { e.preventDefault(); router.push(seq.href); return; }
        // An unrecognised second key simply ends the sequence rather than doing something surprising.
        return;
      }
      if (SHORTCUTS.some(s => s.combo.startsWith(`${key}+`))) {
        prefix.current = { key, at: Date.now() };
        return;
      }

      // "?" arrives as shift+/ on most layouts, so match the produced character rather than the physical key.
      const single = SHORTCUTS.find(s => s.combo === key || (s.combo === "?" && e.key === "?"));
      if (single?.href) { e.preventDefault(); router.push(single.href); }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [router]);

  return null;
}
