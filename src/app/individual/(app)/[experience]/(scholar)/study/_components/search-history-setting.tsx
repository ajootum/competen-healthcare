"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SEARCH_HISTORY_FEATURE, SEARCH_HISTORY_NOTICE } from "@/lib/individual/scholar/config";
import type { LegalLink } from "@/lib/individual/scholar/consent-gate";
import { focusRing } from "../../../../../_components/chrome";

// THE LEARNER'S MY SEARCH HISTORY SETTING -- owner decision 5 Nov 2026, items 1 and 2, migration 993. On My Search History and in Settings
// (AI and privacy). OFF until the learner has read the notice and turned it on. It is its own recorded choice with its own notice version:
// AI help has its own, and neither touches the other. Turning it off stops new entries and removes nothing.

const btn = `inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 py-2 text-[13.5px] font-semibold disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function SearchHistorySetting({ on, published, unreadable = false, grantedAt, revokedAt, legal }: {
  on: boolean; published: boolean; unreadable?: boolean; grantedAt: string | null; revokedAt: string | null; legal: LegalLink[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const n = SEARCH_HISTORY_NOTICE;
  async function set(grant: boolean) {
    setBusy(true); setError("");
    const res = await fetch("/api/individual/scholar/consent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feature: SEARCH_HISTORY_FEATURE, grant }) }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) { setError(json.error ?? "Your choice could not be saved. Nothing has changed."); return; }
    router.refresh();
  }
  return (
    <section id="history-setting" aria-labelledby="history-setting-h" data-testid="history-setting" data-history={on ? "on" : "off"} className="mt-4 scroll-mt-24 rounded-xl border border-gray-200 bg-gray-50 p-3.5">
      <h2 id="history-setting-h" className="text-[14.5px] font-bold text-gray-900">{on ? "My Search History is on" : "My Search History is off"}</h2>
      <p className="mt-0.5 text-[13px] text-gray-700">
        {unreadable ? "Your choice could not be read just now, so nothing new is being kept." : on
          ? `New searches and questions are kept${grantedAt ? ` (turned on ${day(grantedAt)})` : ""}.`
          : `New searches and questions are not kept${revokedAt ? ` (turned off ${day(revokedAt)})` : ""}. AI help, lessons and searching work the same.`}
      </p>
      <details open={!on} className="mt-2 text-[13px] leading-relaxed text-gray-700">
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
              <li key={`${d.title}-${d.version}`}>{d.url ? <a href={d.url} target="_blank" rel="noopener" className={`font-semibold underline underline-offset-2 ${focusRing}`}>{d.title}</a> : d.title}</li>
            ))}
          </ul>
        </div>
      </details>
      <div className="mt-2.5">
        {on ? (
          <button type="button" disabled={busy} onClick={() => set(false)} data-testid="history-turn-off" className={`${btn} border border-gray-300 bg-white text-gray-800 hover:bg-gray-100`}>{busy ? "Saving…" : "Turn off My Search History"}</button>
        ) : !published ? (
          <p className="text-[13px] font-semibold text-gray-800">{n.awaitingLegal}</p>
        ) : (
          <button type="button" disabled={busy || unreadable} onClick={() => set(true)} data-testid="history-turn-on" className={`${btn} bg-gray-900 text-white hover:bg-gray-800`}>{busy ? "Saving…" : "Turn on My Search History"}</button>
        )}
      </div>
      {error && <p role="alert" className="mt-1.5 text-[13px] text-red-700">{error}</p>}
    </section>
  );
}
