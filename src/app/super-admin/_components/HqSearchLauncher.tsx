"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useModalFocus } from "@/components/ui/use-modal-focus";
import { matchHqDestinations, type HqDestination } from "@/lib/hq/search-catalogue";

// COMP-HQ-ACCESS-001 s15 -- "Search HQ / Go to..." for people who live in this console.
//
// ⚠ THE LIST ARRIVES ALREADY FILTERED. The server hands down only destinations this viewer may be
// offered (hqSearchCatalogue over canSeeHqLink), so an unauthorised destination's NAME is never in
// this page's HTML -- s15's "do not expose unauthorised object names through search". This component
// therefore has no permission logic at all, and must never grow any: a filter in the browser is a
// filter an attacker reads around.
//
// ⚠ AND IT GRANTS NOTHING. Every destination re-authorises on arrival (requireHqContext, or the role
// test on the pages not yet converted). This is a way to TYPE a route, not a way to reach one.
//
// s15 asks for keyboard access: Ctrl/Cmd-K opens, Escape closes, the arrows walk the results and
// Enter goes. The trigger is a real button as well, because a shortcut nobody is told about is a
// feature for the person who wrote it (s21's "do not rely solely on gestures" reasoning, applied to
// key combinations).

export default function HqSearchLauncher({ destinations }: { destinations: HqDestination[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const results = matchHqDestinations(destinations, query);

  // Defined above the effects so all three ways out -- Escape, the backdrop, and choosing a result --
  // close the same way. The setters are stable, so the empty dependency list is honest.
  const close = useCallback(() => { setOpen(false); setQuery(""); setCursor(0); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(v => !v);
      }
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  /**
   * ⚠ THE RESET MOVED OUT OF THE EFFECT, AND IT IS THE SAME LESSON AS THE DRAWER'S (2026-08-17).
   *
   * This read `if (open) focus(); else { setQuery(""); setCursor(0); }` in an effect on [open] --
   * setState synchronously in an effect body, which React's own lint rule refuses as a cascading
   * render, and which this file's ESLint reports as an error. It was never linted when it shipped.
   *
   * Clearing on CLOSE is not synchronisation, it is what closing MEANS, so it belongs on the actions
   * that close.
   *
   * ⚠ AND THE HAND-ROLLED FOCUS MOVE IS NOW THE SHARED HOOK. Moving focus in was only one of the three
   * things aria-modal="true" promises. This panel trapped nothing: with the palette open, Tab walked
   * out into the HQ shell behind an opaque overlay, and closing it left focus at the top of the
   * document rather than on the control that opened it. useModalFocus does all three, and lands on the
   * search input for free because it is the first focusable in the panel.
   */
  useModalFocus(open, panel, close);

  const go = (href: string) => { close(); router.push(href); };

  // ⚠ THIS WAS STYLED FOR A DARK HEADER AND RENDERS ON A WHITE ONE. `border-white/15` is invisible
  // against white, `bg-white/5` is white, and `text-gray-300` measured 1.4:1 — so the one control that
  // searches the whole of HQ was very nearly invisible on every screen that carries it. Found by axe in
  // the CPR-PD-013 §12 pass; GlobalHeader's root is `bg-white border-b border-gray-200`, which is what
  // these values should always have been answering to. Light-surface tokens now, at AA for their sizes.
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        aria-label="Search HQ. Keyboard shortcut Control or Command K"
        className="flex min-h-[36px] items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 text-[12.5px] text-gray-700 hover:bg-gray-100">
        <span aria-hidden>🔎</span>
        <span>Search HQ</span>
        <span aria-hidden className="ml-1 rounded border border-gray-300 px-1 text-[10px] text-gray-600">⌘K</span>
      </button>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={close} aria-hidden />
      <div ref={panel} role="dialog" aria-modal="true" aria-label="Search HQ" tabIndex={-1}
        className="fixed left-1/2 top-24 z-50 w-[min(36rem,92vw)] -translate-x-1/2 rounded-2xl border border-white/10 bg-[#101a24] p-3 shadow-2xl">
        <input ref={inputRef} value={query}
          onChange={e => { setQuery(e.target.value); setCursor(0); }}
          onKeyDown={e => {
            if (e.key === "ArrowDown") { e.preventDefault(); setCursor(c => Math.min(c + 1, results.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
            if (e.key === "Enter" && results[cursor]) { e.preventDefault(); go(results[cursor].href); }
          }}
          placeholder="Go to... try practice incidents"
          aria-label="Search HQ destinations"
          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[14px] text-white outline-none placeholder:text-gray-500 focus:border-teal-500/50" />

        {query.trim() !== "" && results.length === 0 && (
          // ⚠ THE HONEST SENTENCE. "Nothing matches" and "you may not open that" are different facts,
          // and this launcher can only ever say the first -- an unauthorised destination is not in
          // this list to be missed. Saying more would leak exactly what s15 forbids.
          <p className="px-2 py-3 text-[12.5px] text-gray-400">
            Nothing here matches that. This searches the HQ destinations your positions open.
          </p>
        )}

        {results.length > 0 && (
          <ul className="mt-2 max-h-72 overflow-y-auto">
            {results.map((d, i) => (
              <li key={d.href}>
                <button type="button" onClick={() => go(d.href)} onMouseEnter={() => setCursor(i)}
                  aria-current={i === cursor}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left ${
                    i === cursor ? "bg-white/10" : "hover:bg-white/5"}`}>
                  <span aria-hidden className="text-[14px]">{d.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] text-white">{d.label}</span>
                    <span className="block truncate text-[11px] text-gray-400">{d.group}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
