/* eslint-disable @typescript-eslint/no-explicit-any */
import { decideReview } from "./clinical-review";
import { reviewQueue } from "./clinical-review-hq";

// ── APPROVING A FRAMEWORK'S COMPETENCIES TOGETHER ── owner directive, Framework Consolidation, 29 Oct 2026 ─────────
//
// A reviewer may approve many competencies of one framework in one act. It is a THIN COORDINATOR over the existing
// per-version decision (clinical-review.ts decideReview, migration 395): every competency still receives its OWN
// decision on its OWN exact content version, so each criterion stays traceable to the version it was approved at.
//
// ⚠ RE-CHECKED AGAINST THE REVIEWER'S QUEUE AT DECISION TIME. An item is decided only while it is still in this
// reviewer's queue (reviewQueue: current hash, in scope, independent -- they did not author, edit or put it forward --
// and not yet decided by them). Anything else is reported "no longer waiting", never decided. The 395 trigger still
// decides every write, so separation of duties holds even if this check were wrong.
//
// ⚠ APPROVAL ONLY. Asking for changes stays one competency at a time, because each request needs its own reason.

export type DecideItem = { versionId: string; competencyId: string };
export type DecideOutcome = { versionId: string; competencyId: string; title: string; outcome: "approved" | "not_waiting" | "failed" | "not_reached"; reason: string };

export async function approveMany(admin: any, reviewerId: string, items: DecideItem[], comment: string | null,
  opts: { budgetMs?: number; now?: () => number; decide?: typeof decideReview; queue?: typeof reviewQueue } = {}): Promise<DecideOutcome[] | null> {
  const now = opts.now ?? Date.now, started = now(), budget = opts.budgetMs ?? 40_000;
  const decide = opts.decide ?? decideReview, queue = opts.queue ?? reviewQueue;
  const q = await queue(admin, reviewerId);
  if (!q) return null;
  const waiting = new Map(q.items.filter(i => i.kind === "competency").map(i => [i.versionId, i]));
  const out: DecideOutcome[] = [];
  for (const it of items) {
    const w = waiting.get(it.versionId);
    const base = { versionId: it.versionId, competencyId: it.competencyId, title: w?.title ?? "A competency" };
    if (now() - started > budget) { out.push({ ...base, outcome: "not_reached", reason: "Not reached in this pass. Continue to record it." }); continue; }
    if (!w || w.competencyId !== it.competencyId) { out.push({ ...base, outcome: "not_waiting", reason: "No longer waiting for you: it changed, was decided, or is outside your scope. Nothing was recorded." }); continue; }
    const r = await decide(admin, it.versionId, reviewerId, w.appointmentId, "approved", comment);
    out.push(r.ok ? { ...base, outcome: "approved", reason: "Approved at this exact content version." } : { ...base, outcome: "failed", reason: r.error });
  }
  return out;
}
