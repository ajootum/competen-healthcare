/* eslint-disable @typescript-eslint/no-explicit-any */
import { aiFairUseEnabled } from "./allowance";

// ── SQIE COST PER EVALUATED ANSWER AND PER COMPLETED SESSION ── SQIE-CLOSE-2026-11 WS-G (owner directive s8, s9) ──────────
//
// "Measure cost per generated question, evaluated answer and completed assessment where the data is available." Cost per
// generated (accepted) question is already measured per format (sqie-monitoring.ts). This adds the other two, from the AI
// usage LEDGER (410/421: what was settled), never estimated:
//   per evaluated answer      settled Scholar `evaluate` spend / the evaluated answers it settled (one student action is
//                             one request id; parts of the same action, `:part` suffixes, are one answer)
//   per completed session     settled Scholar `questions` + `evaluate` spend in the window / revision sessions and adaptive
//                             exams completed in the window (audit individual_scholar_revision_completed). A WINDOW RATIO,
//                             labelled so: the ledger records no session id for a Scholar request.
// ⚠ METERING OFF IS NOT ZERO. With the ai_fair_use flag off (production today) the ledger records nothing, so every figure
// is { measured: false, reason } and the page says "metering off, no data". It is never shown as $0.
// ⚠ AGGREGATES ONLY. The ledger is read for activity, request id, status, cost and time: no user id, no account, no content.

export const SQIE_COST_DAYS = 30;
const COST_ACTIVITIES = ["questions", "evaluate"] as const;

export type CostFigure = { measured: true; usd: number; cau: number; per: number; n: number } | { measured: false; reason: string };
export type SqieCost = { days: number; meteringOn: boolean; perEvaluatedAnswer: CostFigure; perCompletedSession: CostFigure & { basis?: string }; adaptiveCompleted: number | null; truncated: boolean };

const round = (n: number, d = 6) => Math.round(n * 10 ** d) / 10 ** d;
/** Pure. The answer a ledger request id belongs to: the id before any `:part` or `:callKey` suffix. */
export const actionOfRequest = (requestId: string) => requestId.split(":")[0];

/** Pure. The two figures from settled ledger rows and the completed-session audit rows. */
export function summariseSqieCost(input: {
  meteringOn: boolean; ledger: readonly { request_id: string; activity: string; cost_usd: number | string | null; settled_cau: number | string | null }[] | null;
  completed: readonly { new_value: Record<string, unknown> | null }[] | null; days: number; truncated?: boolean;
}): SqieCost {
  const off = { measured: false as const, reason: "AI metering is off on this environment, so the ledger records no spend: no data (not zero)." };
  if (!input.meteringOn) return { days: input.days, meteringOn: false, perEvaluatedAnswer: off, perCompletedSession: off, adaptiveCompleted: null, truncated: false };
  const unreadable = { measured: false as const, reason: "The AI usage ledger could not be read just now." };
  if (!input.ledger) return { days: input.days, meteringOn: true, perEvaluatedAnswer: unreadable, perCompletedSession: unreadable, adaptiveCompleted: null, truncated: false };
  const usd = (rs: readonly { cost_usd: unknown }[]) => rs.reduce((n, r) => n + (Number(r.cost_usd ?? 0) || 0), 0);
  const cau = (rs: readonly { settled_cau: unknown }[]) => rs.reduce((n, r) => n + (Number(r.settled_cau ?? 0) || 0), 0);
  const ev = input.ledger.filter(r => r.activity === "evaluate");
  const answers = new Set(ev.map(r => actionOfRequest(r.request_id))).size;
  const perEvaluatedAnswer: CostFigure = answers
    ? { measured: true, usd: round(usd(ev)), cau: round(cau(ev), 4), per: round(usd(ev) / answers), n: answers }
    : { measured: false, reason: "No answer was evaluated by AI in this window." };
  let perCompletedSession: SqieCost["perCompletedSession"];
  if (!input.completed) perCompletedSession = { measured: false, reason: "Completed sessions could not be counted just now." };
  else if (!input.completed.length) perCompletedSession = { measured: false, reason: "No revision session or adaptive exam was completed in this window." };
  else {
    const all = input.ledger.filter(r => (COST_ACTIVITIES as readonly string[]).includes(r.activity));
    perCompletedSession = { measured: true, usd: round(usd(all)), cau: round(cau(all), 4), per: round(usd(all) / input.completed.length), n: input.completed.length,
      basis: `Settled question-writing and answer-evaluation spend in the last ${input.days} days, divided by the ${input.completed.length} session${input.completed.length === 1 ? "" : "s"} completed in them (a window ratio: Scholar requests carry no session id).` };
  }
  return {
    days: input.days, meteringOn: true, perEvaluatedAnswer, perCompletedSession,
    adaptiveCompleted: input.completed ? input.completed.filter(a => a.new_value?.adaptive === true).length : null, truncated: !!input.truncated,
  };
}

/** Reads the window. A source that cannot be read is "not measured", never zero. */
export async function loadSqieCost(admin: any, days = SQIE_COST_DAYS): Promise<SqieCost> {
  const meteringOn = await aiFairUseEnabled(admin);
  if (!meteringOn) return summariseSqieCost({ meteringOn, ledger: null, completed: null, days });
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const LIMIT = 50000;
  const [led, aud] = await Promise.all([
    admin.from("ai_usage_ledger").select("request_id, activity, cost_usd, settled_cau").eq("product", "scholar").eq("status", "settled")
      .in("activity", COST_ACTIVITIES as unknown as string[]).gte("created_at", since).limit(LIMIT),
    admin.from("audit_log").select("new_value").eq("action", "individual_scholar_revision_completed").gte("created_at", since).limit(LIMIT),
  ]);
  return summariseSqieCost({
    meteringOn, ledger: led.error ? null : led.data ?? [], completed: aud.error ? null : aud.data ?? [], days,
    truncated: [led, aud].some(r => (r.data?.length ?? 0) >= LIMIT),
  });
}
