import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import {
  parameterLibrary, monitoringPlan, encounterParameters, parameterSeries,
  setActivation, createDefinition, setDefinitionStatus,
  createPack, setPackItem, installPack,
  upsertPlanEntry, restoreInherited, requireForSafety,
  recordMeasurement, resolveAlert, addEncounterParameter,
} from "@/lib/practice/parameters";
import {
  PARAMETER_CATEGORIES, PARAMETER_DATA_TYPES, COLLECTION_RULES, PLAN_STATES, PLAN_SCHEDULES,
  ALERT_TYPES, ALERT_SEVERITIES, MEASUREMENT_SOURCES, RISK_CLASSES, CONFIG_LEVELS,
  PARAMETER_REFUSALS,
} from "@/lib/practice/parameters-constants";

// CPR-LCP-001 -- the one API for the three surfaces s10 names.
//
//   GET    ?view=library                         s10.1  the Clinical Parameters page
//   GET    ?view=plan&patientId=                 s10.2  a patient's Monitoring Plan
//   GET    ?view=encounter&encounterId=          s10.3  the encounter collection form
//   GET    ?view=series&patientId=&definitionId= the raw measurement series (no centile bands)
//
//   POST   {action:"activate"|"deactivate"|"defineParameter"|"setDefinitionStatus"
//                 |"createPack"|"setPackItem"|"installPack"}          parameter.configure / pack.install
//   POST   {action:"setPlan"|"restoreInherited"|"requireForSafety"}   parameter.configure
//   POST   {action:"record"|"amend"|"retract"|"resolveAlert"
//                 |"addToEncounter"}                                  parameter.record
//
// ⚠ THE CAPABILITY IS DECLARED AS AN INLINE LITERAL AT EVERY requirePracticeContext CALL, and that is
// deliberate rather than tidy. practice-audit-harness.ts's capabilityCodesInSource() matches only an
// inline double-quoted literal; a code passed through a constant is invisible to it, and an invented
// capability code compiles, reviews clean, and returns 403 for every user including the owner. All four
// codes here are seeded by migration 246 s11, and PARAMETER_CAPABILITIES is asserted against the
// catalogue in the parameters harness as well.
//
// EVERY WRITE IS GATED IN THE ENGINE TOO, so a second caller cannot bypass this route.

export const dynamic = "force-dynamic";

const fail = (r: { code: string; message: string; status: number }) =>
  NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const bounds = (v: unknown): { low: number | null; high: number | null } | null => {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const low = num(o.low), high = num(o.high);
  return low === null && high === null ? null : { low, high };
};

/** The vocabularies every editor on the three surfaces needs, sent with every GET. */
const VOCABULARY = {
  categories: PARAMETER_CATEGORIES, dataTypes: PARAMETER_DATA_TYPES,
  collectionRules: COLLECTION_RULES, planStates: PLAN_STATES, schedules: PLAN_SCHEDULES,
  alertTypes: ALERT_TYPES, alertSeverities: ALERT_SEVERITIES, sources: MEASUREMENT_SOURCES,
  riskClasses: RISK_CLASSES, configLevels: CONFIG_LEVELS,
  // ⚠ THE REFUSALS TRAVEL WITH THE PAYLOAD. A screen that simply lacks a centile chart looks like a
  // screen that has not finished loading; one that carries the reason is telling the truth.
  refusals: PARAMETER_REFUSALS,
};

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("parameter.view");
  if (isDenied(auth)) return auth;

  const url = new URL(req.url);
  const view = url.searchParams.get("view") ?? "library";
  const { admin } = auth.caller;
  const correlationId = auth.caller.traceId;

  if (view === "plan") {
    const patientId = url.searchParams.get("patientId");
    if (!patientId) return NextResponse.json({ error: "patientId is required" }, { status: 400 });
    const plan = await monitoringPlan(admin, auth.ctx, patientId);
    return NextResponse.json({ plan, vocabulary: VOCABULARY, correlationId });
  }

  if (view === "encounter") {
    const encounterId = url.searchParams.get("encounterId");
    if (!encounterId) return NextResponse.json({ error: "encounterId is required" }, { status: 400 });
    const collection = await encounterParameters(admin, auth.ctx, encounterId);
    return NextResponse.json({ collection, vocabulary: VOCABULARY, correlationId });
  }

  if (view === "series") {
    const patientId = url.searchParams.get("patientId");
    const definitionId = url.searchParams.get("definitionId");
    if (!patientId || !definitionId)
      return NextResponse.json({ error: "patientId and definitionId are required" }, { status: 400 });
    const series = await parameterSeries(admin, auth.ctx, patientId, definitionId);
    return NextResponse.json({ series, vocabulary: VOCABULARY, correlationId });
  }

  const library = await parameterLibrary(admin, auth.ctx);
  return NextResponse.json({ library, vocabulary: VOCABULARY, correlationId });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const action = String(body.action ?? "");

  // ── The configuration half. LCP s11: "Practitioners may activate packs and define their practice
  //    defaults." ────────────────────────────────────────────────────────────────────────────────────
  if (["activate", "deactivate", "defineParameter", "setDefinitionStatus",
    "setPlan", "restoreInherited", "requireForSafety"].includes(action)) {
    const auth = await requirePracticeContext("parameter.configure");
    if (isDenied(auth)) return auth;
    const base = { actorId: auth.ctx.userId, correlationId: auth.caller.traceId };
    const { admin } = auth.caller;

    if (action === "activate" || action === "deactivate") {
      const r = await setActivation(admin, auth.ctx, {
        definitionId: String(body.definitionId ?? ""),
        scope: body.scope as never, scopeId: body.scopeId ? String(body.scopeId) : undefined,
        state: action === "activate" ? "active" : "inactive",
        collectionRule: body.collectionRule ? String(body.collectionRule) : null,
        localLabel: body.localLabel ? String(body.localLabel) : null,
        visibility: body.visibility === "practitioner_only" ? "practitioner_only" : "team",
        threshold: bounds(body.threshold),
        ...base,
      });
      return r.ok ? NextResponse.json(r.data) : fail(r);
    }

    if (action === "defineParameter") {
      const r = await createDefinition(admin, auth.ctx, {
        code: String(body.code ?? ""), displayName: String(body.displayName ?? ""),
        shortName: body.shortName ? String(body.shortName) : null,
        synonyms: Array.isArray(body.synonyms) ? body.synonyms.map(String) : undefined,
        category: String(body.category ?? "custom"), dataType: String(body.dataType ?? "decimal"),
        canonicalUnit: body.canonicalUnit ? String(body.canonicalUnit) : null,
        permittedUnits: Array.isArray(body.permittedUnits) ? body.permittedUnits.map(String) : undefined,
        unitConversions: body.unitConversions as Record<string, number> | undefined,
        options: body.options as { value: string; label: string }[] | undefined,
        precision: num(body.precision), minPlausible: num(body.minPlausible), maxPlausible: num(body.maxPlausible),
        defaultCollectionRule: body.defaultCollectionRule ? String(body.defaultCollectionRule) : undefined,
        formula: body.formula ? String(body.formula) : null,
        riskClass: body.riskClass ? String(body.riskClass) : undefined,
        licenceRequired: body.licenceRequired === true,
        licenceReference: body.licenceReference ? String(body.licenceReference) : null,
        cloneOf: body.cloneOf ? String(body.cloneOf) : null,
        ...base,
      });
      return r.ok ? NextResponse.json(r.data, { status: 201 }) : fail(r);
    }

    if (action === "setDefinitionStatus") {
      const r = await setDefinitionStatus(admin, auth.ctx, {
        definitionId: String(body.definitionId ?? ""),
        status: String(body.status ?? "") as "draft" | "active" | "retired",
        changeNote: String(body.changeNote ?? ""), ...base,
      });
      return r.ok ? NextResponse.json(r.data) : fail(r);
    }

    if (action === "setPlan") {
      const r = await upsertPlanEntry(admin, auth.ctx, {
        patientId: String(body.patientId ?? ""), definitionId: String(body.definitionId ?? ""),
        state: body.state ? String(body.state) : undefined,
        schedule: body.schedule ? String(body.schedule) : null,
        untilDate: body.untilDate ? String(body.untilDate) : null,
        encountersRemaining: num(body.encountersRemaining),
        pausedUntil: body.pausedUntil ? String(body.pausedUntil) : null,
        targetLow: num(body.targetLow), targetHigh: num(body.targetHigh),
        improvingDirection: body.improvingDirection === "up" || body.improvingDirection === "down"
          ? body.improvingDirection : null,
        triggerSource: body.triggerSource ? String(body.triggerSource) : undefined,
        triggerRef: body.triggerRef ? String(body.triggerRef) : null,
        reason: String(body.reason ?? ""), ...base,
      });
      return r.ok ? NextResponse.json(r.data) : fail(r);
    }

    if (action === "restoreInherited") {
      const r = await restoreInherited(admin, auth.ctx, {
        patientId: String(body.patientId ?? ""), definitionId: String(body.definitionId ?? ""),
        reason: String(body.reason ?? ""), ...base,
      });
      return r.ok ? NextResponse.json(r.data) : fail(r);
    }

    const r = await requireForSafety(admin, auth.ctx, {
      patientId: String(body.patientId ?? ""), definitionId: String(body.definitionId ?? ""),
      reason: String(body.reason ?? ""),
      triggerSource: body.triggerSource as never, triggerRef: body.triggerRef ? String(body.triggerRef) : null,
      ...base,
    });
    return r.ok ? NextResponse.json(r.data) : fail(r);
  }

  // ── The pack half. CPL s2, s24: installing and cloning is pack.install. ─────────────────────────────
  if (["createPack", "setPackItem", "installPack"].includes(action)) {
    const auth = await requirePracticeContext("pack.install");
    if (isDenied(auth)) return auth;
    const base = { actorId: auth.ctx.userId, correlationId: auth.caller.traceId };
    const { admin } = auth.caller;

    if (action === "createPack") {
      const r = await createPack(admin, auth.ctx, {
        code: String(body.code ?? ""), name: String(body.name ?? ""),
        specialty: body.specialty ? String(body.specialty) : null,
        description: body.description ? String(body.description) : null,
        cloneOf: body.cloneOf ? String(body.cloneOf) : null, ...base,
      });
      return r.ok ? NextResponse.json(r.data, { status: 201 }) : fail(r);
    }
    if (action === "setPackItem") {
      const r = await setPackItem(admin, auth.ctx, {
        packId: String(body.packId ?? ""), definitionId: String(body.definitionId ?? ""),
        localLabel: body.localLabel ? String(body.localLabel) : null,
        collectionRule: body.collectionRule ? String(body.collectionRule) : null,
        position: num(body.position) ?? 0, enabled: body.enabled !== false, ...base,
      });
      return r.ok ? NextResponse.json(r.data) : fail(r);
    }
    const r = await installPack(admin, auth.ctx, {
      packId: String(body.packId ?? ""),
      scope: body.scope as never, scopeId: body.scopeId ? String(body.scopeId) : undefined, ...base,
    });
    return r.ok ? NextResponse.json(r.data) : fail(r);
  }

  // ── The collection half. LCP s11: "Authorised team members may collect values but cannot necessarily
  //    change definitions or thresholds." ─────────────────────────────────────────────────────────────
  if (["record", "amend", "retract", "resolveAlert", "addToEncounter"].includes(action)) {
    const auth = await requirePracticeContext("parameter.record");
    if (isDenied(auth)) return auth;
    const base = { actorId: auth.ctx.userId, correlationId: auth.caller.traceId };
    const { admin } = auth.caller;

    if (action === "resolveAlert") {
      const r = await resolveAlert(admin, auth.ctx, {
        alertId: String(body.alertId ?? ""),
        status: String(body.status ?? "acknowledged") as never,
        overrideReason: body.overrideReason ? String(body.overrideReason) : null, ...base,
      });
      return r.ok ? NextResponse.json(r.data) : fail(r);
    }

    if (action === "addToEncounter") {
      const r = await addEncounterParameter(admin, auth.ctx, {
        encounterId: String(body.encounterId ?? ""), definitionId: String(body.definitionId ?? ""),
        reason: body.reason ? String(body.reason) : null, ...base,
      });
      return r.ok ? NextResponse.json(r.data, { status: 201 }) : fail(r);
    }

    // ⚠ record, amend AND retract ALL INSERT. Migration 246 s8: the measurement table has no updated_at
    // and nothing may update it. A correction is a new row naming the old one; a retraction is the same
    // act with no replacement value. There is no PATCH on this route for that reason.
    const r = await recordMeasurement(admin, auth.ctx, {
      patientId: String(body.patientId ?? ""), definitionId: String(body.definitionId ?? ""),
      encounterId: body.encounterId ? String(body.encounterId) : null,
      value: action === "retract" ? null : (body.value as never),
      unit: body.unit ? String(body.unit) : null,
      method: body.method ? String(body.method) : null,
      source: body.source ? String(body.source) : undefined,
      effectiveAt: body.effectiveAt ? String(body.effectiveAt) : null,
      note: body.note ? String(body.note) : null,
      amendsMeasurementId: body.amendsMeasurementId ? String(body.amendsMeasurementId) : null,
      amendmentReason: body.amendmentReason ? String(body.amendmentReason) : null,
      enteredInError: action === "retract",
      ...base,
    });
    return r.ok ? NextResponse.json(r.data, { status: 201 }) : fail(r);
  }

  return NextResponse.json({ error: `unknown action "${action}"` }, { status: 400 });
}
