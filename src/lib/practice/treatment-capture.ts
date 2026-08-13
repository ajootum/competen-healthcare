import { audit } from "@/lib/practice/audit";
import { editableEncounter, type EngineResult } from "@/lib/practice/encounters";
import { hasCapability, type WorkspaceContext } from "@/lib/practice/access";
import { recordMedication } from "@/lib/practice/medication";
import { captureSettings, isMissingTable, type Panel } from "@/lib/practice/investigations";
import {
  TREATMENT_FIELD_KEYS, TREATMENT_BOUNDARY, TREATMENT_REFUSALS, TREATMENT_CONFIG_ABSENT_NOTICE,
  OTHER_OPTION_CODE, treatmentShape, MAX_PENDING_TREATMENTS,
  type TreatmentFieldKey,
} from "@/lib/practice/treatment-capture-constants";

// CPR-TREAT-001 -- RAPID TREATMENT AND MEDICATION CAPTURE, on migration 275.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// WHAT THIS IS AND WHAT IT IS NOT A REPLACEMENT FOR.
//
// The Treatment tab was a type dropdown, four free-text boxes and a Record button, one treatment at a
// time. s2 asks for: catalogue, quick add, a builder of taps, a PENDING PLAN, a safety checkpoint, and
// ONE batch record. So the unit of work here is a LIST.
//
// ⚠ THE MEDICATION ENGINE IS REUSED, NOT REBUILT. medication.ts is 1,946 lines of dose arithmetic,
// weight provenance, verification and an append-only timeline, pinned by two harnesses. Every medication
// item in a batch goes through recordMedication() exactly as MedicationConsole's own button does -- the
// treatment row is written first and the medication row points at it through treatment_id, which is what
// migration 258 built that column for.
//
// ⚠ THE DOSE CALCULATOR IS NOT REIMPLEMENTED EITHER. s8's weight-based workflow is calculateDose() in
// medication.ts, reached through the existing /api/v1/practice/medications route. This module never
// multiplies anything by a weight.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// WARNING: WHAT WAS PRESCRIBED, NOT WHAT WAS ADMINISTERED. s16, and migration 194 before it. There is
// no administration column anywhere in this path and nothing here may be read as one.

/* eslint-disable @typescript-eslint/no-explicit-any */

export const TREATMENT_TABLES = {
  option: "practice_treatment_option",
  optionState: "practice_treatment_option_state",
  template: "practice_treatment_template",
  templateItem: "practice_treatment_template_item",
  medicationCatalogue: "practice_medication_catalogue",
  treatment: "practice_treatment",
  medication: "practice_medication",
} as const;

/**
 * practice_treatment's OWN status set, from migration 194. Named here so the correction path validates
 * against it rather than coercing -- an unrecognised value becoming `completed` would assert that a
 * course of treatment finished because a string failed to match.
 */
export const TREATMENT_STATUSES = ["planned", "in_progress", "completed", "cancelled"];

export const CAP_TREATMENT_RECORD = "treatment.record";
export const CAP_TREATMENT_CONFIGURE = "treatment.configure";
export const CAP_MEDICATION_RECORD = "medication.record";

const loaded = <T>(items: T[]): Panel<T> => ({ items, permitted: true, unavailable: false, detail: null });
const failedPanel = <T>(detail: string): Panel<T> => ({ items: [], permitted: true, unavailable: true, detail });

const fail = (status: number, code: string, message: string): EngineResult<never> =>
  ({ ok: false, status, code, message });
const trim = (v: unknown): string => String(v ?? "").trim();
const nowIso = () => new Date().toISOString();

// ── THE CONFIGURED LISTS -- s5, s6, s7 ──────────────────────────────────────────────────────────────

export type TreatmentOption = {
  id: string; fieldKey: string; code: string; label: string;
  sortOrder: number; numericValue: number | null;
  source: "platform" | "practice";
  enabled: boolean;
  /** True when the practice renamed a platform option, so Setup can show both names. */
  relabelled: boolean;
};

export type TreatmentOptionSet = {
  permitted: boolean;
  unavailable: boolean;
  detail: string | null;
  storeState: "present" | "absent" | "failed";
  storeNotice: string | null;
  /** Every list, keyed by field. ⚠ ENABLED ONLY -- what the practitioner may tap. */
  byField: Record<string, TreatmentOption[]>;
  /** Everything, enabled and disabled, for the configuration screen. */
  allByField: Record<string, TreatmentOption[]>;
};

const emptyOptionSet = (over: Partial<TreatmentOptionSet>): TreatmentOptionSet => ({
  permitted: true, unavailable: false, detail: null, storeState: "present", storeNotice: null,
  byField: Object.fromEntries(TREATMENT_FIELD_KEYS.map(k => [k, [] as TreatmentOption[]])),
  allByField: Object.fromEntries(TREATMENT_FIELD_KEYS.map(k => [k, [] as TreatmentOption[]])),
  ...over,
});

/**
 * CPR-TREAT-001 s7's hierarchy resolved into one list per field: platform defaults, then this
 * practice's departures from them, then this practice's own additions.
 *
 * ⚠ THE PLATFORM ROW IS NEVER MUTATED. A practice hides, renames or reorders through a STATE row, so a
 * platform seed can be corrected later without erasing what a practice decided -- which is s6's
 * "configuration changes should not require software deployment" read in the other direction.
 */
export async function treatmentOptions(admin: any, ctx: WorkspaceContext): Promise<TreatmentOptionSet> {
  const [optRes, stateRes] = await Promise.all([
    admin.from(TREATMENT_TABLES.option)
      .select("id, workspace_id, field_key, code, label, sort_order, numeric_value, active")
      .or(`workspace_id.is.null,workspace_id.eq.${ctx.workspaceId}`)
      .eq("active", true).order("field_key").order("sort_order").limit(1000),
    admin.from(TREATMENT_TABLES.optionState)
      .select("option_id, enabled, label_override, sort_order_override")
      .eq("workspace_id", ctx.workspaceId).limit(1000),
  ]);

  if (optRes.error && isMissingTable(optRes.error))
    return emptyOptionSet({ storeState: "absent", storeNotice: TREATMENT_CONFIG_ABSENT_NOTICE });
  if (optRes.error)
    return emptyOptionSet({
      unavailable: true, storeState: "failed",
      detail: `the configured treatment lists could not be read: ${optRes.error.message}`,
    });

  const stateBy = new Map(((stateRes.data ?? []) as any[]).map(s => [s.option_id, s]));

  const all: TreatmentOption[] = ((optRes.data ?? []) as any[]).map(row => {
    const st = stateBy.get(row.id);
    const override = st?.label_override ? String(st.label_override) : null;
    return {
      id: row.id, fieldKey: row.field_key, code: row.code,
      label: override ?? row.label,
      sortOrder: st?.sort_order_override ?? row.sort_order ?? 0,
      numericValue: row.numeric_value === null || row.numeric_value === undefined ? null : Number(row.numeric_value),
      source: row.workspace_id ? "practice" : "platform",
      // ⚠ ABSENCE IS ENABLED, exactly as for the investigation catalogue. A practice that has configured
      // nothing gets working lists rather than empty ones.
      enabled: st ? !!st.enabled : true,
      relabelled: override !== null,
    };
  });

  const group = (list: TreatmentOption[]) => {
    const out: Record<string, TreatmentOption[]> = Object.fromEntries(TREATMENT_FIELD_KEYS.map(k => [k, []]));
    for (const o of list) (out[o.fieldKey] ??= []).push(o);
    for (const k of Object.keys(out)) out[k].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
    return out;
  };

  return emptyOptionSet({
    byField: group(all.filter(o => o.enabled)),
    allByField: group(all),
  });
}

// ── THE MEDICATION PICKER -- s4 and s12 ─────────────────────────────────────────────────────────────

export type MedicationCatalogueItem = {
  id: string; code: string; genericName: string; brandName: string | null;
  defaultFormulation: string | null; defaultStrength: string | null;
  aliases: string[]; source: "platform" | "practice";
};

export type MedicationPicker = {
  /** ⚠ A NAME LIST. No dose ranges, no interactions, no maxima. See migration 275 section 7. */
  catalogue: Panel<MedicationCatalogueItem>;
  /**
   * s12's "frequency of use". DERIVED from what this workspace has actually recorded, exactly as
   * medicationWorklist derives it -- see FAVOURITES_ARE_DERIVED in medication-constants.ts. Not curated,
   * and NEVER labelled a recommendation.
   */
  frequentlyUsed: Panel<{ genericName: string; timesRecorded: number }>;
  /** s2's "recent". The last distinct names this practitioner recorded. */
  recent: Panel<{ genericName: string; recordedAt: string }>;
};

export async function medicationPicker(
  admin: any, ctx: WorkspaceContext, practitionerId: string,
): Promise<MedicationPicker> {
  const [catRes, usageRes, recentRes] = await Promise.all([
    admin.from(TREATMENT_TABLES.medicationCatalogue)
      .select("id, workspace_id, code, generic_name, brand_name, default_formulation, default_strength, aliases")
      .or(`workspace_id.is.null,workspace_id.eq.${ctx.workspaceId}`)
      .eq("active", true).order("generic_name").limit(1000),
    // ⚠ THE 1000-ROW POSTGREST CAP IS EXPLICIT. An unstated cap turns "we could not see far enough" into
    // "there is nothing there", which is the same class of lie as a failed read rendered as zero.
    admin.from(TREATMENT_TABLES.medication)
      .select("generic_name").eq("workspace_id", ctx.workspaceId).limit(1000),
    admin.from(TREATMENT_TABLES.medication)
      .select("generic_name, created_at").eq("workspace_id", ctx.workspaceId)
      .eq("created_by", practitionerId).order("created_at", { ascending: false }).limit(60),
  ]);

  const catalogue = catRes.error
    ? (isMissingTable(catRes.error)
      ? failedPanel<MedicationCatalogueItem>(TREATMENT_CONFIG_ABSENT_NOTICE)
      : failedPanel<MedicationCatalogueItem>(`the medication name list could not be read: ${catRes.error.message}`))
    : loaded(((catRes.data ?? []) as any[]).map(r => ({
      id: r.id, code: r.code, genericName: r.generic_name, brandName: r.brand_name ?? null,
      defaultFormulation: r.default_formulation ?? null, defaultStrength: r.default_strength ?? null,
      aliases: (r.aliases ?? []) as string[],
      source: (r.workspace_id ? "practice" : "platform") as "platform" | "practice",
    })));

  let frequentlyUsed: Panel<{ genericName: string; timesRecorded: number }>;
  if (usageRes.error) {
    frequentlyUsed = failedPanel(`frequently used medications could not be computed: ${usageRes.error.message}`);
  } else {
    const counts = new Map<string, number>();
    for (const r of ((usageRes.data ?? []) as any[])) {
      const key = trim(r.generic_name);
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    frequentlyUsed = loaded([...counts.entries()]
      .map(([genericName, timesRecorded]) => ({ genericName, timesRecorded }))
      .sort((a, b) => b.timesRecorded - a.timesRecorded || a.genericName.localeCompare(b.genericName))
      .slice(0, 10));
  }

  let recent: Panel<{ genericName: string; recordedAt: string }>;
  if (recentRes.error) {
    recent = failedPanel(`recent medications could not be read: ${recentRes.error.message}`);
  } else {
    const seen = new Set<string>();
    const items: { genericName: string; recordedAt: string }[] = [];
    for (const r of ((recentRes.data ?? []) as any[])) {
      const key = trim(r.generic_name);
      if (!key || seen.has(key.toLowerCase())) continue;
      seen.add(key.toLowerCase());
      items.push({ genericName: key, recordedAt: r.created_at });
      if (items.length >= 8) break;
    }
    recent = loaded(items);
  }

  return { catalogue, frequentlyUsed, recent };
}

// ── TEMPLATES -- s12 ────────────────────────────────────────────────────────────────────────────────

export type TemplateItem = {
  id: string; sortOrder: number; treatmentType: string; label: string;
  medicationRef: string | null; formulation: string | null;
  doseText: string | null; doseUnit: string | null; route: string | null;
  frequencyCode: string | null; frequencyText: string | null;
  durationText: string | null; reason: string | null;
};

export type TreatmentTemplate = {
  id: string; name: string; ownerType: string; ownerId: string | null;
  mine: boolean; version: number; items: TemplateItem[];
};

export async function treatmentTemplates(
  admin: any, ctx: WorkspaceContext, practitionerId: string,
): Promise<Panel<TreatmentTemplate>> {
  // ⚠ THE TEMPLATE READ FIRST, THEN ITS ITEMS BY ID. See investigations.ts for the same fix and the
  // same two harms -- except that what was being read across every tenant here is CLINICAL: drug
  // names, doses, routes and frequencies from other practices' prescription templates. The items table
  // has no workspace_id of its own, so its only honest scope is the template it belongs to, and it
  // carried none. The shared 1000-row cap silently emptied templates for the same reason.
  const tplRes = await admin.from(TREATMENT_TABLES.template)
    .select("id, name, owner_type, owner_id, version, active")
    .eq("workspace_id", ctx.workspaceId).eq("active", true).order("name").limit(200);

  if (tplRes.error)
    return isMissingTable(tplRes.error)
      ? failedPanel<TreatmentTemplate>(TREATMENT_CONFIG_ABSENT_NOTICE)
      : failedPanel<TreatmentTemplate>(`prescription templates could not be read: ${tplRes.error.message}`);

  const templateIds = ((tplRes.data ?? []) as any[]).map(t => t.id as string);
  const itemRes = templateIds.length
    ? await admin.from(TREATMENT_TABLES.templateItem)
      .select("id, template_id, sort_order, treatment_type, label, medication_ref, formulation, "
        + "dose_text, dose_unit, route, frequency_code, frequency_text, duration_text, reason")
      .in("template_id", templateIds).limit(2000)
    : { data: [] as any[], error: null };

  const itemsBy = new Map<string, TemplateItem[]>();
  for (const i of ((itemRes.data ?? []) as any[])) {
    const list = itemsBy.get(i.template_id) ?? [];
    list.push({
      id: i.id, sortOrder: i.sort_order ?? 0, treatmentType: i.treatment_type, label: i.label,
      medicationRef: i.medication_ref ?? null, formulation: i.formulation ?? null,
      doseText: i.dose_text ?? null, doseUnit: i.dose_unit ?? null, route: i.route ?? null,
      frequencyCode: i.frequency_code ?? null, frequencyText: i.frequency_text ?? null,
      durationText: i.duration_text ?? null, reason: i.reason ?? null,
    });
    itemsBy.set(i.template_id, list);
  }

  return loaded(((tplRes.data ?? []) as any[])
    .filter(t => t.owner_type === "practice" || t.owner_id === practitionerId)
    .map(t => ({
      id: t.id, name: t.name, ownerType: t.owner_type, ownerId: t.owner_id ?? null,
      mine: t.owner_type === "practice" || t.owner_id === practitionerId,
      version: Number(t.version ?? 1),
      items: (itemsBy.get(t.id) ?? []).sort((a, b) => a.sortOrder - b.sortOrder),
    })));
}

// ── THE WHOLE TAB PAYLOAD ───────────────────────────────────────────────────────────────────────────

export type TreatmentCapturePayload = {
  permitted: boolean;
  options: TreatmentOptionSet;
  picker: MedicationPicker;
  templates: Panel<TreatmentTemplate>;
  reasonRequired: boolean;
  boundary: string;
  refusals: typeof TREATMENT_REFUSALS;
  maxPending: number;
};

/**
 * Everything the Treatment tab needs, in one server read.
 *
 * ⚠ EVERY FIELD IS PLAIN DATA. A function on a payload handed to a client component compiles, passes
 * every API test, and kills the page at render. Nothing here is a function, and the harness walks the
 * payload to prove it.
 */
export async function treatmentCapture(
  admin: any, ctx: WorkspaceContext, practitionerId: string,
): Promise<TreatmentCapturePayload> {
  if (!hasCapability(ctx, CAP_TREATMENT_RECORD)) {
    return {
      permitted: false, options: emptyOptionSet({ permitted: false }),
      picker: {
        catalogue: { items: [], permitted: false, unavailable: false, detail: null },
        frequentlyUsed: { items: [], permitted: false, unavailable: false, detail: null },
        recent: { items: [], permitted: false, unavailable: false, detail: null },
      },
      templates: { items: [], permitted: false, unavailable: false, detail: null },
      reasonRequired: false, boundary: TREATMENT_BOUNDARY, refusals: TREATMENT_REFUSALS,
      maxPending: MAX_PENDING_TREATMENTS,
    };
  }

  const [options, picker, templates, settings] = await Promise.all([
    treatmentOptions(admin, ctx),
    medicationPicker(admin, ctx, practitionerId),
    treatmentTemplates(admin, ctx, practitionerId),
    captureSettings(admin, ctx.workspaceId),
  ]);

  return {
    permitted: true, options, picker, templates,
    reasonRequired: settings.treatmentReasonRequired,
    boundary: TREATMENT_BOUNDARY, refusals: TREATMENT_REFUSALS,
    maxPending: MAX_PENDING_TREATMENTS,
  };
}

// ── THE BATCH RECORDER -- s9 and s15 ────────────────────────────────────────────────────────────────

export type PendingTreatment = {
  treatmentType: string;
  label: string;
  medicationRef?: string | null;
  brandName?: string | null;
  strengthText?: string | null;
  formulation?: string | null;
  dose?: string | null;
  doseUnit?: string | null;
  route?: string | null;
  /**
   * ⚠ TWO FIELDS, AND THE SECOND ONE IS THE SPEC'S REQUIREMENT. `frequencyCode` is the configured option
   * that was tapped. `frequencyText` is the wording, and when the practitioner chose Other it is THEIR
   * wording, kept exactly (s5, AC-02).
   */
  frequencyCode?: string | null;
  frequencyText?: string | null;
  frequencyPerDay?: number | null;
  duration?: string | null;
  nonDrugCategory?: string | null;
  reason?: string | null;
  templateId?: string | null;
};

export type BatchTreatmentResult = {
  index: number; ok: boolean; treatmentId: string | null; medicationId: string | null;
  label: string; code: string | null; message: string | null;
};

/**
 * s9: "Support Record N treatments as one logical UI action" and "Do not require a separate Record
 * action for each medication."
 *
 * ⚠ ONE REQUEST FROM THE UI, PER-ITEM RESULTS BACK. s15 forbids silently dropping a treatment, so an
 * item that a database CHECK refuses comes back as a refused item alongside the ones that were written.
 *
 * ⚠ THE TREATMENT ROWS GO IN AS ONE INSERT. That is the closest this transport gets to s9's "batch
 * transaction": PostgREST has no multi-statement transaction, and a multi-row insert is atomic in
 * Postgres, so N treatment rows either all land or none do. THE MEDICATION ROWS CANNOT JOIN THAT
 * ATOMICITY, because each one needs the id of its own treatment row and recordMedication also writes a
 * timeline event. That is stated rather than hidden: a medication row that fails comes back as
 * MEDICATION_NOT_RECORDED against an item whose TREATMENT was recorded, and the message says which half
 * exists. Claiming a transaction that this transport cannot provide would be worse than saying so.
 */
export async function recordTreatmentBatch(admin: any, ctx: WorkspaceContext, args: {
  encounterId: string; items: PendingTreatment[];
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ batchId: string; results: BatchTreatmentResult[]; recorded: number }>> {
  if (!hasCapability(ctx, CAP_TREATMENT_RECORD))
    return fail(403, "FORBIDDEN", `recording a treatment needs ${CAP_TREATMENT_RECORD}`);

  const guard = await editableEncounter(admin, ctx.workspaceId, args.encounterId);
  if (!guard.ok) return guard;

  const items = (args.items ?? []).slice(0, MAX_PENDING_TREATMENTS);
  if (items.length === 0) return fail(422, "VALIDATION_ERROR", "there is nothing in the plan");

  const settings = await captureSettings(admin, ctx.workspaceId);
  const results: BatchTreatmentResult[] = [];
  const batchId = crypto.randomUUID();

  // Validate everything BEFORE writing anything, so a refusal on item four does not leave items one to
  // three recorded against a plan the practitioner then edits and records again.
  const prepared: { index: number; item: PendingTreatment; row: Record<string, unknown> }[] = [];
  items.forEach((item, index) => {
    const label = trim(item.label);
    if (!label) {
      results.push({ index, ok: false, treatmentId: null, medicationId: null, label: "",
        code: "VALIDATION_ERROR", message: "a treatment needs a name" });
      return;
    }
    if (!trim(item.treatmentType)) {
      results.push({ index, ok: false, treatmentId: null, medicationId: null, label,
        code: "VALIDATION_ERROR", message: "choose a treatment type" });
      return;
    }
    if (settings.treatmentReasonRequired && !trim(item.reason)) {
      results.push({ index, ok: false, treatmentId: null, medicationId: null, label,
        code: "VALIDATION_ERROR", message: "this practice requires a reason on every treatment" });
      return;
    }
    // ⚠ THE CUSTOM WORDING IS WHAT LANDS IN `frequency`. When Other was chosen, frequency_code stays
    // NULL so a later reader can tell a typed frequency from a tapped one -- and the text is not parsed,
    // not normalised and not abbreviated.
    const customFrequency = trim(item.frequencyCode) === OTHER_OPTION_CODE;
    const frequency = trim(item.frequencyText) || null;

    prepared.push({
      index, item,
      row: {
        workspace_id: ctx.workspaceId, encounter_id: args.encounterId, patient_id: guard.data.patient_id,
        treatment_type: trim(item.treatmentType), label,
        dose: trim(item.dose) || null, route: trim(item.route) || null,
        frequency, duration: trim(item.duration) || null,
        notes: trim(item.reason) || null, status: "planned",
        formulation: trim(item.formulation) || null,
        frequency_code: customFrequency ? null : (trim(item.frequencyCode) || null),
        dose_unit: trim(item.doseUnit) || null,
        medication_ref: trim(item.medicationRef) || null,
        template_id: trim(item.templateId) || null,
        non_drug_category: trim(item.nonDrugCategory) || null,
        batch_id: batchId,
        created_by: args.actorId,
      },
    });
  });

  if (prepared.length === 0)
    return { ok: true, data: { batchId, results: sortResults(results), recorded: 0 } };

  let written: any[] = [];
  const insert = await admin.from(TREATMENT_TABLES.treatment).insert(prepared.map(p => p.row)).select("id, label");
  if (insert.error) {
    // Migration 275 not applied: the added columns and the widened type CHECK do not exist. Retry on the
    // 194 shape for the types 194 allowed, and refuse the rest by NAME rather than dropping them.
    const legacyTypes = ["medication", "procedure", "investigation", "advice", "referral", "monitoring"];
    const fallbackRows = prepared
      .filter(p => legacyTypes.includes(String(p.row.treatment_type)))
      .map(p => ({
        workspace_id: p.row.workspace_id, encounter_id: p.row.encounter_id, patient_id: p.row.patient_id,
        treatment_type: p.row.treatment_type, label: p.row.label, dose: p.row.dose, route: p.row.route,
        frequency: p.row.frequency, duration: p.row.duration, notes: p.row.notes,
        status: "planned", created_by: p.row.created_by,
      }));
    for (const p of prepared) {
      if (!legacyTypes.includes(String(p.row.treatment_type)))
        results.push({ index: p.index, ok: false, treatmentId: null, medicationId: null,
          label: String(p.row.label), code: "REFUSED_BY_DATABASE",
          message: `"${p.row.treatment_type}" needs migration 275, which is not applied here` });
    }
    if (fallbackRows.length === 0)
      return { ok: true, data: { batchId, results: sortResults(results), recorded: 0 } };
    const retry = await admin.from(TREATMENT_TABLES.treatment).insert(fallbackRows).select("id, label");
    if (retry.error) return fail(422, "WRITE_FAILED", `nothing was recorded: ${retry.error.message}`);
    written = (retry.data ?? []) as any[];
  } else {
    written = (insert.data ?? []) as any[];
  }

  // Match each written row back to the item that produced it, by label, in order.
  const queue = [...written];
  const medicationWork: { index: number; item: PendingTreatment; treatmentId: string }[] = [];
  for (const p of prepared) {
    const at = queue.findIndex(w => w.label === String(p.row.label));
    if (at < 0) {
      results.push({ index: p.index, ok: false, treatmentId: null, medicationId: null,
        label: String(p.row.label), code: "REFUSED_BY_DATABASE", message: "this one was not written" });
      continue;
    }
    const treatmentId = String(queue[at].id);
    queue.splice(at, 1);
    results.push({ index: p.index, ok: true, treatmentId, medicationId: null,
      label: String(p.row.label), code: null, message: null });
    if (treatmentShape(String(p.row.treatment_type)).prescribing) {
      medicationWork.push({ index: p.index, item: p.item, treatmentId });
    }
  }

  // ── s2's "medication and non-medication treatment", and where the two paths diverge ───────────────
  //
  // ⚠ A PRESCRIBING TYPE ALSO OPENS A LONGITUDINAL MEDICATION ROW. That is what migration 258 built
  // treatment_id for: the decision taken in this consultation, and the course that outlives it, as two
  // rows that know about each other. Without it, a medication prescribed on the Treatment tab would be
  // invisible on the patient's medication record -- which is the list the next prescriber reads.
  //
  // ⚠ AND IT IS SKIPPED, NOT FAKED, WITHOUT medication.record. recordMedication refuses without the
  // capability, and the item comes back saying the treatment was recorded and the medication row was not.
  for (const work of medicationWork) {
    const doseText = trim(work.item.dose) || trim(work.item.label);
    const med = await recordMedication(admin, ctx, {
      patientId: guard.data.patient_id, encounterId: args.encounterId, treatmentId: work.treatmentId,
      genericName: trim(work.item.label), brandName: trim(work.item.brandName) || null,
      formulation: trim(work.item.formulation) || null,
      strengthText: trim(work.item.strengthText) || null,
      doseText, doseUnit: trim(work.item.doseUnit) || null,
      route: trim(work.item.route) || null,
      frequency: trim(work.item.frequencyText) || null,
      frequencyPerDay: work.item.frequencyPerDay ?? null,
      durationText: trim(work.item.duration) || null,
      indication: trim(work.item.reason) || null,
      source: "practitioner",
      actorId: args.actorId, correlationId: args.correlationId,
    });
    const at = results.findIndex(r => r.index === work.index);
    if (at < 0) continue;
    if (med.ok) results[at].medicationId = med.data.id;
    else {
      results[at].code = "MEDICATION_NOT_RECORDED";
      results[at].message =
        `the treatment was recorded, but it was not added to the patient's medication record: ${med.message}`;
    }
  }

  const recorded = results.filter(r => r.ok).length;
  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.treatments_recorded",
    payload: {
      encounterId: args.encounterId, batchId, recorded,
      medications: results.filter(r => r.medicationId).length,
      refused: results.filter(r => !r.ok).map(r => ({ label: r.label, code: r.code })),
    },
    correlationId: args.correlationId,
  });

  return { ok: true, data: { batchId, results: sortResults(results), recorded } };
}

const sortResults = (r: BatchTreatmentResult[]) => [...r].sort((a, b) => a.index - b.index);

// ── CONFIGURATION WRITES -- s6 and s7 ───────────────────────────────────────────────────────────────

/**
 * Hide, rename or reorder ONE configured option for this practice.
 *
 * ⚠ SAFETY-CRITICAL CONFIGURATION IS PERMISSION CONTROLLED AND AUDITED. s6, and s7's restricted class.
 * The capability is separate from treatment.record precisely because changing what everybody may select
 * is a different act from selecting.
 */
export async function setTreatmentOptionState(admin: any, ctx: WorkspaceContext, args: {
  optionId: string; enabled?: boolean; labelOverride?: string | null; sortOrderOverride?: number | null;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ optionId: string; enabled: boolean }>> {
  if (!hasCapability(ctx, CAP_TREATMENT_CONFIGURE))
    return fail(403, "FORBIDDEN", `changing a configured list needs ${CAP_TREATMENT_CONFIGURE}`);

  const { data: option, error: optErr } = await admin.from(TREATMENT_TABLES.option)
    .select("id, field_key, code").eq("id", args.optionId)
    .or(`workspace_id.is.null,workspace_id.eq.${ctx.workspaceId}`).maybeSingle();
  if (optErr && isMissingTable(optErr))
    return fail(503, "STORE_ABSENT", TREATMENT_CONFIG_ABSENT_NOTICE);
  if (optErr) return fail(503, "UNAVAILABLE", optErr.message);
  if (!option) return fail(404, "NOT_FOUND", "Not found");

  const { data: current } = await admin.from(TREATMENT_TABLES.optionState)
    .select("enabled, label_override, sort_order_override")
    .eq("workspace_id", ctx.workspaceId).eq("option_id", args.optionId).maybeSingle();

  const enabled = args.enabled === undefined ? (current ? !!current.enabled : true) : !!args.enabled;
  const labelOverride = args.labelOverride === undefined
    ? (current?.label_override ?? null) : (trim(args.labelOverride) || null);
  const sortOrderOverride = args.sortOrderOverride === undefined
    ? (current?.sort_order_override ?? null) : args.sortOrderOverride;

  const { error } = await admin.from(TREATMENT_TABLES.optionState).upsert({
    workspace_id: ctx.workspaceId, option_id: args.optionId, enabled,
    label_override: labelOverride, sort_order_override: sortOrderOverride,
    updated_at: nowIso(), updated_by: args.actorId,
  }, { onConflict: "workspace_id,option_id" });
  if (error) return fail(422, "REFUSED_BY_DATABASE", error.message);

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.treatment_option_changed",
    payload: { optionId: args.optionId, fieldKey: option.field_key, code: option.code, enabled, labelOverride },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { optionId: args.optionId, enabled } };
}

/**
 * s6: "Practice configuration may activate, deactivate, reorder, relabel or EXTEND permitted values."
 * This is extend. The new row belongs to this practice and no other practice can see it.
 */
export async function createTreatmentOption(admin: any, ctx: WorkspaceContext, args: {
  fieldKey: TreatmentFieldKey; label: string; numericValue?: number | null;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; code: string }>> {
  if (!hasCapability(ctx, CAP_TREATMENT_CONFIGURE))
    return fail(403, "FORBIDDEN", `extending a configured list needs ${CAP_TREATMENT_CONFIGURE}`);
  if (!(TREATMENT_FIELD_KEYS as readonly string[]).includes(args.fieldKey))
    return fail(422, "VALIDATION_ERROR", `unknown list "${args.fieldKey}"`);
  // ⚠ THE ONE LIST THAT CANNOT BE EXTENDED HERE, AND IT SAYS SO. treatment_type is constrained by a
  // database CHECK on practice_treatment, so a new code would be accepted into configuration and then
  // refused at the moment somebody used it. Refusing here is the honest place. s3's own answer is
  // 'other', which is seeded active and keeps the practitioner's own words.
  if (args.fieldKey === "treatment_type")
    return fail(422, "NOT_EXTENSIBLE",
      "treatment types cannot be added without a migration, because the database constrains them. "
      + "Relabel, reorder or deactivate the existing ones, and use Other for anything they do not cover.");

  const label = trim(args.label);
  if (!label) return fail(422, "VALIDATION_ERROR", "an option needs a label");

  const code = `loc_${crypto.randomUUID().slice(0, 8)}`;
  const { data: last } = await admin.from(TREATMENT_TABLES.option)
    .select("sort_order").eq("workspace_id", ctx.workspaceId).eq("field_key", args.fieldKey)
    .order("sort_order", { ascending: false }).limit(1).maybeSingle();

  const { data, error } = await admin.from(TREATMENT_TABLES.option).insert({
    workspace_id: ctx.workspaceId, field_key: args.fieldKey, code, label,
    sort_order: Number(last?.sort_order ?? 500) + 10,
    numeric_value: args.numericValue ?? null, active: true, created_by: args.actorId,
  }).select("id, code").single();
  if (error && isMissingTable(error)) return fail(503, "STORE_ABSENT", TREATMENT_CONFIG_ABSENT_NOTICE);
  if (error) return fail(422, "REFUSED_BY_DATABASE", error.message);

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.treatment_option_created",
    payload: { optionId: data.id, fieldKey: args.fieldKey, label }, correlationId: args.correlationId,
  });
  return { ok: true, data: { id: data.id as string, code: data.code as string } };
}

/**
 * s12: save a prescription template.
 *
 * ⚠ A TEMPLATE STORES FIELD VALUES ONLY, AND THAT IS THE SAFETY PROPERTY. s12: "Templates are editable
 * before recording and are REVALIDATED against the current patient context every time." There is no
 * column here for a verdict, an approval or an evaluation, so there is nothing that could be carried
 * forward in place of a check.
 *
 * ⚠ OWNERSHIP IS SPLIT, s12's last line. A practice-shared template is configuration everybody sees and
 * needs treatment.configure. A personal one is a preference and does not.
 */
export async function saveTreatmentTemplate(admin: any, ctx: WorkspaceContext, args: {
  templateId?: string | null; name: string; ownerType: "practice" | "practitioner";
  practitionerId: string; items: PendingTreatment[];
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; version: number; items: number }>> {
  if (!hasCapability(ctx, CAP_TREATMENT_RECORD))
    return fail(403, "FORBIDDEN", `saving a template needs ${CAP_TREATMENT_RECORD}`);
  if (args.ownerType === "practice" && !hasCapability(ctx, CAP_TREATMENT_CONFIGURE))
    return fail(403, "FORBIDDEN", `a practice-shared template needs ${CAP_TREATMENT_CONFIGURE}`);

  const name = trim(args.name);
  if (!name) return fail(422, "VALIDATION_ERROR", "a template needs a name");
  const items = (args.items ?? []).filter(i => trim(i.label)).slice(0, MAX_PENDING_TREATMENTS);
  if (items.length === 0) return fail(422, "VALIDATION_ERROR", "a template with nothing in it is not a template");

  let templateId = trim(args.templateId) || null;
  let version = 1;

  if (templateId) {
    const { data: existing } = await admin.from(TREATMENT_TABLES.template)
      .select("id, owner_type, owner_id, version").eq("id", templateId)
      .eq("workspace_id", ctx.workspaceId).maybeSingle();
    if (!existing) return fail(404, "NOT_FOUND", "Not found");
    if (existing.owner_type === "practitioner" && existing.owner_id !== args.practitionerId)
      return fail(403, "FORBIDDEN", "that is another practitioner's personal template");
    version = Number(existing.version ?? 1) + 1;
    const { error } = await admin.from(TREATMENT_TABLES.template)
      .update({ name, version, updated_at: nowIso() }).eq("id", templateId);
    if (error) return fail(422, "REFUSED_BY_DATABASE", error.message);
    await admin.from(TREATMENT_TABLES.templateItem).delete().eq("template_id", templateId);
  } else {
    const { data, error } = await admin.from(TREATMENT_TABLES.template).insert({
      workspace_id: ctx.workspaceId, owner_type: args.ownerType,
      owner_id: args.ownerType === "practitioner" ? args.practitionerId : null,
      name, active: true, version: 1, created_by: args.actorId,
    }).select("id").single();
    if (error && isMissingTable(error)) return fail(503, "STORE_ABSENT", TREATMENT_CONFIG_ABSENT_NOTICE);
    if (error) return fail(422, "REFUSED_BY_DATABASE", error.message);
    templateId = data.id as string;
  }

  const { error: itemErr } = await admin.from(TREATMENT_TABLES.templateItem).insert(items.map((i, n) => ({
    template_id: templateId, sort_order: n, treatment_type: trim(i.treatmentType) || "medication",
    label: trim(i.label), medication_ref: trim(i.medicationRef) || null,
    formulation: trim(i.formulation) || null, dose_text: trim(i.dose) || null,
    dose_unit: trim(i.doseUnit) || null, route: trim(i.route) || null,
    frequency_code: trim(i.frequencyCode) || null, frequency_text: trim(i.frequencyText) || null,
    duration_text: trim(i.duration) || null, reason: trim(i.reason) || null,
  })));
  if (itemErr) return fail(422, "REFUSED_BY_DATABASE", `the template was saved without its items: ${itemErr.message}`);

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.treatment_template_saved",
    payload: { templateId, name, ownerType: args.ownerType, version, items: items.length },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: templateId as string, version, items: items.length } };
}

/** Retire a template. DEACTIVATED, NOT DELETED: history that names it must stay readable. */
export async function retireTreatmentTemplate(admin: any, ctx: WorkspaceContext, args: {
  templateId: string; practitionerId: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  if (!hasCapability(ctx, CAP_TREATMENT_RECORD))
    return fail(403, "FORBIDDEN", `retiring a template needs ${CAP_TREATMENT_RECORD}`);

  const { data: existing } = await admin.from(TREATMENT_TABLES.template)
    .select("id, owner_type, owner_id").eq("id", args.templateId)
    .eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!existing) return fail(404, "NOT_FOUND", "Not found");
  if (existing.owner_type === "practitioner" && existing.owner_id !== args.practitionerId)
    return fail(403, "FORBIDDEN", "that is another practitioner's personal template");
  if (existing.owner_type === "practice" && !hasCapability(ctx, CAP_TREATMENT_CONFIGURE))
    return fail(403, "FORBIDDEN", `a practice-shared template needs ${CAP_TREATMENT_CONFIGURE}`);

  const { error } = await admin.from(TREATMENT_TABLES.template).update({ active: false }).eq("id", args.templateId);
  if (error) return fail(422, "REFUSED_BY_DATABASE", error.message);

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.treatment_template_retired",
    payload: { templateId: args.templateId }, correlationId: args.correlationId,
  });
  return { ok: true, data: { id: args.templateId } };
}

/** s4's local medication addition: a name this practice uses that the seed does not carry. */
export async function createMedicationCatalogueItem(admin: any, ctx: WorkspaceContext, args: {
  genericName: string; brandName?: string | null; defaultFormulation?: string | null;
  defaultStrength?: string | null; aliases?: string[];
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; code: string }>> {
  if (!hasCapability(ctx, CAP_TREATMENT_CONFIGURE))
    return fail(403, "FORBIDDEN", `adding to the medication name list needs ${CAP_TREATMENT_CONFIGURE}`);

  const genericName = trim(args.genericName);
  if (!genericName) return fail(422, "VALIDATION_ERROR", "a medication needs a name");

  const code = `MEDLOC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const { data, error } = await admin.from(TREATMENT_TABLES.medicationCatalogue).insert({
    workspace_id: ctx.workspaceId, code, generic_name: genericName,
    brand_name: trim(args.brandName) || null,
    default_formulation: trim(args.defaultFormulation) || null,
    default_strength: trim(args.defaultStrength) || null,
    aliases: (args.aliases ?? []).map(trim).filter(Boolean).slice(0, 10),
    active: true, source_system: "Practice custom", created_by: args.actorId,
  }).select("id, code").single();
  if (error && isMissingTable(error)) return fail(503, "STORE_ABSENT", TREATMENT_CONFIG_ABSENT_NOTICE);
  if (error) return fail(422, "REFUSED_BY_DATABASE", error.message);

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.medication_catalogue_item_created",
    payload: { id: data.id, code: data.code, genericName }, correlationId: args.correlationId,
  });
  return { ok: true, data: { id: data.id as string, code: data.code as string } };
}

// ══ CORRECTING AND WITHDRAWING A RECORDED TREATMENT (CPR-TRT-UI-002 s19) ═══════════════════════════
//
// ⚠ THESE EXIST BECAUSE THE COMP DRAWS AN EDIT AND A MENU ON EVERY CARD, AND THERE WAS NO WRITE PATH
// BEHIND EITHER. Drawing the controls first would have been the defect this codebase keeps finding: a
// button that cannot do what it appears to offer. The shape is deliberately the same as
// updateEncounterDiagnosis / removeEncounterDiagnosis, because a practitioner correcting a record
// should not have to learn two different sets of rules on two tabs of one screen.

/**
 * Correct a treatment already written to the record.
 *
 * ⚠ ONLY WHILE THE ENCOUNTER IS UNSIGNED. A signed encounter is something a clinician put their name
 * to; editing it afterwards would make the signature meaningless. Refused by name, not hidden.
 *
 * ⚠ IT DOES NOT TOUCH THE MEDICATION RECORD. recordTreatment may create a practice_medication row
 * alongside the treatment, and that row is the patient's longitudinal medication history rather than
 * this encounter's note. Silently rewriting it from here would edit a different clinical object than
 * the one on screen. Correcting the medication itself belongs to the medication console, which owns it.
 */
export async function updateEncounterTreatment(admin: any, ctx: WorkspaceContext, args: {
  treatmentId: string;
  label?: string;
  dose?: string | null;
  route?: string | null;
  frequency?: string | null;
  duration?: string | null;
  status?: string;
  actorId: string;
  correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  if (!hasCapability(ctx, CAP_TREATMENT_RECORD))
    return fail(403, "FORBIDDEN", `correcting a treatment needs ${CAP_TREATMENT_RECORD}`);

  // ⚠ THE WORKSPACE FILTER IS THE TENANT BOUNDARY. service_role bypasses RLS, so a treatment id from
  // another practice would otherwise be writable by anyone who could guess it.
  const { data: row, error: readErr } = await admin.from("practice_treatment")
    .select("id, encounter_id, workspace_id")
    .eq("id", args.treatmentId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (readErr) return fail(503, "READ_FAILED", `that treatment could not be read: ${readErr.message}`);
  if (!row) return fail(404, "NOT_FOUND", "Not found");

  const { data: enc } = await admin.from("practice_encounter")
    .select("id, signed_at").eq("id", row.encounter_id).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!enc) return fail(404, "NOT_FOUND", "Not found");
  if (enc.signed_at)
    return fail(422, "ENCOUNTER_SIGNED", "this encounter is signed, so its treatments can no longer be changed");

  const patch: Record<string, unknown> = {};
  if (args.label !== undefined) {
    const label = args.label.trim();
    if (!label) return fail(400, "LABEL_REQUIRED", "a treatment needs a name");
    if (label.length > 240) return fail(422, "LABEL_TOO_LONG", "that treatment name is longer than 240 characters");
    patch.label = label;
  }
  for (const k of ["dose", "route", "frequency", "duration"] as const) {
    if (args[k] !== undefined) patch[k] = (args[k] ?? "") === "" ? null : String(args[k]).trim();
  }
  if (args.status !== undefined) {
    // ⚠ VALIDATED AGAINST migration 194's OWN SET, not coerced. An unrecognised status silently
    // becoming `completed` would assert that a course of treatment finished because a string failed to
    // match -- the exact bug the procedure engine carried until today.
    if (!TREATMENT_STATUSES.includes(args.status))
      return fail(422, "STATUS_INVALID", `status must be one of ${TREATMENT_STATUSES.join(", ")}`);
    patch.status = args.status;
  }
  if (Object.keys(patch).length === 0) return fail(422, "NO_CHANGE", "nothing was different");

  const { error } = await admin.from("practice_treatment")
    .update(patch).eq("id", row.id).eq("workspace_id", ctx.workspaceId);
  if (error) return fail(422, "REFUSED_BY_DATABASE", error.message);

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.treatment_corrected",
    payload: { treatmentId: row.id, encounterId: row.encounter_id, changed: Object.keys(patch) },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: row.id as string } };
}

/**
 * Withdraw a treatment recorded in error.
 *
 * ⚠ THE MEDICATION ROW IS LEFT STANDING, AND THIS IS NOT AN OVERSIGHT. If prescribing created a
 * practice_medication row, that row may already have been reviewed, dispensed against or carried into
 * another encounter. Deleting the note here and the longitudinal record silently would remove evidence
 * from a place the practitioner is not looking. The caller is told, in the returned sentence, that the
 * medication list still holds it.
 */
export async function removeEncounterTreatment(admin: any, ctx: WorkspaceContext, args: {
  treatmentId: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; medicationKept: boolean }>> {
  if (!hasCapability(ctx, CAP_TREATMENT_RECORD))
    return fail(403, "FORBIDDEN", `withdrawing a treatment needs ${CAP_TREATMENT_RECORD}`);

  const { data: row, error: readErr } = await admin.from("practice_treatment")
    .select("id, encounter_id, workspace_id, medication_ref, label")
    .eq("id", args.treatmentId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (readErr) return fail(503, "READ_FAILED", `that treatment could not be read: ${readErr.message}`);
  if (!row) return fail(404, "NOT_FOUND", "Not found");

  const { data: enc } = await admin.from("practice_encounter")
    .select("id, signed_at").eq("id", row.encounter_id).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!enc) return fail(404, "NOT_FOUND", "Not found");
  if (enc.signed_at)
    return fail(422, "ENCOUNTER_SIGNED", "this encounter is signed, so its treatments can no longer be withdrawn");

  const { error } = await admin.from("practice_treatment")
    .delete().eq("id", row.id).eq("workspace_id", ctx.workspaceId);
  if (error) return fail(422, "REFUSED_BY_DATABASE", error.message);

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.treatment_withdrawn",
    payload: { treatmentId: row.id, encounterId: row.encounter_id, label: row.label,
      medicationKept: !!row.medication_ref },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: row.id as string, medicationKept: !!row.medication_ref } };
}
