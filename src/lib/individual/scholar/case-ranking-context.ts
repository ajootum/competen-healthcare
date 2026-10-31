// ── WHAT RANKS THE LIBRARY CASES OFFERED TO A LEARNER ── SCHOLAR-INTELLIGENCE-COMPLETE-01 ────────────────────────────
//
// The learner's latest saved evaluation already names their gaps (evaluation.ts: areas needing work). Ranking
// (src/lib/cases/ranking.ts) uses them to put a case that teaches a gap first. One bounded read through store.ts, the
// caller's own record only; anything missing or unreadable is simply no gap context (the offer is then ranked by the
// competency and topic asked for). It never filters a case out and never blocks an offer.

import { gapsFromResults, type RankGaps } from "@/lib/cases/ranking";
import { listEvaluations } from "./store";

export async function latestGaps(admin: unknown, userId: string): Promise<RankGaps | undefined> {
  try {
    const r = await listEvaluations(admin, userId, 1);
    return r.ok && r.data[0] ? gapsFromResults(r.data[0].results) : undefined;
  } catch { return undefined; }
}
