import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import {
  patientMedications, medicationTimeline, medicationWorklist, medicationStorePresence,
  recordMedication, changeMedication, verifyMedication, carryForwardTreatment,
  calculateDose, setMedicationReview,
} from "@/lib/practice/medication";
import {
  MEDICATION_STATUSES, MEDICATION_SOURCES, MEDICATION_EVENT_TYPES, DOSE_BASES,
  DEFERRED_SAFETY_CHECKS, MEDICATION_REFUSALS, doseSafetyNotice, allergyDisplayNotice,
} from "@/lib/practice/medication-constants";
import { DOSE_UNIT_CONVERSION_REFUSED } from "@/lib/practice/clinical-calculators";

// CPR-MED-001 -- the one API for the medication record.
//
//   GET    ?view=patient&patientId=          s2 + reconciliation + the allergy display
//   GET    ?view=timeline&medicationId=      s6 the longitudinal timeline and its calculations
//   GET    ?view=worklist                    s7 reviews due, s9 favourites, the override register
//   GET    ?view=store                       is the migration applied
//
//   POST   {action:"record"|"change"|"carryForward"|"calculateDose"|"setReview"}  medication.record
//   POST   {action:"verify"}                                                     medication.override
//
// ⚠ THE CAPABILITY IS AN INLINE DOUBLE-QUOTED LITERAL AT EVERY requirePracticeContext CALL, and that is
// deliberate rather than tidy. practice-audit-harness.ts's capabilityCodesInSource() matches only an
// inline literal, a code passed through a constant is invisible to it, and an invented capability code
// compiles, reviews clean, and returns 403 for every user including the owner. Six have shipped in this
// codebase that way. MEDICATION_CAPABILITIES is asserted against the catalogue in the medication harness
// as the second half of the same guard.
//
// ⚠ ALL THREE CODES ARE SEEDED BY THE MIGRATION IN medication.ts's HEADER, WHICH IS NOT YET APPLIED.
// Until it is, these routes answer 403 for everybody -- which is why the store view exists and why every
// surface reads it before drawing anything.
//
// ⚠ AND THE DEFERRED CHECKS TRAVEL IN EVERY PAYLOAD. Not as documentation: a prescribing screen that
// simply lacked a warnings panel would look like a screen that found nothing wrong. VOCABULARY.notChecked
// is what it prints instead.

export const dynamic = "force-dynamic";

const fail = (r: { code: string; message: string; status: number }) =>
  NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const str = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s ? s : null;
};

/** The vocabularies and the refusals every medication surface needs, sent with every GET. */
const VOCABULARY = {
  statuses: MEDICATION_STATUSES, sources: MEDICATION_SOURCES,
  eventTypes: MEDICATION_EVENT_TYPES, doseBases: DOSE_BASES,
  // ⚠ THESE THREE ARE THE SAFETY CONTRACT OF THE PAYLOAD, not decoration.
  notChecked: DEFERRED_SAFETY_CHECKS,
  refusals: MEDICATION_REFUSALS,
  doseSafetyNotice: doseSafetyNotice(),
  allergyNotice: allergyDisplayNotice(),
  doseUnitConversion: DOSE_UNIT_CONVERSION_REFUSED,
};

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("medication.view");
  if (isDenied(auth)) return auth;

  const url = new URL(req.url);
  const view = url.searchParams.get("view") ?? "worklist";
  const { admin } = auth.caller;
  const correlationId = auth.caller.traceId;

  if (view === "store") {
    const store = await medicationStorePresence(admin);
    return NextResponse.json({ store, correlationId });
  }

  if (view === "patient") {
    const patientId = url.searchParams.get("patientId");
    if (!patientId) return NextResponse.json({ error: "patientId is required" }, { status: 400 });
    const record = await patientMedications(admin, auth.ctx, patientId);
    return NextResponse.json({ record, vocabulary: VOCABULARY, correlationId });
  }

  if (view === "timeline") {
    const medicationId = url.searchParams.get("medicationId");
    if (!medicationId) return NextResponse.json({ error: "medicationId is required" }, { status: 400 });
    const timeline = await medicationTimeline(admin, auth.ctx, medicationId);
    return NextResponse.json({ timeline, vocabulary: VOCABULARY, correlationId });
  }

  const worklist = await medicationWorklist(admin, auth.ctx);
  return NextResponse.json({ worklist, vocabulary: VOCABULARY, correlationId });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const action = String(body.action ?? "");

  // ── The reconciliation judgement. LCP s9: a patient-reported dose is unverified until a PRACTITIONER
  //    reviews it, so confirming one is the practitioner capability and not the recording one. ─────────
  if (action === "verify") {
    const auth = await requirePracticeContext("medication.override");
    if (isDenied(auth)) return auth;
    const r = await verifyMedication(auth.caller.admin, auth.ctx, {
      medicationId: String(body.medicationId ?? ""), note: str(body.note),
      actorId: auth.ctx.userId, correlationId: auth.caller.traceId,
    });
    return r.ok ? NextResponse.json(r.data) : fail(r);
  }

  if (["record", "change", "carryForward", "calculateDose", "setReview"].includes(action)) {
    const auth = await requirePracticeContext("medication.record");
    if (isDenied(auth)) return auth;
    const base = { actorId: auth.ctx.userId, correlationId: auth.caller.traceId };
    const { admin } = auth.caller;

    if (action === "record") {
      const r = await recordMedication(admin, auth.ctx, {
        patientId: String(body.patientId ?? ""),
        encounterId: str(body.encounterId), treatmentId: str(body.treatmentId),
        genericName: String(body.genericName ?? ""), brandName: str(body.brandName),
        formulation: str(body.formulation), strengthText: str(body.strengthText),
        doseText: String(body.doseText ?? ""), doseValue: num(body.doseValue), doseUnit: str(body.doseUnit),
        route: str(body.route), frequency: str(body.frequency), frequencyPerDay: num(body.frequencyPerDay),
        durationText: str(body.durationText), indication: str(body.indication),
        startedOn: str(body.startedOn), prescriber: str(body.prescriber),
        source: body.source ? String(body.source) : undefined,
        reviewIntervalDays: num(body.reviewIntervalDays),
        ...base,
      });
      return r.ok ? NextResponse.json(r.data, { status: 201 }) : fail(r);
    }

    if (action === "change") {
      const r = await changeMedication(admin, auth.ctx, {
        medicationId: String(body.medicationId ?? ""), eventType: String(body.eventType ?? ""),
        doseText: str(body.doseText), doseValue: num(body.doseValue),
        frequency: str(body.frequency), frequencyPerDay: num(body.frequencyPerDay),
        reason: str(body.reason), narrative: str(body.narrative),
        occurredOn: str(body.occurredOn), encounterId: str(body.encounterId),
        ...base,
      });
      return r.ok ? NextResponse.json(r.data) : fail(r);
    }

    if (action === "carryForward") {
      const r = await carryForwardTreatment(admin, auth.ctx, {
        treatmentId: String(body.treatmentId ?? ""), genericName: str(body.genericName),
        doseText: str(body.doseText), startedOn: str(body.startedOn), ...base,
      });
      return r.ok ? NextResponse.json(r.data, { status: 201 }) : fail(r);
    }

    if (action === "setReview") {
      const r = await setMedicationReview(admin, auth.ctx, {
        medicationId: String(body.medicationId ?? ""),
        reviewIntervalDays: num(body.reviewIntervalDays),
        requireParameterId: str(body.requireParameterId),
        scheduleFollowUp: body.scheduleFollowUp === true,
        reason: String(body.reason ?? ""), ...base,
      });
      return r.ok ? NextResponse.json(r.data) : fail(r);
    }

    // ⚠ calculateDose IS A WRITE AND IT IS DELIBERATELY NOT A GET. The calculation is an immutable record
    // of what a prescriber was shown at the moment they decided, so it is stored, and a GET that wrote a
    // row would be a lie about the verb.
    const r = await calculateDose(admin, auth.ctx, {
      patientId: String(body.patientId ?? ""), medicationId: str(body.medicationId),
      encounterId: str(body.encounterId), basis: String(body.basis ?? ""),
      rateValue: num(body.rateValue), fixedDose: num(body.fixedDose),
      doseUnit: str(body.doseUnit), dosesPerDay: num(body.dosesPerDay),
      overrideReason: str(body.overrideReason), ...base,
    });
    return r.ok ? NextResponse.json(r.data) : fail(r);
  }

  return NextResponse.json({ error: `unknown action "${action}"` }, { status: 400 });
}
