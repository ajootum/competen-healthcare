import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import {
  recordTreatmentBatch, saveTreatmentTemplate, retireTreatmentTemplate,
  setTreatmentOptionState, createTreatmentOption, createMedicationCatalogueItem,
  updateEncounterTreatment, removeEncounterTreatment,
  type PendingTreatment,
} from "@/lib/practice/treatment-capture";
import { TREATMENT_FIELD_KEYS, type TreatmentFieldKey } from "@/lib/practice/treatment-capture-constants";

// POST /api/v1/practice/treatment-capture -- CPR-TREAT-001.
//
// ⚠ WHAT WAS PRESCRIBED, NOT WHAT WAS ADMINISTERED. s16. There is no administration verb here, there is
// no dispensing verb, and nothing in this route transmits a prescription anywhere.
//
// ⚠ `record` IS A BATCH AND IT IS ONE ROUND TRIP. s9: "Do not require a separate Record action for each
// medication." The N treatment rows go in as one insert. The medication rows that follow cannot join
// that atomicity -- each needs the id of its own treatment row -- and the per-item result says so
// explicitly rather than implying a transaction this transport does not have.
//
// ⚠ THE CAPABILITY IS CHECKED BY THE ENGINE PER ACTION, for the reason the investigation route gives:
// recording needs treatment.record, changing what everybody may select needs treatment.configure, and a
// single route-level gate would be wrong for one of them.

/* eslint-disable @typescript-eslint/no-explicit-any */

const bad = (message: string) => NextResponse.json({ error: { code: "VALIDATION_ERROR", message } }, { status: 400 });

const asItem = (i: any): PendingTreatment => ({
  treatmentType: String(i?.treatmentType ?? ""),
  label: String(i?.label ?? ""),
  medicationRef: i?.medicationRef ?? null,
  brandName: i?.brandName ?? null,
  strengthText: i?.strengthText ?? null,
  formulation: i?.formulation ?? null,
  dose: i?.dose ?? null,
  doseUnit: i?.doseUnit ?? null,
  route: i?.route ?? null,
  frequencyCode: i?.frequencyCode ?? null,
  // ⚠ NOT NORMALISED, NOT PARSED, NOT ABBREVIATED. s5 requires the exact entered wording of a custom
  // frequency to survive into the encounter record, so this route touches nothing but the type.
  frequencyText: i?.frequencyText ?? null,
  frequencyPerDay: i?.frequencyPerDay === null || i?.frequencyPerDay === undefined
    ? null : Number(i.frequencyPerDay),
  duration: i?.duration ?? null,
  nonDrugCategory: i?.nonDrugCategory ?? null,
  reason: i?.reason ?? null,
  templateId: i?.templateId ?? null,
});

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext(null);
  if (isDenied(auth)) return auth;
  const { caller, ctx } = auth;

  let body: Record<string, any>;
  try { body = await req.json(); } catch { return bad("invalid JSON"); }

  const action = String(body.action ?? "");
  const actor = { actorId: caller.userId, correlationId: caller.traceId };

  switch (action) {
    case "record": {
      const encounterId = String(body.encounterId ?? "");
      if (!encounterId) return bad("encounterId is required");
      if (!Array.isArray(body.items)) return bad("items must be an array");
      const result = await recordTreatmentBatch(caller.admin, ctx, {
        encounterId, items: body.items.map(asItem), ...actor,
      });
      return respond(result, caller.traceId, 201);
    }

    case "saveTemplate": {
      const ownerType = body.ownerType === "practice" ? "practice" : "practitioner";
      const result = await saveTreatmentTemplate(caller.admin, ctx, {
        templateId: body.templateId ?? null,
        name: String(body.name ?? ""),
        ownerType,
        practitionerId: caller.userId,
        items: Array.isArray(body.items) ? body.items.map(asItem) : [],
        ...actor,
      });
      return respond(result, caller.traceId, 201);
    }

    case "retireTemplate": {
      const result = await retireTreatmentTemplate(caller.admin, ctx, {
        templateId: String(body.templateId ?? ""), practitionerId: caller.userId, ...actor,
      });
      return respond(result, caller.traceId);
    }

    case "setOption": {
      const result = await setTreatmentOptionState(caller.admin, ctx, {
        optionId: String(body.optionId ?? ""),
        enabled: body.enabled === undefined ? undefined : !!body.enabled,
        labelOverride: body.labelOverride === undefined ? undefined : body.labelOverride,
        sortOrderOverride: body.sortOrderOverride === undefined ? undefined : Number(body.sortOrderOverride),
        ...actor,
      });
      return respond(result, caller.traceId);
    }

    case "createOption": {
      const fieldKey = String(body.fieldKey ?? "");
      if (!(TREATMENT_FIELD_KEYS as readonly string[]).includes(fieldKey))
        return bad(`fieldKey must be one of: ${TREATMENT_FIELD_KEYS.join(", ")}`);
      const result = await createTreatmentOption(caller.admin, ctx, {
        fieldKey: fieldKey as TreatmentFieldKey,
        label: String(body.label ?? ""),
        numericValue: body.numericValue === undefined || body.numericValue === null ? null : Number(body.numericValue),
        ...actor,
      });
      return respond(result, caller.traceId, 201);
    }

    case "createMedication": {
      const result = await createMedicationCatalogueItem(caller.admin, ctx, {
        genericName: String(body.genericName ?? ""),
        brandName: body.brandName ?? null,
        defaultFormulation: body.defaultFormulation ?? null,
        defaultStrength: body.defaultStrength ?? null,
        aliases: Array.isArray(body.aliases) ? body.aliases.map((s: any) => String(s)) : [],
        ...actor,
      });
      return respond(result, caller.traceId, 201);
    }

    // CPR-TRT-UI-002 s19: Edit and Remove on a recorded card. Both refuse a signed encounter by name.
    case "correct": {
      const result = await updateEncounterTreatment(caller.admin, ctx, {
        treatmentId: String(body.treatmentId ?? ""),
        label: body.label === undefined ? undefined : String(body.label),
        dose: body.dose === undefined ? undefined : (body.dose === null ? null : String(body.dose)),
        route: body.route === undefined ? undefined : (body.route === null ? null : String(body.route)),
        frequency: body.frequency === undefined ? undefined : (body.frequency === null ? null : String(body.frequency)),
        duration: body.duration === undefined ? undefined : (body.duration === null ? null : String(body.duration)),
        status: body.status === undefined ? undefined : String(body.status),
        actorId: caller.userId, correlationId: caller.traceId,
      });
      return respond(result, caller.traceId);
    }

    case "withdraw": {
      const result = await removeEncounterTreatment(caller.admin, ctx, {
        treatmentId: String(body.treatmentId ?? ""),
        actorId: caller.userId, correlationId: caller.traceId,
      });
      return respond(result, caller.traceId);
    }

    default:
      return bad(`unknown action "${action}"`);
  }
}

function respond(result: any, correlationId: string, okStatus = 200) {
  if (!result.ok)
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ ...result.data, correlationId }, { status: okStatus });
}
