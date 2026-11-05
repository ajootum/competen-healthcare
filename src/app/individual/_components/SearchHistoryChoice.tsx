"use client";

import { createContext, useContext } from "react";
import Link from "next/link";
import { experienceHref } from "@/lib/individual/experiences";
import { HISTORY_NOTICE_OFF, HISTORY_NOTICE_ON, HISTORY_SETTING_LINK, HISTORY_SETTING_PATH, type SearchHistoryChoice } from "@/lib/individual/scholar/search-history";

// Owner decision 5 Nov 2026 (My Search History privacy, items 1 and 2). The experience layout reads the learner's own choice once
// (readSearchHistoryChoice) and hands it down, so every place a search or question can be kept asks here instead of threading props.
// A presentation hint and a courtesy: the capture route reads the choice again and decides. Outside a provider: not offered, nothing kept.

const Ctx = createContext<SearchHistoryChoice>({ offered: false, on: false });

export function SearchHistoryChoiceProvider({ value, children }: { value: SearchHistoryChoice; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSearchHistoryChoice(): SearchHistoryChoice {
  return useContext(Ctx);
}

/** The on-page notice, beside every box whose words can be kept, with its link to the setting. Nothing where history is not offered. */
export function HistoryNotice({ className = "mt-2" }: { className?: string }) {
  const { offered, on } = useSearchHistoryChoice();
  if (!offered) return null;
  return (
    <p data-testid="history-notice" data-history={on ? "on" : "off"} className={`${className} text-[12.5px] leading-relaxed text-gray-600`}>
      {on ? HISTORY_NOTICE_ON : HISTORY_NOTICE_OFF}{" "}
      <Link href={experienceHref("scholar", HISTORY_SETTING_PATH)} data-testid="history-notice-link"
        className="inline-flex min-h-[32px] items-center font-semibold text-gray-900 underline underline-offset-2 pointer-coarse:min-h-[var(--cmp-touch-min)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900">
        {HISTORY_SETTING_LINK}
      </Link>
    </p>
  );
}
