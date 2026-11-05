import { SEARCH_HISTORY_NOTICE, SEARCH_HISTORY_NOTICE_VERSION } from "../individual/scholar/config";

// PRIVACY NOTICE SUPPLEMENT: MY SEARCH HISTORY -- owner pilot GO, 5 Nov 2026, item 5.
//
// The published Individual Privacy Notice does not say that submitted searches and Ask Scholar questions are kept, and a new version of it
// would close Scholar until each person accepted again. So this sits beside it: its own stable page, linked from the notice's page, changing
// that notice's text, version and acceptance state in no way. The body IS Notice v1 (config.ts), so there is one source. No version of the
// Terms or the Privacy Notice refers to it, and nothing reads it to decide access. Client-safe: config.ts imports nothing.

export const SEARCH_HISTORY_SUPPLEMENT_PATH = "/legal/search-history";
export const SEARCH_HISTORY_SUPPLEMENT = {
  title: "Privacy Notice supplement: My Search History",
  date: "5 November 2026",
  version: SEARCH_HISTORY_NOTICE_VERSION,
  applies: "This supplement applies only to learners who turn on My Search History in Competen Scholar. It adds to the Competen Individual Privacy Notice and does not change it.",
  body: [SEARCH_HISTORY_NOTICE.kept, SEARCH_HISTORY_NOTICE.notKept, SEARCH_HISTORY_NOTICE.howLong, SEARCH_HISTORY_NOTICE.who, SEARCH_HISTORY_NOTICE.patient, SEARCH_HISTORY_NOTICE.off],
} as const;
