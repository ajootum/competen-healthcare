"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { LearningIcon } from "@/components/ui/scholar-learning";
import { useModalFocus } from "@/components/ui/use-modal-focus";
import { experienceHref } from "@/lib/individual/experiences";
import { GLOBAL_SEARCH_MIN, type GlobalGroup } from "@/lib/individual/scholar/global-search-types";
import { recordHistory } from "@/lib/individual/scholar/search-history-capture";
import { HistoryNotice, useSearchHistoryChoice } from "../SearchHistoryChoice";

// COMPETEN UNIVERSAL SEARCH STANDARD: the Global Search entry in the shared header. A field on a wide screen and an icon on a phone,
// both opening one panel, full width on a phone. Ctrl or Cmd + K opens it from anywhere. It searches as the learner types, with no
// AI. What is typed is sent to be searched and is kept in My Search History only when a result or Enter is chosen, where that is on.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const DEBOUNCE_MS = 250;
const API = "/api/individual/scholar/search";

type State = { status: "idle" } | { status: "loading" } | { status: "failed" } | { status: "done"; q: string; groups: GlobalGroup[] };

export function GlobalSearch() {
  const router = useRouter();
  const choice = useSearchHistoryChoice();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });
  const [active, setActive] = useState(-1);
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const close = useCallback(() => { setOpen(false); setActive(-1); }, []);
  useModalFocus(open, panel, close);

  useEffect(() => {
    const on = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen(true); } };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
  useEffect(() => { if (open) { input.current?.focus(); input.current?.select(); } }, [open]);

  useEffect(() => {
    if (!open) return;
    const typed = q.trim();
    if (typed.length < GLOBAL_SEARCH_MIN) { const id = setTimeout(() => setState({ status: "idle" }), 0); return () => clearTimeout(id); }
    const ctl = new AbortController();
    const id = setTimeout(async () => {
      setState({ status: "loading" });
      try {
        const res = await fetch(`${API}?q=${encodeURIComponent(typed)}`, { signal: ctl.signal });
        if (!res.ok) { setState({ status: "failed" }); return; }
        const json = await res.json() as { q: string; groups: GlobalGroup[] };
        setActive(-1);
        setState({ status: "done", q: json.q, groups: json.groups });
      } catch (e) {
        if ((e as Error).name !== "AbortError") setState({ status: "failed" });
      }
    }, DEBOUNCE_MS);
    return () => { clearTimeout(id); ctl.abort(); };
  }, [q, open]);

  const groups = state.status === "done" ? state.groups : [];
  const found = groups.filter(g => g.types.length > 0);
  const results = found.flatMap(g => g.types.flatMap(t => t.results));
  const count = results.length;

  function keep(resultCount: number) {
    const typed = q.trim();
    if (choice.on && typed.length >= GLOBAL_SEARCH_MIN) recordHistory({ activity: "material_search", query: typed, resultCount });
  }
  function go(path: string) {
    keep(count);
    close();
    router.push(experienceHref("scholar", path));
  }
  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && count) { e.preventDefault(); setActive(a => (a + 1) % count); }
    else if (e.key === "ArrowUp" && count) { e.preventDefault(); setActive(a => (a <= 0 ? count - 1 : a - 1)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (active >= 0 && results[active]) go(results[active].path);
      else if (q.trim().length >= GLOBAL_SEARCH_MIN) go(`study/learn?q=${encodeURIComponent(q.trim())}`);
    }
  }
  useEffect(() => { if (active >= 0) panel.current?.querySelector(`[data-result="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label="Search everything in Scholar" data-global-search
        className={`hidden min-h-[40px] w-[190px] items-center lg:w-[240px] gap-2 rounded-xl border border-gray-300 bg-white px-3 text-left text-[13.5px] text-gray-600 hover:border-gray-400 md:inline-flex pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>
        <LearningIcon name="search" className="h-[17px] w-[17px] shrink-0" />
        <span className="min-w-0 flex-1 truncate">Search Scholar</span>
        <kbd className="hidden shrink-0 rounded lg:inline border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[11px] font-semibold text-gray-600">Ctrl K</kbd>
      </button>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label="Search everything in Scholar" data-global-search-icon
        className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-gray-800 hover:bg-gray-100 md:hidden ${focusRing}`}>
        <LearningIcon name="search" className="h-[22px] w-[22px]" />
      </button>
      {/* In the page's body: inside the sticky header, its stacking would put the bottom bar over this panel. */}
      {open && createPortal(
        <div data-cmp-theme="scholar" className="cmp-scholar fixed inset-0 z-[70] bg-black/40 md:p-16" onClick={e => { if (e.target === e.currentTarget) close(); }}>
          <div ref={panel} role="dialog" aria-modal="true" aria-label="Search Scholar" data-global-search-panel
            className="cmp-learn-key mx-auto flex h-full max-h-full w-full flex-col bg-white shadow-xl md:h-auto md:max-h-[76vh] md:max-w-2xl md:rounded-2xl">
            <div className="border-b border-gray-200 p-3">
              <div className="flex items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"><LearningIcon name="search" className="h-[18px] w-[18px]" /></span>
                  <input ref={input} type="search" role="combobox" aria-expanded={count > 0} aria-controls="global-search-results" aria-activedescendant={active >= 0 ? `global-result-${active}` : undefined}
                    value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey} maxLength={120} autoComplete="off" aria-label="Search everything in Scholar" placeholder="A topic, material, question or competency"
                    className={`block min-h-[44px] w-full rounded-xl border border-gray-300 bg-white py-2 pl-10 pr-3 text-[16px] text-gray-900 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`} />
                </div>
                <button type="button" onClick={close} className={`inline-flex min-h-[44px] shrink-0 items-center rounded-xl px-3 text-[14px] font-semibold text-gray-800 hover:bg-gray-100 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>Close</button>
              </div>
              <p className="mt-1.5 text-[12.5px] text-gray-700">Searching everything you can open in Scholar. Only you see your own records. No AI is used.</p>
            </div>

            <div id="global-search-results" role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto p-3">
              <p role="status" className="sr-only">{state.status === "loading" ? "Searching" : state.status === "done" ? `${count} result${count === 1 ? "" : "s"}` : ""}</p>
              {state.status === "idle" && <p className="px-1 py-3 text-[14px] text-gray-700">Type at least two letters.</p>}
              {state.status === "loading" && <p className="px-1 py-3 text-[14px] text-gray-700" aria-hidden>Searching…</p>}
              {state.status === "failed" && <p role="alert" className="px-1 py-3 text-[14px] font-semibold text-red-800">Search could not run just now. Check your connection and try again.</p>}
              {state.status === "done" && count === 0 && (
                <div className="px-1 py-3 text-[14px] text-gray-800">
                  <p className="font-semibold">Nothing matches &ldquo;{state.q}&rdquo;.</p>
                  <p className="mt-0.5 text-gray-700">Try fewer or different words, or look in one area below.</p>
                </div>
              )}
              {found.map(g => (
                <section key={g.module} aria-label={g.label} className="mb-3" data-search-group={g.module}>
                  <h3 className="cmp-learn-ink px-1 text-[12px] font-extrabold uppercase tracking-[0.08em]">{g.label}</h3>
                  {g.types.map(t => (
                    <div key={t.label} className="mt-1">
                      <p className="px-1 text-[12px] font-semibold text-gray-600">{t.label}</p>
                      <ul>
                        {t.results.map(r => {
                          const i = results.indexOf(r);
                          return (
                            <li key={`${g.module}-${r.id}`} role="presentation">
                              <button type="button" id={`global-result-${i}`} role="option" aria-selected={active === i} data-result={i} onMouseEnter={() => setActive(i)} onClick={() => go(r.path)}
                                className={`block min-h-[44px] w-full rounded-lg px-2 py-1.5 text-left pointer-coarse:min-h-[var(--cmp-touch-min)] ${active === i ? "bg-[var(--learn-surface)] ring-1 ring-[var(--learn-border)]" : "hover:bg-gray-50"} ${focusRing}`}>
                                <span className="block break-words text-[14.5px] font-semibold leading-snug text-gray-900">{r.title}</span>
                                {r.detail && <span className="block break-words text-[12.5px] text-gray-700">{r.detail}</span>}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </section>
              ))}
              {state.status === "done" && groups.some(g => g.unreadable) && (
                <p className="px-1 pb-2 text-[13px] text-gray-800">Could not be searched just now: {groups.filter(g => g.unreadable).map(g => g.label).join(", ")}.</p>
              )}
              {state.status === "done" && (
                <div className="border-t border-gray-100 pt-2">
                  <p className="px-1 text-[12px] font-semibold text-gray-600">Search one area, with its filters</p>
                  <p className="mt-1 flex flex-wrap gap-1.5">
                    {groups.map(g => (
                      <button key={g.module} type="button" onClick={() => go(g.morePath)} data-search-more={g.module}
                        className={`inline-flex min-h-[36px] items-center rounded-full border border-gray-300 bg-white px-3 text-[13px] font-semibold text-gray-800 hover:bg-gray-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>{g.label}</button>
                    ))}
                  </p>
                </div>
              )}
            </div>
            {choice.offered && <div className="border-t border-gray-100 px-3 py-2"><HistoryNotice className="" /></div>}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
