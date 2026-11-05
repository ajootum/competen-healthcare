"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { experienceHref } from "@/lib/individual/experiences";
import { SEARCH_HISTORY_FEATURE } from "@/lib/individual/scholar/config";
import { HISTORY_FIRST_FAILED, HISTORY_FIRST_NOTICE, HISTORY_NOTICE_OFF, HISTORY_NOTICE_ON, HISTORY_SETTING_LINK, HISTORY_SETTING_PATH, type SearchHistoryChoice } from "@/lib/individual/scholar/search-history";

// Owner decisions 5 Nov 2026 (My Search History privacy, then on by default after a one-time notice). The experience layout reads the learner's own
// choice once (readSearchHistoryChoice) and hands it down, so every place a search or question can be kept asks here instead of threading props.
// A presentation hint and a courtesy: the capture route reads the choice again and decides. Outside a provider: not offered, nothing kept.

type Ctx = SearchHistoryChoice & { update: (next: SearchHistoryChoice) => void };
const NONE: SearchHistoryChoice = { offered: false, on: false, pending: false };
const Context = createContext<Ctx>({ ...NONE, update: () => {} });

/** The server's value, until this page learns better (the notice was recorded, or the learner chose). A newer server value replaces it. */
export function SearchHistoryChoiceProvider({ value, children }: { value: SearchHistoryChoice; children: React.ReactNode }) {
  const [local, setLocal] = useState<{ from: string; value: SearchHistoryChoice } | null>(null);
  const from = JSON.stringify(value);
  const current = local && local.from === from ? local.value : value;
  const ctx = useMemo<Ctx>(() => ({ ...current, update: next => setLocal({ from, value: next }) }), [current, from]);
  return <Context.Provider value={ctx}>{children}</Context.Provider>;
}

export function useSearchHistoryChoice(): Ctx {
  return useContext(Context);
}

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const settingLink = `inline-flex min-h-[32px] items-center font-semibold text-gray-900 underline underline-offset-2 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focus}`;
const firstBtn = `inline-flex min-h-[40px] items-center justify-center rounded-lg border border-gray-300 bg-white px-3.5 text-[13px] font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focus}`;

async function postChoice(body: Record<string, unknown>): Promise<{ ok: boolean; json: Record<string, unknown> }> {
  const res = await fetch("/api/individual/scholar/consent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feature: SEARCH_HISTORY_FEATURE, ...body }) }).catch(() => null);
  return { ok: !!res?.ok, json: res ? await res.json().catch(() => ({})) : {} };
}

/**
 * The one-time notice, in place, for a learner with no recorded choice. It blocks nothing. Once it has actually been on screen it is recorded as
 * SEEN, which is not an agreement (status notified). Only then does this page start keeping: until the server has said so, nothing is sent, and if
 * recording fails it says so and nothing is kept. Keep it on and Turn it off are the learner acting, and are recorded as that.
 */
function FirstNotice({ className, onDone }: { className: string; onDone: () => void }) {
  const router = useRouter();
  const { update } = useSearchHistoryChoice();
  const ref = useRef<HTMLDivElement>(null);
  const asked = useRef(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const seen = new IntersectionObserver(async entries => {
      if (asked.current || !entries.some(e => e.isIntersecting)) return;
      asked.current = true;
      seen.disconnect();
      const r = await postChoice({ seen: true });
      if (r.ok && r.json.state === "on_by_notice") update({ offered: true, on: true, pending: false });
      else if (r.ok && r.json.state === "on_chosen") { update({ offered: true, on: true, pending: false }); onDone(); }
      else if (r.ok && r.json.state === "off") { update({ offered: true, on: false, pending: false }); onDone(); }
      else setFailed(true);
    }, { threshold: 0.5 });
    seen.observe(el);
    return () => seen.disconnect();
  }, [update, onDone]);
  async function choose(grant: boolean) {
    setBusy(true);
    const r = await postChoice({ grant });
    setBusy(false);
    if (!r.ok) { setFailed(true); return; }
    update({ offered: true, on: grant, pending: false });
    onDone();
    router.refresh();
  }
  return (
    <div ref={ref} role="status" data-testid="history-first-notice" data-failed={failed ? "1" : undefined} className={`${className} rounded-xl border border-gray-300 bg-gray-50 p-3 text-[13px] leading-relaxed text-gray-800`}>
      <p>{failed ? HISTORY_FIRST_FAILED : HISTORY_FIRST_NOTICE}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} onClick={() => choose(true)} data-testid="history-first-keep" className={firstBtn}>Keep it on</button>
        <button type="button" disabled={busy} onClick={() => choose(false)} data-testid="history-first-off" className={firstBtn}>Turn it off</button>
        <Link href={experienceHref("scholar", HISTORY_SETTING_PATH)} data-testid="history-notice-link" className={settingLink}>{HISTORY_SETTING_LINK}</Link>
      </div>
    </div>
  );
}

/** Beside every box whose words can be kept: the one-time notice for a learner who has not seen it, else the short notice with its link to the setting. */
export function HistoryNotice({ className = "mt-2" }: { className?: string }) {
  const { offered, on, pending } = useSearchHistoryChoice();
  // Only what was still waiting when this box appeared: the next page, or a box opened after it was seen, gets the short notice.
  const [first, setFirst] = useState(pending);
  const [done] = useState(() => () => setFirst(false));
  if (!offered) return null;
  if (first) return <FirstNotice className={className} onDone={done} />;
  return (
    <p data-testid="history-notice" data-history={on ? "on" : "off"} className={`${className} text-[12.5px] leading-relaxed text-gray-600`}>
      {on ? HISTORY_NOTICE_ON : HISTORY_NOTICE_OFF}{" "}
      <Link href={experienceHref("scholar", HISTORY_SETTING_PATH)} data-testid="history-notice-link" className={settingLink}>{HISTORY_SETTING_LINK}</Link>
    </p>
  );
}
