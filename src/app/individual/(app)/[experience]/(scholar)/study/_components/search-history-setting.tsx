"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SEARCH_HISTORY_FEATURE, SEARCH_HISTORY_NOTICE } from "@/lib/individual/scholar/config";
import type { HistoryChoiceState, LegalLink } from "@/lib/individual/scholar/consent-gate";
import { SEARCH_HISTORY_SUPPLEMENT, SEARCH_HISTORY_SUPPLEMENT_PATH } from "@/lib/legal/search-history-supplement";
import { focusRing } from "../../../../../_components/chrome";

// THE LEARNER'S MY SEARCH HISTORY SETTING -- owner decisions 5 Nov 2026, migrations 993 and 994. On My Search History and in Settings (AI and privacy).
// On by default once the learner has seen the one-time notice, and their own choice wins. It is its own record with its own notice version: AI help has
// its own, and neither touches the other. Opening this setting does not count as seeing the notice: only the notice at a search or question box does.

const btn = `inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 py-2 text-[13.5px] font-semibold disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;
const quiet = `${btn} border border-gray-300 bg-white text-gray-800 hover:bg-gray-100`;
const solid = `${btn} bg-gray-900 text-white hover:bg-gray-800`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function SearchHistorySetting({ state, published, unreadable = false, grantedAt, revokedAt, notifiedAt, legal }: {
  state: HistoryChoiceState; published: boolean; unreadable?: boolean; grantedAt: string | null; revokedAt: string | null; notifiedAt: string | null; legal: LegalLink[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const n = SEARCH_HISTORY_NOTICE;
  const on = state === "on_by_notice" || state === "on_chosen";
  async function set(grant: boolean) {
    setBusy(true); setError("");
    const res = await fetch("/api/individual/scholar/consent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feature: SEARCH_HISTORY_FEATURE, grant }) }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) { setError(json.error ?? "Your choice could not be saved. Nothing has changed."); return; }
    router.refresh();
  }
  const heading = state === "unseen" ? "My Search History has not started" : on ? "My Search History is on" : "My Search History is off";
  const line = unreadable ? "Your choice could not be read just now, so nothing new is being kept."
    : state === "unseen" ? "It is on by default, and it starts once you have seen its notice beside a search or question box. Nothing is being kept yet."
    : state === "on_by_notice" ? `New searches and questions are kept, because you saw this notice${notifiedAt ? ` on ${day(notifiedAt)}` : ""}. You can keep it on or turn it off.`
    : state === "on_chosen" ? `New searches and questions are kept${grantedAt ? ` (you chose this on ${day(grantedAt)})` : ""}.`
    : `New searches and questions are not kept${revokedAt ? ` (turned off ${day(revokedAt)})` : ""}. AI help, lessons and searching work the same.`;
  return (
    <section id="history-setting" aria-labelledby="history-setting-h" data-testid="history-setting" data-history={on ? "on" : state === "unseen" ? "pending" : "off"} data-state={state} className="mt-4 scroll-mt-24 rounded-xl border border-gray-200 bg-gray-50 p-3.5">
      <h2 id="history-setting-h" className="text-[14.5px] font-bold text-gray-900">{heading}</h2>
      <p className="mt-0.5 text-[13px] text-gray-700" data-testid="history-setting-line">{line}</p>
      <details open={state !== "on_chosen"} className="mt-2 text-[13px] leading-relaxed text-gray-700">
        <summary className={`inline-flex min-h-[32px] cursor-pointer items-center font-semibold text-gray-900 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>{n.heading}</summary>
        <div className="mt-1 space-y-1.5" data-testid="history-setting-notice">
          <p>{n.kept}</p>
          <p>{n.notKept}</p>
          <p>{n.howLong}</p>
          <p>{n.who}</p>
          <p>{n.patient}</p>
          <p>{n.off}</p>
          <p>{n.review}</p>
          <ul className="space-y-1">
            {legal.length === 0 && <li className="text-gray-600">The Privacy Notice and Terms of Use are not published for this service yet.</li>}
            {legal.map(d => (
              <li key={`${d.title}-${d.version}`}>{d.url ? <a href={d.url} target="_blank" rel="noopener" className={`inline-flex items-center font-semibold underline underline-offset-2 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>{d.title}</a> : d.title}</li>
            ))}
            <li><a href={SEARCH_HISTORY_SUPPLEMENT_PATH} target="_blank" rel="noopener" className={`inline-flex items-center font-semibold underline underline-offset-2 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`} data-testid="history-supplement-link">{SEARCH_HISTORY_SUPPLEMENT.title}</a></li>
          </ul>
        </div>
      </details>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {!published && !on ? (
          <p className="text-[13px] font-semibold text-gray-800">{n.awaitingLegal}</p>
        ) : state === "unseen" || state === "on_by_notice" ? (
          <>
            <button type="button" disabled={busy || unreadable} onClick={() => set(true)} data-testid="history-turn-on" className={solid}>{busy ? "Saving…" : "Keep it on"}</button>
            <button type="button" disabled={busy} onClick={() => set(false)} data-testid="history-turn-off" className={quiet}>{busy ? "Saving…" : "Turn it off"}</button>
          </>
        ) : state === "on_chosen" ? (
          <button type="button" disabled={busy} onClick={() => set(false)} data-testid="history-turn-off" className={quiet}>{busy ? "Saving…" : "Turn off My Search History"}</button>
        ) : (
          <button type="button" disabled={busy || unreadable} onClick={() => set(true)} data-testid="history-turn-on" className={solid}>{busy ? "Saving…" : "Turn on My Search History"}</button>
        )}
      </div>
      {error && <p role="alert" className="mt-1.5 text-[13px] text-red-700">{error}</p>}
    </section>
  );
}
