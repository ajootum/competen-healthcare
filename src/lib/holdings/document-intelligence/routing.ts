import { refusal, type EngineCapability, type EngineHealth, type EngineRecord, type ProcessingRequest } from "./engine-registry";

// ── RESOURCE-AWARE ROUTING, FALLBACK AND RECOVERY ── COMPETEN-DIG-001 s5, s6, PHASE 1 ──────────────────────────────────────
//
// Pure. Given what exists, what was asked and how each engine stands, say what runs next, and why. It never runs anything.
//
//   * a reusable result always wins: no engine at all
//   * one engine at a time: the cheapest allowed that covers what is needed. Never several complete conversions by default
//   * a needed capability no single engine covers is planned as the smallest set of engines, cheapest first
//   * a fallback passes the same gate as the first choice (engine-registry.refusal), so it can never reach an AI or outside engine by itself
//   * every retry is counted against a limit. Past the limit the file stays as it is, and the affected units are named
//
// The stall, memory and concurrency checks themselves are the SCHOLAR-VISUAL-001 controls (slide-render.ts cpuStalled, admission, engine tries,
// low-memory stop). This file decides what happens after them.

export type Selection =
  | { action: "reuse"; conversionKey: string }
  | { action: "run"; engine: string; covers: EngineCapability[]; reasons: string[]; skipped: { engine: string; why: string }[] }
  | { action: "preserve"; missing: EngineCapability[]; skipped: { engine: string; why: string }[] };

/** Pure. The order engines are tried in: declared priority, then the least memory, then the quickest. Measured figures replace estimates once they exist. */
export const costRank = (e: EngineRecord): [number, number, number] => [e.priority, e.cost.measuredPeakMb ?? e.cost.estimatedMemoryMb, e.cost.measuredSeconds ?? e.cost.estimatedSeconds];
const byCost = (a: EngineRecord, b: EngineRecord) => {
  const x = costRank(a), y = costRank(b);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || a.id.localeCompare(b.id);
};

/** Pure. The engine to run next for what is still `needed`, or that nothing allowed can do it. */
export function selectEngine(input: {
  request: ProcessingRequest; engines: readonly EngineRecord[]; health: ReadonlyMap<string, EngineHealth>;
  /** The key of an authorised, complete conversion already held for these bytes under these rules. */
  reusable?: string | null;
  /** Engines that already failed this job: never tried twice through this path. Retries are counted apart (retryDecision). */
  tried?: readonly string[];
}): Selection {
  if (input.reusable) return { action: "reuse", conversionKey: input.reusable };
  const skipped: { engine: string; why: string }[] = [];
  const allowed: EngineRecord[] = [];
  for (const e of input.engines) {
    const why = input.tried?.includes(e.id) ? "already_tried" : refusal(e, input.request, input.health.get(e.id) ?? null);
    if (why) skipped.push({ engine: e.id, why });
    else if (!e.capabilities.some(c => input.request.needs.includes(c))) skipped.push({ engine: e.id, why: "no_needed_capability" });
    else if (input.tried?.length && !e.fallbackEligible) skipped.push({ engine: e.id, why: "not_fallback_eligible" });
    else allowed.push(e);
  }
  if (!allowed.length) return { action: "preserve", missing: [...input.request.needs], skipped };
  const best = [...allowed].sort(byCost)[0];
  return {
    action: "run", engine: best.id, covers: best.capabilities.filter(c => input.request.needs.includes(c)), skipped,
    reasons: [`priority ${best.priority}`, `about ${best.cost.measuredPeakMb ?? best.cost.estimatedMemoryMb} MB`, `about ${best.cost.measuredSeconds ?? best.cost.estimatedSeconds} s`],
  };
}

export type FailureKind = "error" | "timeout" | "stall" | "memory" | "quality" | "unavailable" | "incompatible";

/** Pure. Whether to run this engine again. Memory never: the same deck on the same box is the same answer, and a kill can take other requests with it. */
export function retryDecision(kind: FailureKind, attempts: number, limits: Pick<EngineRecord["limits"], "maxRetries">): "retry" | "fall_back" {
  if (kind === "memory" || kind === "quality" || kind === "incompatible" || kind === "unavailable") return "fall_back";
  return attempts <= limits.maxRetries ? "retry" : "fall_back";
}

export type Breaker = { failures: number; openedAt: number | null };
export const BREAKER = { failuresToOpen: 3, coolDownMs: 15 * 60_000 } as const;
export const NEW_BREAKER: Breaker = { failures: 0, openedAt: null };

/** Pure. A success closes it. The third failure in a row opens it. */
export function breakerAfter(b: Breaker, ok: boolean, nowMs: number): Breaker {
  if (ok) return NEW_BREAKER;
  const failures = b.failures + 1;
  return { failures, openedAt: failures >= BREAKER.failuresToOpen ? (b.openedAt ?? nowMs) : b.openedAt };
}
/** Pure. Open until the cool-down passes. Then one job may try: its result closes or re-opens it. */
export function breakerHealth(b: Breaker, nowMs: number): EngineHealth {
  const until = b.openedAt === null ? null : b.openedAt + BREAKER.coolDownMs;
  return { open: until !== null && nowMs < until, failures: b.failures, until };
}

export type UnitOutcome = { n: number; ok: boolean; reason: string | null };

export type RecoveryPlan =
  /** Every unit passed. */
  | { action: "none" }
  /** Redo only these, with this engine. */
  | { action: "units"; engine: string; units: number[] }
  /** Too many failed to believe the rest, or no engine can target units: the whole file through this engine. */
  | { action: "document"; engine: string; units: number[] }
  /** Nothing allowed can help: keep the original, name what is affected, offer the learner's route. */
  | { action: "preserve"; units: number[] };

/** At or above this share of failed units, the fault is taken to be in the engine or the file, not in the units. */
export const WHOLE_DOCUMENT_SHARE = 0.5;

/** Pure. How to recover the units that failed: the units alone wherever the fallback can, for 3 of 38 slides, not a new run of 38. */
export function recoveryPlan(outcomes: readonly UnitOutcome[], fallback: EngineRecord | null): RecoveryPlan {
  const failed = outcomes.filter(o => !o.ok).map(o => o.n);
  if (!failed.length) return { action: "none" };
  if (!fallback) return { action: "preserve", units: failed };
  if (!fallback.unitRecovery || failed.length / outcomes.length >= WHOLE_DOCUMENT_SHARE) return { action: "document", engine: fallback.id, units: failed };
  return { action: "units", engine: fallback.id, units: failed };
}
