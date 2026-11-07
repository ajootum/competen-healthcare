import { CANONICAL_SCHEMA, CANONICAL_VERSION, conversionKey, validateCanonical, type CanonicalAsset, type CanonicalDocument, type CanonicalUnit, type EngineRun, type FidelityRequirement, type UnitKind } from "./canonical";
import { reconcile, unitsNeedingRecovery, type UnitFacts } from "./quality";
import { recoveryPlan, retryDecision, selectEngine, breakerAfter, breakerHealth, NEW_BREAKER, type Breaker, type FailureKind } from "./routing";
import type { EngineCapability, EngineRecord, Format, ProcessingRequest } from "./engine-registry";

// ── THE DOCUMENT INTELLIGENCE GATEWAY ── COMPETEN-DIG-001 s2, s5, s6, s8, PHASE 1 ─────────────────────────────────────────
//
// Original upload -> content identification -> engine selection -> conversion -> quality validation -> canonical storage -> reuse.
// The order of events only: everything that touches a file sits behind an adapter, everything that remembers sits behind a store, and every
// decision comes from routing.ts. The proof of concept runs it with real engines and fault injection. ⚠ NO ROUTE IMPORTS IT.

export class EngineFailure extends Error {
  constructor(public kind: FailureKind, detail?: string) { super(detail ?? kind); }
}

export type ConvertInput = { bytes: Uint8Array; format: Format; sourceSha256: string; units: readonly number[] | "all"; budgetMs: number };
export type ConvertOutput = { units: CanonicalUnit[]; assets: CanonicalAsset[]; version: string };
export type EngineAdapter = { id: string; convert: (input: ConvertInput) => Promise<ConvertOutput> };

/** What remembers. Phase 2: a database row per conversion and per unit. The proof of concept: files. */
export type ConversionStore = {
  complete: (key: string) => Promise<CanonicalDocument | null>;
  /** Units already converted and passed, from a job that died part way. */
  partial: (key: string) => Promise<{ units: CanonicalUnit[]; assets: CanonicalAsset[] } | null>;
  savePartial: (key: string, units: readonly CanonicalUnit[], assets: readonly CanonicalAsset[]) => Promise<void>;
  saveComplete: (key: string, doc: CanonicalDocument) => Promise<void>;
  /** At most one job per key. False: another holds it, and this one starts nothing. */
  claim: (key: string) => Promise<boolean>;
  release: (key: string) => Promise<void>;
};

export type GatewayInput = {
  bytes: Uint8Array; sourceSha256: string; format: Format; mime: string; unit: UnitKind; units: number;
  scope: string; requirement: FidelityRequirement; pipelineVersion: string; configVersion: number; needs: readonly EngineCapability[];
  /** What the file's own parts hold: read once, cheaply, before any engine. */
  facts: readonly UnitFacts[];
  budgetMs: number; minRecall: number;
};

export type GatewayDeps = { engines: readonly EngineRecord[]; adapters: ReadonlyMap<string, EngineAdapter>; store: ConversionStore; breakers: Map<string, Breaker>; now: () => number };

export type GatewayResult =
  | { outcome: "reused"; doc: CanonicalDocument; key: string; invocations: 0 }
  | { outcome: "in_progress"; key: string; invocations: 0 }
  | { outcome: "complete" | "partial" | "preserved"; doc: CanonicalDocument; key: string; invocations: number; log: EngineRun[]; unresolved: number[] };

const REQUEST_DEFAULTS = { learnerRequestedAi: false, learnerConsented: false } as const;

/** Never more engine runs than this in one job, whatever the configuration says. */
export const MAX_ENGINE_RUNS = 5;

export async function processDocument(input: GatewayInput, deps: GatewayDeps): Promise<GatewayResult> {
  const key = conversionKey({ sourceSha256: input.sourceSha256, pipelineVersion: input.pipelineVersion, requirement: input.requirement, scope: input.scope });
  const held = await deps.store.complete(key);
  if (held) return { outcome: "reused", doc: held, key, invocations: 0 };
  if (!(await deps.store.claim(key))) return { outcome: "in_progress", key, invocations: 0 };
  try {
    return await run(input, deps, key);
  } finally {
    await deps.store.release(key);
  }
}

async function run(input: GatewayInput, deps: GatewayDeps, key: string): Promise<GatewayResult> {
  const request: ProcessingRequest = { format: input.format, needs: input.needs, ...REQUEST_DEFAULTS };
  const started = deps.now();
  const log: EngineRun[] = [];
  const kept = new Map<number, CanonicalUnit>();
  const assets = new Map<string, CanonicalAsset>();
  const previous = await deps.store.partial(key);
  for (const u of previous?.units ?? []) kept.set(u.n, u);
  for (const a of previous?.assets ?? []) assets.set(a.id, a);
  const tried: string[] = [];
  const attempts = new Map<string, number>();
  let invocations = 0;
  let version = "";
  let current: readonly number[] | "all" = kept.size ? allUnits(input.units).filter(n => !kept.has(n)) : "all";

  const doc = (engines: EngineRun[]): CanonicalDocument => {
    const units = allUnits(input.units).map(n => kept.get(n) ?? { n, position: null, hidden: false, status: "failed" as const, engine: "none", blocks: [] });
    const base: CanonicalDocument = {
      schema: CANONICAL_SCHEMA, schemaVersion: CANONICAL_VERSION,
      source: { sha256: input.sourceSha256, bytes: input.bytes.byteLength, mime: input.mime, unit: input.unit, units: input.units },
      conversion: { key, pipelineVersion: input.pipelineVersion, configVersion: input.configVersion, requirement: input.requirement, engines },
      units, assets: [...assets.values()], interpretations: [], quality: { passed: false, textRecall: null, issues: [] },
    };
    return { ...base, quality: reconcile(base, input.facts, input.minRecall) };
  };

  while (invocations < MAX_ENGINE_RUNS && (current === "all" || current.length)) {
    const health = new Map(input.needs.length ? deps.engines.map(e => [e.id, breakerHealth(deps.breakers.get(e.id) ?? NEW_BREAKER, deps.now())]) : []);
    const choice = selectEngine({ request, engines: deps.engines, health, tried });
    if (choice.action !== "run") break;
    const adapter = deps.adapters.get(choice.engine);
    const record = deps.engines.find(e => e.id === choice.engine)!;
    if (!adapter) { tried.push(choice.engine); continue; }
    const budget = Math.min(record.limits.timeoutMs, input.budgetMs - (deps.now() - started));
    if (budget < 1000) break;
    const at = deps.now();
    invocations++;
    attempts.set(record.id, (attempts.get(record.id) ?? 0) + 1);
    try {
      const out = await adapter.convert({ bytes: input.bytes, format: input.format, sourceSha256: input.sourceSha256, units: current, budgetMs: budget });
      version = out.version;
      deps.breakers.set(record.id, breakerAfter(deps.breakers.get(record.id) ?? NEW_BREAKER, true, deps.now()));
      for (const a of out.assets) assets.set(a.id, a);
      const wanted = current === "all" ? null : new Set(current);
      for (const u of out.units) if (u.status !== "failed" && (!wanted || wanted.has(u.n)) && !kept.has(u.n)) kept.set(u.n, u);
      // Only a unit that passes is kept: anything the file holds that this unit lost goes round again, alone.
      const report = reconcile(doc(log), input.facts, input.minRecall);
      const needing = new Set(unitsNeedingRecovery(report).filter(n => report.issues.some(i => i.unit === n && (i.check === "text_completeness" || i.check === "table_structure"))));
      for (const n of needing) if (kept.get(n)?.engine === record.id && input.facts.some(f => f.n === n)) kept.delete(n);
      await deps.store.savePartial(key, [...kept.values()], [...assets.values()]);
      log.push({ engine: record.id, version, role: tried.length || current !== "all" ? "recovery" : "primary", units: current, ok: true, reason: null, ms: deps.now() - at, peakMb: null });
      tried.push(record.id);
      const outcomes = allUnits(input.units).map(n => ({ n, ok: kept.has(n), reason: null }));
      const next = selectEngine({ request, engines: deps.engines, health, tried });
      const plan = recoveryPlan(outcomes, next.action === "run" ? deps.engines.find(e => e.id === next.engine) ?? null : null);
      current = plan.action === "units" || plan.action === "document" ? plan.units : [];
    } catch (e) {
      const kind: FailureKind = e instanceof EngineFailure ? e.kind : "error";
      deps.breakers.set(record.id, breakerAfter(deps.breakers.get(record.id) ?? NEW_BREAKER, false, deps.now()));
      log.push({ engine: record.id, version: record.engineVersion, role: tried.length ? "fallback" : "primary", units: current, ok: false, reason: kind, ms: deps.now() - at, peakMb: null });
      if (retryDecision(kind, attempts.get(record.id) ?? 1, record.limits) === "fall_back") tried.push(record.id);
    }
  }

  const final = doc(log);
  const shape = validateCanonical(final);
  const unresolved = final.units.filter(u => u.status === "failed").map(u => u.n);
  if (!unresolved.length && !shape.length && final.quality.passed) {
    await deps.store.saveComplete(key, final);
    return { outcome: "complete", doc: final, key, invocations, log, unresolved };
  }
  await deps.store.savePartial(key, [...kept.values()], [...assets.values()]);
  return { outcome: kept.size ? "partial" : "preserved", doc: final, key, invocations, log, unresolved };
}

const allUnits = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
