import { SEARCH_HISTORY_FEATURE } from "./config";
import { consentDocuments, historyChoiceState, type HistoryChoiceState } from "./consent-gate";
import type { SearchHistoryChoice } from "./search-history";
import { historySchema, readConsent } from "./store";

// THE LEARNER'S OWN CHOICE -- owner decisions 5 Nov 2026 (My Search History privacy, then on by default after a one-time notice), migrations 993, 994.
//
// My Search History is OFFERED by HQ (policy scholar_search_history, with 992 present). For each learner their own consent row (feature
// scholar_search_history) decides, by historyChoiceState: nothing recorded means the notice is still to be seen, and nothing is kept. Having seen the
// notice (status notified, not an agreement) means on. Acting to keep it on means on. Acting to turn it off means off, for good. An unreadable row is
// off: not permission (ADR-015). This is the one place that says so, and the capture route and the pages all read it. AI help reads its own row
// (CONSENT_FEATURE) and never this one.

// SERVER-ONLY: consentDocuments reads process.env.

export type SearchHistoryChoiceDetail = SearchHistoryChoice & {
  state: HistoryChoiceState;
  /** The choice could not be read just now, so it counts as off, and the setting says so. */
  unreadable: boolean; grantedAt: string | null; revokedAt: string | null;
  /** When the learner saw the notice, for a learner who has it on because of that. */
  notifiedAt: string | null;
};

const NOT_OFFERED: SearchHistoryChoiceDetail = { offered: false, on: false, pending: false, state: "off", unreadable: false, grantedAt: null, revokedAt: null, notifiedAt: null };

export async function readSearchHistoryChoice(admin: Parameters<typeof readConsent>[0], userId: string, policy: { scholarSearchHistory: "on" | "off" }, env: Record<string, string | undefined> = process.env): Promise<SearchHistoryChoiceDetail> {
  if (policy.scholarSearchHistory !== "on" || !(await historySchema(admin))) return NOT_OFFERED;
  const c = await readConsent(admin, userId, SEARCH_HISTORY_FEATURE);
  if (!c.ok) return { ...NOT_OFFERED, offered: true, unreadable: true };
  const state = historyChoiceState(c.data, consentDocuments(env).published);
  return {
    offered: true, on: state === "on_by_notice" || state === "on_chosen", pending: state === "unseen", state, unreadable: false,
    grantedAt: c.data.grantedAt, revokedAt: c.data.revokedAt, notifiedAt: state === "on_by_notice" ? c.data.updatedAt : null,
  };
}
