import { SEARCH_HISTORY_NOTICE, SEARCH_HISTORY_NOTICE_V1, SEARCH_HISTORY_NOTICE_V1_VERSION, SEARCH_HISTORY_NOTICE_VERSION } from "../individual/scholar/config";

// PRIVACY NOTICE SUPPLEMENT: MY SEARCH HISTORY -- owner pilot GO, 5 Nov 2026, item 5, and on by default after a one-time notice (owner, 5 Nov 2026).
//
// The published Individual Privacy Notice does not say that submitted searches and Ask Scholar questions are kept, and a new version of it
// would close Scholar until each person accepted again. So this sits beside it: its own stable page, linked from the notice's page, changing
// that notice's text, version and acceptance state in no way. Each body IS that notice version (config.ts), so there is one source. No version of the
// Terms or the Privacy Notice refers to it, and nothing reads it to decide access. Client-safe: config.ts imports nothing.
//
// A VERSION IS PERMANENT. /legal/search-history is the current one, and /legal/search-history/<key> serves each one for good. Add a new one at the end.

export type SearchHistorySupplement = { key: string; title: string; date: string; version: string; applies: string; body: readonly string[] };

export const SEARCH_HISTORY_SUPPLEMENT_PATH = "/legal/search-history";
const body = (n: typeof SEARCH_HISTORY_NOTICE | typeof SEARCH_HISTORY_NOTICE_V1) => [n.kept, n.notKept, n.howLong, n.who, n.patient, n.off];
const TITLE = "Privacy Notice supplement: My Search History";

export const SEARCH_HISTORY_SUPPLEMENTS: readonly SearchHistorySupplement[] = [
  {
    key: "notice-v1", title: TITLE, date: "5 November 2026", version: SEARCH_HISTORY_NOTICE_V1_VERSION,
    applies: "This supplement applies only to learners who turn on My Search History in Competen Scholar. It adds to the Competen Individual Privacy Notice and does not change it.",
    body: body(SEARCH_HISTORY_NOTICE_V1),
  },
  {
    key: "notice-v2", title: TITLE, date: "5 November 2026", version: SEARCH_HISTORY_NOTICE_VERSION,
    applies: "This supplement applies to learners in Competen Scholar where My Search History is offered. It adds to the Competen Individual Privacy Notice and does not change it.",
    body: body(SEARCH_HISTORY_NOTICE),
  },
];

/** The current supplement: what the setting and the legal pages link to. */
export const SEARCH_HISTORY_SUPPLEMENT = SEARCH_HISTORY_SUPPLEMENTS[SEARCH_HISTORY_SUPPLEMENTS.length - 1];
export const supplementPath = (key: string) => `${SEARCH_HISTORY_SUPPLEMENT_PATH}/${key}`;
