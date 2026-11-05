import { SEARCH_HISTORY_FEATURE } from "./config";
import { consentDocuments, historyChoiceOn } from "./consent-gate";
import type { SearchHistoryChoice } from "./search-history";
import { historySchema, readConsent } from "./store";

// THE LEARNER'S OWN CHOICE -- owner decision 5 Nov 2026 (My Search History privacy, items 1 and 2), migration 993.
//
// My Search History is OFFERED by HQ (policy scholar_search_history, default off, with 992 present) and turned ON by the learner, in their
// own consent row (feature scholar_search_history), against the current notice. No row, revoked, an earlier notice, unpublished documents or
// an unreadable row all mean OFF: nothing new is kept. Unreadable is not permission (ADR-015). This is the one place that says so, and
// the capture route and the pages all read it. AI help reads its own row (CONSENT_FEATURE) and never this one.

// SERVER-ONLY: consentDocuments reads process.env.

export type SearchHistoryChoiceDetail = SearchHistoryChoice & {
  /** The choice could not be read just now, so it counts as off, and the setting says so. */
  unreadable: boolean; grantedAt: string | null; revokedAt: string | null;
};

const NOT_OFFERED: SearchHistoryChoiceDetail = { offered: false, on: false, unreadable: false, grantedAt: null, revokedAt: null };

export async function readSearchHistoryChoice(admin: Parameters<typeof readConsent>[0], userId: string, policy: { scholarSearchHistory: "on" | "off" }, env: Record<string, string | undefined> = process.env): Promise<SearchHistoryChoiceDetail> {
  if (policy.scholarSearchHistory !== "on" || !(await historySchema(admin))) return NOT_OFFERED;
  const c = await readConsent(admin, userId, SEARCH_HISTORY_FEATURE);
  if (!c.ok) return { offered: true, on: false, unreadable: true, grantedAt: null, revokedAt: null };
  return { offered: true, on: historyChoiceOn(c.data, consentDocuments(env).published), unreadable: false, grantedAt: c.data.grantedAt, revokedAt: c.data.revokedAt };
}
