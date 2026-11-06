"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useModalFocus } from "@/components/ui/use-modal-focus";
import { matchHqDestinations, type HqDestination } from "@/lib/hq/search-catalogue";
import type { HqRecordSourceView } from "@/lib/hq/record-search/registry";

// HQ-RECORD-SEARCH-01: optional record sources. With none (the default) this component makes no fetch and behaves exactly as
// before. The server hands down only sources the viewer holds the capability for, with the flag on. It can still be wrong: the
// layout uses the union of appointments and the route uses the ACTIVE context, so a source may answer 403. That source is then
// dropped for the session and shows nothing (no message that would say what the person is missing). Never probe every route:
// each refusal writes hq_access_observation. A 502 is a failed source and is SAID, never shown as "nothing found".
type RecordHit = { id: string; code: string | null; title: string; href: string };
type RecordEntry = { status: "ok"; hits: RecordHit[]; more: boolean } | { status: "failed" };
const DEBOUNCE_MS = 280;
const MIN_CHARS = 2;
const safeHref = (h: string) => h.startsWith("/super-admin/") && !h.startsWith("//");

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

export default function HqSearchLauncher({ destinations, recordSources = [] }: { destinations: HqDestination[]; recordSources?: HqRecordSourceView[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const results = matchHqDestinations(destinations, query);

  // Record search state: results are stored WITH the query they answer, so loading is derived (no synchronous setState in an effect).
  const [rec, setRec] = useState<{ q: string; by: Record<string, RecordEntry> }>({ q: "", by: {} });
  const [dropped, setDropped] = useState<string[]>([]);
  const heldSources = recordSources.filter(s => !dropped.includes(s.key));
  // Filters are built ONLY from sources this caller already holds (a refused source is dropped above and never listed).
  const [fModule, setFModule] = useState("");
  const [fType, setFType] = useState("");
  const modules = [...new Set(heldSources.map(s => s.module))];
  const types = [...new Set(heldSources.filter(s => !fModule || s.module === fModule).map(s => s.recordType))];
  const activeModule = modules.includes(fModule) ? fModule : "";
  const activeType = types.includes(fType) ? fType : "";
  const liveSources = heldSources.filter(s => (!activeModule || s.module === activeModule) && (!activeType || s.recordType === activeType));
  const recQuery = query.trim().length >= MIN_CHARS ? query.trim() : "";
  const sourcesKey = liveSources.map(s => s.key).join(",");

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

  useEffect(() => {
    if (!open || !recQuery || !sourcesKey) return;
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      setRec({ q: recQuery, by: {} });
      for (const src of sourcesKey.split(",")) {
        const source = recordSources.find(s => s.key === src);
        if (!source) continue;
        fetch(`${source.endpoint}?q=${encodeURIComponent(recQuery)}`, { signal: ctl.signal, credentials: "same-origin" })
          .then(async r => {
            if (r.status === 401 || r.status === 403 || r.status === 404) { setDropped(d => (d.includes(src) ? d : [...d, src])); return; }
            if (!r.ok) throw new Error("source failed");
            const j = await r.json() as { hits?: RecordHit[]; more?: boolean };
            setRec(cur => (cur.q === recQuery ? { q: cur.q, by: { ...cur.by, [src]: { status: "ok", hits: j.hits ?? [], more: j.more === true } } } : cur));
          })
          .catch(e => {
            if ((e as { name?: string })?.name === "AbortError") return;
            setRec(cur => (cur.q === recQuery ? { q: cur.q, by: { ...cur.by, [src]: { status: "failed" } } } : cur));
          });
      }
    }, DEBOUNCE_MS);
    return () => { clearTimeout(timer); ctl.abort(); };
    // recordSources is a stable server-provided prop; sourcesKey captures what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, recQuery, sourcesKey]);

  const answered = rec.q === recQuery && recQuery !== "";
  const groups = liveSources.map(s => ({ source: s, entry: answered ? rec.by[s.key] : undefined }));
  const recordItems = groups.flatMap(g => (g.entry?.status === "ok" ? g.entry.hits : []));
  const loading = liveSources.length > 0 && recQuery !== "" && groups.some(g => !g.entry);
  const anyFailed = groups.some(g => g.entry?.status === "failed");
  const total = results.length + recordItems.length;

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
            if (e.key === "ArrowDown") { e.preventDefault(); setCursor(c => Math.min(c + 1, total - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
            if (e.key === "Enter" && results[cursor]) { e.preventDefault(); go(results[cursor].href); }
            else if (e.key === "Enter" && recordItems[cursor - results.length]) {
              e.preventDefault();
              const h = recordItems[cursor - results.length];
              if (safeHref(h.href)) go(h.href);
            }
          }}
          placeholder="Go to... try practice incidents"
          aria-label="Search HQ destinations"
          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[14px] text-white outline-none placeholder:text-gray-500 focus:border-teal-500/50" />

        {query.trim() !== "" && results.length === 0 && !(liveSources.length > 0 && (loading || anyFailed || recordItems.length > 0)) && (
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
                    <span className="block truncate text-[11px] text-gray-400">{d.group}{d.via?.length ? ` · matches: ${d.via.join(", ")}` : ""}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {heldSources.length > 1 && (
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Filter records">
            {modules.length > 1 && (
              <label className="flex items-center gap-1 text-[11px] text-gray-400">Module
                <select value={activeModule} onChange={e => { setFModule(e.target.value); setFType(""); setCursor(0); }}
                  className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[12px] text-white pointer-coarse:min-h-[var(--cmp-touch-min)]">
                  <option value="" className="text-black">All modules</option>
                  {modules.map(m => <option key={m} value={m} className="text-black">{m}</option>)}
                </select>
              </label>
            )}
            {types.length > 1 && (
              <label className="flex items-center gap-1 text-[11px] text-gray-400">Record type
                <select value={activeType} onChange={e => { setFType(e.target.value); setCursor(0); }}
                  className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[12px] text-white pointer-coarse:min-h-[var(--cmp-touch-min)]">
                  <option value="" className="text-black">All types</option>
                  {types.map(t => <option key={t} value={t} className="text-black">{t}</option>)}
                </select>
              </label>
            )}
          </div>
        )}

        {liveSources.length > 0 && recQuery !== "" && (
          <div className="mt-2" aria-label="Records">
            {loading && <p role="status" aria-live="polite" className="px-2 py-2 text-[12.5px] text-gray-400">Searching records…</p>}
            {(() => {
              let offset = results.length;
              return groups.map(({ source, entry }) => {
                if (!entry) return null;
                const heading = `${source.product} · ${source.module} · ${source.recordType}`;
                if (entry.status === "failed")
                  return <p key={source.key} role="status" className="px-2 py-2 text-[12.5px] text-amber-300">{source.recordType} search failed: the source could not be read. This is not the same as nothing found.</p>;
                if (entry.hits.length === 0) return null;
                const start = offset;
                offset += entry.hits.length;
                return (
                  <section key={source.key} aria-label={heading} className="mt-1">
                    <h3 className="px-2 pt-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{heading}</h3>
                    <ul className="max-h-48 overflow-y-auto">
                      {entry.hits.map((h, i) => (
                        <li key={h.id}>
                          <button type="button" onClick={() => { if (safeHref(h.href)) go(h.href); }} onMouseEnter={() => setCursor(start + i)}
                            aria-current={start + i === cursor}
                            className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left pointer-coarse:min-h-[var(--cmp-touch-min)] ${
                              start + i === cursor ? "bg-white/10" : "hover:bg-white/5"}`}>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13.5px] text-white">{h.title}</span>
                              {h.code && <span className="block truncate text-[11px] text-gray-400">{h.code}</span>}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    {entry.more && <p className="px-2 pb-1 text-[11px] text-gray-400">More {source.recordType.toLowerCase()} records match. Type more to narrow.</p>}
                  </section>
                );
              });
            })()}
          </div>
        )}
      </div>
    </>
  );
}
