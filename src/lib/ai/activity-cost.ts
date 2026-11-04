/* eslint-disable @typescript-eslint/no-explicit-any */
import { aiFairUseEnabled } from "./allowance";
import { activityOf } from "./outcomes";
import { loadSqieCost, type CostFigure, type SqieCost } from "./sqie-cost";

// ── SCHOLAR COST AND LATENCY PER USEFUL ACTIVITY ── SALE-2026-11 R5, tracker row SALE-16 (owner directive s10.1, s10.3) ──────
//
// "AI cost efficiency: measure cost relative to useful learning activity." Built on what is already recorded, never estimated:
//   cost per evaluated answer, per completed session   sqie-cost.ts (settled ledger, WS-G), reused unchanged
//   cost per lesson taught                             settled ledger spend on Learn teaching activities (teach, explain,
//                                                      simplify, deeper, examples, summary) / lessons DELIVERED in the
//                                                      window: generated and shown (audit ai_assistant_query, outcome shown)
//                                                      plus served from a saved lesson with no AI (audit scholar_learn_served).
//                                                      A window ratio, labelled so: a ledger row carries no lesson id.
//   reuse against new generation                       lessons served from saved / lessons delivered. From the audit trail,
//                                                      so it is measured whether metering is on or off.
//   latency p50 and p90 per activity                    the AI gateway log (plat_ai_requests.latency_ms, status ok) grouped by
//                                                      activity. Also recorded whether metering is on or off.
// ⚠ METERING OFF IS NOT ZERO. With ai_fair_use off (production until after 20 Nov) the ledger records nothing: every cost
// figure is { measured: false } and the page says "Metering off, no data". It is never shown as $0.
// ⚠ AGGREGATES ONLY. Ledger: activity, request id, cost. Audit: the action code, outcome and lesson action. Gateway: operation,
// latency, status. No user id, no account, no content is selected.

export const ACTIVITY_COST_DAYS = 30;
export const LESSON_ACTIVITIES = ["teach", "explain", "simplify", "deeper", "examples", "summary"] as const;
export const LEARN_AUDIT_ACTIONS = { generated: "ai_assistant_query", served: "scholar_learn_served" } as const;
export const LEARN_AUDIT_ENTITY = "individual_scholar_learn";
/** Below this many gateway calls a latency percentile is shown with a small-sample note. */
export const LATENCY_SMALL_N = 20;
export const METERING_OFF = "Metering off, no data. AI metering is off on this environment, so the ledger records no spend (this is not zero).";

export type Latency = { activity: string; n: number; p50: number; p90: number; small: boolean };
export type ReuseShare = { measured: true; served: number; generated: number; percent: number } | { measured: false; reason: string };
export type ActivityCost = {
  days: number; meteringOn: boolean;
  perEvaluatedAnswer: CostFigure; perCompletedSession: SqieCost["perCompletedSession"];
  perLessonTaught: CostFigure & { basis?: string };
  reuse: ReuseShare;
  latency: { measured: true; rows: Latency[] } | { measured: false; reason: string };
  truncated: boolean;
};

const round = (n: number, d = 6) => Math.round(n * 10 ** d) / 10 ** d;

/** Pure. Nearest-rank percentile of a sorted list (p in 0..100). */
export function percentile(sorted: readonly number[], p: number): number {
  if (!sorted.length) return NaN;
  const k = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[k];
}

/** Pure. The activity a gateway operation measures: no product prefix, no `:action` suffix, verification counted with what it checks. */
export const latencyActivityOf = (operation: string | null) => activityOf((operation ?? "unknown").split(":")[0]);

/** Pure. p50 and p90 per activity from gateway rows (successful calls with a latency only). */
export function summariseLatency(rows: readonly { operation: string | null; latency_ms: number | string | null; status: string | null }[]): Latency[] {
  const by = new Map<string, number[]>();
  for (const r of rows) {
    // Number(null) and Number("") are 0: a call with no recorded latency is skipped, never counted as instant.
    const ms = r.latency_ms === null || r.latency_ms === "" ? NaN : Number(r.latency_ms);
    if (r.status !== "ok" || !Number.isFinite(ms) || ms < 0) continue;
    const a = latencyActivityOf(r.operation);
    by.set(a, [...(by.get(a) ?? []), ms]);
  }
  return [...by.entries()].map(([activity, xs]) => {
    const s = [...xs].sort((a, b) => a - b);
    return { activity, n: s.length, p50: Math.round(percentile(s, 50)), p90: Math.round(percentile(s, 90)), small: s.length < LATENCY_SMALL_N };
  }).sort((a, b) => b.n - a.n || a.activity.localeCompare(b.activity));
}

type TrailRow = { action: string; act: string | null; outcome: string | null };

/** Pure. Lessons delivered in the window: generated (shown) and served from saved, teaching actions only. */
export function lessonsDelivered(trail: readonly TrailRow[]): { generated: number; served: number } {
  const lesson = (a: string | null) => !!a && (LESSON_ACTIVITIES as readonly string[]).includes(a);
  let generated = 0, served = 0;
  for (const t of trail) {
    if (!lesson(t.act)) continue;
    if (t.action === LEARN_AUDIT_ACTIONS.served) served++;
    else if (t.action === LEARN_AUDIT_ACTIONS.generated && t.outcome === "shown") generated++;
  }
  return { generated, served };
}

/** Pure. The SALE-16 figures from the window's rows. A source that could not be read is "not measured", never zero. */
export function summariseActivityCost(input: {
  meteringOn: boolean; days: number; sqie: SqieCost;
  ledger: readonly { activity: string; cost_usd: number | string | null; settled_cau: number | string | null }[] | null;
  trail: readonly TrailRow[] | null;
  gateway: readonly { operation: string | null; latency_ms: number | string | null; status: string | null }[] | null;
  truncated?: boolean;
}): ActivityCost {
  const off = { measured: false as const, reason: METERING_OFF };
  const lessons = input.trail ? lessonsDelivered(input.trail) : null;
  const delivered = lessons ? lessons.generated + lessons.served : 0;
  const reuse: ReuseShare = !lessons ? { measured: false, reason: "The Learn audit trail could not be read just now." }
    : !delivered ? { measured: false, reason: "No lesson was delivered in this window." }
    : { measured: true, served: lessons.served, generated: lessons.generated, percent: Math.round((100 * lessons.served) / delivered) };
  let perLessonTaught: ActivityCost["perLessonTaught"];
  if (!input.meteringOn) perLessonTaught = off;
  else if (!input.ledger) perLessonTaught = { measured: false, reason: "The AI usage ledger could not be read just now." };
  else if (!lessons) perLessonTaught = { measured: false, reason: "Lessons delivered could not be counted just now." };
  else if (!delivered) perLessonTaught = { measured: false, reason: "No lesson was delivered in this window." };
  else {
    const rs = input.ledger.filter(r => (LESSON_ACTIVITIES as readonly string[]).includes(r.activity));
    const usd = rs.reduce((n, r) => n + (Number(r.cost_usd ?? 0) || 0), 0);
    const cau = rs.reduce((n, r) => n + (Number(r.settled_cau ?? 0) || 0), 0);
    perLessonTaught = { measured: true, usd: round(usd), cau: round(cau, 4), per: round(usd / delivered), n: delivered,
      basis: `Settled Learn teaching spend in the last ${input.days} days, divided by the ${delivered} lesson${delivered === 1 ? "" : "s"} delivered in them (${lessons.generated} generated, ${lessons.served} served from saved with no AI). A window ratio: a ledger row carries no lesson id.` };
  }
  const latency: ActivityCost["latency"] = !input.gateway ? { measured: false, reason: "The AI gateway log could not be read just now." }
    : (() => { const rows = summariseLatency(input.gateway); return rows.length ? { measured: true as const, rows } : { measured: false as const, reason: "No successful Scholar AI call was logged in this window." }; })();
  return {
    days: input.days, meteringOn: input.meteringOn,
    perEvaluatedAnswer: input.meteringOn ? input.sqie.perEvaluatedAnswer : off,
    perCompletedSession: input.meteringOn ? input.sqie.perCompletedSession : off,
    perLessonTaught, reuse, latency, truncated: !!input.truncated || input.sqie.truncated,
  };
}

/** Pure. A cost figure in words: metering off and unmeasured are never "$0". */
export const costText = (f: CostFigure) => (f.measured ? `$${f.per.toFixed(4)} each (n=${f.n}, $${f.usd.toFixed(2)} in all)` : f.reason);

/** Reads the window. Never throws. */
export async function loadActivityCost(admin: any, days = ACTIVITY_COST_DAYS): Promise<ActivityCost> {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const LIMIT = 50000;
  const safe = async (p: PromiseLike<any>) => { try { return await p; } catch (e) { return { data: null, error: e }; } };
  const [meteringOn, sqie] = await Promise.all([aiFairUseEnabled(admin), loadSqieCost(admin, days)]);
  const [led, trail, gw] = await Promise.all([
    meteringOn
      ? safe(admin.from("ai_usage_ledger").select("activity, cost_usd, settled_cau").eq("product", "scholar").eq("status", "settled")
        .in("activity", LESSON_ACTIVITIES as unknown as string[]).gte("created_at", since).limit(LIMIT))
      : Promise.resolve({ data: [], error: null }),
    safe(admin.from("audit_log").select("action, act:new_value->>action, outcome:new_value->>outcome").eq("entity_type", LEARN_AUDIT_ENTITY)
      .in("action", [LEARN_AUDIT_ACTIONS.generated, LEARN_AUDIT_ACTIONS.served]).gte("created_at", since).limit(LIMIT)),
    safe(admin.from("plat_ai_requests").select("operation, latency_ms, status").like("operation", "individual_scholar%").gte("created_at", since).limit(LIMIT)),
  ]);
  return summariseActivityCost({
    meteringOn, days, sqie,
    ledger: led.error ? null : led.data ?? [], trail: trail.error ? null : trail.data ?? [], gateway: gw.error ? null : gw.data ?? [],
    truncated: [led, trail, gw].some(r => (r.data?.length ?? 0) >= LIMIT),
  });
}
