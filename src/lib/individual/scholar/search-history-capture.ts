// SCHOLAR-SEARCH-HISTORY-01: the one browser-side call that keeps a SUBMITTED search or question in the learner's history
// (POST /api/individual/scholar/library/history). Client-safe, no AI. Called once per submission with that submission's own
// request key, so a retry is the same entry. Fire and forget: the route always answers 200 with { kept } (nothing kept when
// HQ has the history off or migration 992 is absent), so a capture never shows the learner an error or slows their answer.

import { newRequestKey, normaliseQuery, type CapturedActivity } from "./search-history";

export const HISTORY_ROUTE = "/api/individual/scholar/library/history";

export type CaptureRequest = {
  activity: CapturedActivity; query: string; requestKey?: string;
  materialId?: string | null; chunkId?: string | null; artefactId?: string | null; sessionId?: string | null; step?: number | null;
  topic?: string | null; resultCount?: number | null;
};

/** Keep one submitted search or question. Resolves to whether it was kept; never throws. */
export async function recordHistory(req: CaptureRequest, post: typeof fetch = fetch): Promise<boolean> {
  if (!normaliseQuery(req.query)) return false;
  const body = JSON.stringify({ ...req, requestKey: req.requestKey ?? newRequestKey() });
  // One retry on a network failure, with the SAME key: the server keeps it once.
  for (let i = 0; i < 2; i++) {
    try {
      const r = await post(HISTORY_ROUTE, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true });
      const j = await r.json().catch(() => ({}));
      return j?.kept === true;
    } catch { /* retried once below with the same key */ }
  }
  return false;
}
