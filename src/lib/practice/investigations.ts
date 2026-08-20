import { audit } from "@/lib/practice/audit";
import { emitAudited } from "@/lib/practice/events";
// ⚠ BORROWED FROM THE PROCEDURE VOCABULARY ON PURPOSE. parseDetailFields and detailFieldIssues are
// generic over {key,label,kind,required,options} and import nothing -- migration 301 gave
// investigations the SAME detail_fields shape 297 gave procedures, and two parsers for one shape is
// how the two drift. If a third domain adopts the shape, promote these to their own module.
import { parseDetailFields, detailFieldIssues, type ProcedureDetailField } from "@/lib/practice/procedure-constants";
import { editableEncounter, type EngineResult } from "@/lib/practice/encounters";
import { hasCapability, type WorkspaceContext } from "@/lib/practice/access";
import {
  CAPTURE_SETTING_DEFAULTS, DUPLICATE_RULE_CODES, INVESTIGATION_CATALOGUE_MIGRATION,
  INVESTIGATION_STORE_ABSENT_NOTICE, INVESTIGATION_REFUSALS, INVESTIGATION_BOUNDARY,
  type CaptureSettingKey,
} from "@/lib/practice/investigation-constants";

// CINV-CAP-001 (the catalogue engine) and CPR-INV-001 (the encounter workflow), on migration 275.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// WHAT REPLACED WHAT.
//
// The Investigations tab was one text box and one Record button. CPR-INV-001 s2 asks for the opposite:
// a searchable multi-select picker, Quick Add chips, reusable sets, and ONE batch confirmation. So the
// unit of work in this module is a LIST, not an item -- addInvestigations takes an array and writes it
// in one request, and reviewInvestigations marks a selection with one shared timestamp.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// WARNING: THIS IS NOT AN ORDER SYSTEM. Migration 238 refused a result column and migration 275 did not
// add one. Nothing here transmits anything, nothing here observes whether a test was performed, and the
// third status added by 275 is "not pursued" -- a note that the practitioner dropped it, not a
// laboratory cancellation. CPR-INV-001 s14, restated in INVESTIGATION_REFUSALS and printed on the tab.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THREE STATES, EVERYWHERE. permitted / unavailable / loaded, the shape longitudinal.ts established.
// A FAILED READ IS NEVER A ZERO: an empty catalogue and a catalogue that could not be read send a
// practitioner to two different places, and only one of them is "type the name yourself".

/* eslint-disable @typescript-eslint/no-explicit-any */

export const INVESTIGATION_TABLES = {
  catalogue: "practice_investigation_catalogue",
  alias: "practice_investigation_alias",
  activation: "practice_investigation_activation",
  preference: "practice_investigation_preference",
  set: "practice_investigation_set",
  setItem: "practice_investigation_set_item",
  setting: "practice_capture_setting",
  encounterInvestigation: "practice_encounter_investigation",
} as const;

export const CAP_INVESTIGATION_CONFIGURE = "investigation.configure";
/** Recording stays behind the capability the encounter already uses. 275 added no recording capability. */
export const CAP_ENCOUNTER_EDIT = "encounter.edit";

export type Panel<T> = { items: T[]; permitted: boolean; unavailable: boolean; detail: string | null };
const denied = <T>(): Panel<T> => ({ items: [], permitted: false, unavailable: false, detail: null });
const failed = <T>(detail: string): Panel<T> => ({ items: [], permitted: true, unavailable: true, detail });
const loaded = <T>(items: T[]): Panel<T> => ({ items, permitted: true, unavailable: false, detail: null });

const fail = (status: number, code: string, message: string): EngineResult<never> =>
  ({ ok: false, status, code, message });

const trim = (v: unknown): string => String(v ?? "").trim();
const nowIso = () => new Date().toISOString();

/** PostgREST's schema-cache miss and Postgres's undefined-table, which mean the same thing here. */
const MISSING_TABLE_CODES = new Set(["PGRST205", "PGRST202", "42P01"]);
export const isMissingTable = (error: any) =>
  !!error && (MISSING_TABLE_CODES.has(String(error.code))
    || /could not find the table/i.test(String(error.message ?? "")));

const storeAbsent = <T>(): EngineResult<T> => ({
  ok: false, status: 503, code: "STORE_ABSENT",
  message: `The investigation catalogue has no store in this deployment yet. Migration "${INVESTIGATION_CATALOGUE_MIGRATION}" has not been applied.`,
});

// ── THE PRACTICE'S WORKFLOW SETTINGS ────────────────────────────────────────────────────────────────

export type CaptureSettings = {
  duplicateRule: string;
  investigationReasonRequired: boolean;
  treatmentReasonRequired: boolean;
  quickAddLimit: number;
  /** ⚠ Three states again. `unreadable` means the defaults below are in force because the read failed. */
  unreadable: boolean;
};

/**
 * The four settings CPR-INV-001 s6/s11 and CPR-TREAT-001 s5 make practice-configurable.
 *
 * ⚠ A FAILED READ FALLS BACK TO THE DEFAULTS AND SAYS SO. It does not fall back to the strictest
 * option: "safest" is not "most restrictive" here, because a read failure that silently started
 * REFUSING duplicate investigations would stop a practitioner recording a genuine repeat and give them
 * no way to tell why.
 */
export async function captureSettings(admin: any, workspaceId: string): Promise<CaptureSettings> {
  const defaults = (unreadable: boolean): CaptureSettings => ({
    duplicateRule: CAPTURE_SETTING_DEFAULTS.investigation_duplicate_rule,
    investigationReasonRequired: CAPTURE_SETTING_DEFAULTS.investigation_reason_required === "true",
    treatmentReasonRequired: CAPTURE_SETTING_DEFAULTS.treatment_reason_required === "true",
    quickAddLimit: Number(CAPTURE_SETTING_DEFAULTS.quick_add_limit),
    unreadable,
  });

  const { data, error } = await admin.from(INVESTIGATION_TABLES.setting)
    .select("setting_key, value_text").eq("workspace_id", workspaceId);
  if (error) return defaults(!isMissingTable(error));

  const map = new Map(((data ?? []) as any[]).map(r => [String(r.setting_key), String(r.value_text)]));
  const read = (k: CaptureSettingKey) => map.get(k) ?? CAPTURE_SETTING_DEFAULTS[k];
  const rule = read("investigation_duplicate_rule");
  const limit = Number(read("quick_add_limit"));
  return {
    // An unknown value in the column falls back rather than reaching the UI as a rule nothing implements.
    duplicateRule: DUPLICATE_RULE_CODES.includes(rule) ? rule : CAPTURE_SETTING_DEFAULTS.investigation_duplicate_rule,
    investigationReasonRequired: read("investigation_reason_required") === "true",
    treatmentReasonRequired: read("treatment_reason_required") === "true",
    quickAddLimit: Number.isFinite(limit) && limit > 0 && limit <= 24 ? Math.floor(limit) : 8,
    unreadable: false,
  };
}

export async function setCaptureSetting(admin: any, ctx: WorkspaceContext, args: {
  key: CaptureSettingKey; value: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ key: string; value: string }>> {
  if (!hasCapability(ctx, CAP_INVESTIGATION_CONFIGURE))
    return fail(403, "FORBIDDEN", `changing capture configuration needs ${CAP_INVESTIGATION_CONFIGURE}`);

  const value = trim(args.value);
  if (!value) return fail(422, "VALIDATION_ERROR", "a setting needs a value");
  if (args.key === "investigation_duplicate_rule" && !DUPLICATE_RULE_CODES.includes(value))
    return fail(422, "VALIDATION_ERROR", `the duplicate rule must be one of: ${DUPLICATE_RULE_CODES.join(", ")}`);

  // ⚠ THE CONFLICT TARGET IS A FULL UNIQUE INDEX ON TWO NOT NULL COLUMNS (ux_practice_capture_setting).
  // An upsert against a partial index writes nothing and reports success, which is how two writes were
  // lost in this codebase before. And the error is NOT discarded.
  const { error } = await admin.from(INVESTIGATION_TABLES.setting).upsert({
    workspace_id: ctx.workspaceId, setting_key: args.key, value_text: value,
    updated_at: nowIso(), updated_by: args.actorId,
  }, { onConflict: "workspace_id,setting_key" });
  if (error && isMissingTable(error)) return storeAbsent();
  if (error) return fail(422, "REFUSED_BY_DATABASE", error.message);

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.capture_setting_changed",
    payload: { key: args.key, value }, correlationId: args.correlationId,
  });
  return { ok: true, data: { key: args.key, value } };
}

// ── THE CATALOGUE ───────────────────────────────────────────────────────────────────────────────────

export type CatalogueItem = {
  id: string;
  code: string;
  canonicalName: string;
  shortName: string | null;
  /** The local display name where the practice set one, the canonical name otherwise. */
  displayName: string;
  category: string;
  subcategory: string | null;
  aliases: string[];
  /** CPR-INV-CAT-007 s10 (migration 301): investigation, procedure, or dual_purpose. */
  classification: string;
  /** s6/s9's dynamic field profile, parsed and validated as definitions. Empty for most items. */
  detailFields: ProcedureDetailField[];
  /** Where the row came from. A practice item is one this practice created. */
  source: "platform" | "practice";
  /** Practice activation. ⚠ A missing activation row is ENABLED -- see migration 275 section 3. */
  enabled: boolean;
  /** True when this practice has overridden the display name, so Setup can show both. */
  renamed: boolean;
  favourite: boolean;
  usageCount: number;
  lastUsedAt: string | null;
};

export type InvestigationCatalogue = {
  permitted: boolean;
  unavailable: boolean;
  detail: string | null;
  storeState: "present" | "absent" | "failed";
  storeNotice: string | null;
  /** Everything this practice may offer, enabled and disabled, so Setup can render both. */
  all: CatalogueItem[];
  /** What the picker offers: enabled only. */
  selectable: CatalogueItem[];
  categories: string[];
  quickAdd: { item: CatalogueItem; reason: string }[];
  sets: InvestigationSet[];
  settings: CaptureSettings;
  boundary: string;
  refusals: typeof INVESTIGATION_REFUSALS;
};

export type InvestigationSet = {
  id: string; name: string; ownerType: string; ownerId: string | null;
  mine: boolean; active: boolean; itemIds: string[];
};

const emptyCatalogue = (over: Partial<InvestigationCatalogue>): InvestigationCatalogue => ({
  permitted: true, unavailable: false, detail: null, storeState: "present", storeNotice: null,
  all: [], selectable: [], categories: [], quickAdd: [], sets: [],
  settings: {
    duplicateRule: CAPTURE_SETTING_DEFAULTS.investigation_duplicate_rule,
    investigationReasonRequired: false, treatmentReasonRequired: false, quickAddLimit: 8, unreadable: false,
  },
  boundary: INVESTIGATION_BOUNDARY, refusals: INVESTIGATION_REFUSALS,
  ...over,
});

/**
 * The whole practice catalogue, its aliases, this practitioner's preferences and their sets, in one
 * read, ready to be handed to a client picker.
 *
 * ⚠ THE WHOLE THING, ON PURPOSE. CPR-INV-001 s13 asks the picker to open without waiting for a
 * download and to search incrementally. Eighty rows with their aliases is a few kilobytes, so the
 * fastest correct answer is to send them with the page and rank in the browser -- which also removes
 * every per-keystroke round trip. A paged endpoint exists for Setup, where the list can grow.
 *
 * ⚠ THE 1000-ROW POSTGREST CAP IS STATED, NOT ASSUMED. An unbounded select silently truncates there,
 * and a truncated catalogue looks exactly like a small one.
 */
export async function investigationCatalogue(
  admin: any, ctx: WorkspaceContext, practitionerId: string,
): Promise<InvestigationCatalogue> {
  if (!hasCapability(ctx, CAP_ENCOUNTER_EDIT) && !hasCapability(ctx, CAP_INVESTIGATION_CONFIGURE))
    return emptyCatalogue({ permitted: false });

  // ⚠ TWO WAVES, NOT ONE FAN-OUT, AND THE REASON IS A BUG THAT WAS LIVE.
  //
  // `alias` and `set_item` have no workspace_id column of their own -- they belong to a tenant only
  // through their parent -- and they used to be read here with NO FILTER AT ALL, capped at 1000 rows.
  // Two harms, and the second is the one that bit:
  //
  //   1. every practice's aliases and set items were read into this process, and
  //   2. THE CAP IS SHARED. Another practice's rows fill the 1000 before yours are reached, so a
  //      practice with forty investigation sets renders them EMPTY -- correct-looking, silent, and
  //      worse the more tenants the platform has. It cannot be fixed by raising the limit.
  //
  // The in-memory join meant nothing leaked to the response, which is exactly why nobody noticed.
  // Keying the children on their resolved parents costs one round trip and makes the cap per-practice.
  const [catRes, actRes, prefRes, setRes, settings] = await Promise.all([
    admin.from(INVESTIGATION_TABLES.catalogue)
      .select("id, workspace_id, code, canonical_name, short_name, category, subcategory, active, classification, detail_fields")
      .or(`workspace_id.is.null,workspace_id.eq.${ctx.workspaceId}`)
      .eq("active", true).order("category").order("canonical_name").limit(1000),
    admin.from(INVESTIGATION_TABLES.activation)
      .select("investigation_id, enabled, local_display_name").eq("workspace_id", ctx.workspaceId).limit(1000),
    admin.from(INVESTIGATION_TABLES.preference)
      .select("investigation_id, favourite, usage_count, last_used_at")
      .eq("workspace_id", ctx.workspaceId).eq("practitioner_id", practitionerId).limit(1000),
    admin.from(INVESTIGATION_TABLES.set)
      .select("id, name, owner_type, owner_id, active").eq("workspace_id", ctx.workspaceId)
      .eq("active", true).order("name").limit(200),
    captureSettings(admin, ctx.workspaceId),
  ]);

  const catalogueIds = ((catRes.data ?? []) as any[]).map(r => r.id as string);
  const setIds = ((setRes.data ?? []) as any[]).map(r => r.id as string);
  const none = { data: [] as any[], error: null };
  const [aliasRes, setItemRes] = await Promise.all([
    catalogueIds.length
      // ⚠ GLOBAL PLUS OWN-WORKSPACE, NEVER EVERYTHING. Before migration 301 every alias was global and
      // keying on the parent was scope enough. 301 added workspace-local aliases, so an unfiltered read
      // here would pour every tenant's private vocabulary into every other tenant's search -- the
      // cross-tenant class the tenant-scope audit exists for, created by a migration between audits.
      ? admin.from(INVESTIGATION_TABLES.alias).select("investigation_id, alias, workspace_id")
        .in("investigation_id", catalogueIds)
        .or(`workspace_id.is.null,workspace_id.eq.${ctx.workspaceId}`).limit(2000)
      : none,
    setIds.length
      ? admin.from(INVESTIGATION_TABLES.setItem).select("set_id, investigation_id, sort_order")
        .in("set_id", setIds).limit(2000)
      : none,
  ]);

  if (catRes.error && isMissingTable(catRes.error))
    return emptyCatalogue({ storeState: "absent", storeNotice: INVESTIGATION_STORE_ABSENT_NOTICE, settings });
  if (catRes.error)
    return emptyCatalogue({
      unavailable: true, storeState: "failed", settings,
      detail: `the investigation catalogue could not be read: ${catRes.error.message}`,
    });

  const aliasesBy = new Map<string, string[]>();
  for (const a of ((aliasRes.data ?? []) as any[])) {
    const list = aliasesBy.get(a.investigation_id) ?? [];
    list.push(String(a.alias));
    aliasesBy.set(a.investigation_id, list);
  }
  const activationBy = new Map(((actRes.data ?? []) as any[]).map(a => [a.investigation_id, a]));
  const prefBy = new Map(((prefRes.data ?? []) as any[]).map(p => [p.investigation_id, p]));

  const all: CatalogueItem[] = ((catRes.data ?? []) as any[]).map(row => {
    const act = activationBy.get(row.id);
    const pref = prefBy.get(row.id);
    const localName = act?.local_display_name ? String(act.local_display_name) : null;
    return {
      id: row.id, code: row.code, canonicalName: row.canonical_name,
      shortName: row.short_name ?? null,
      displayName: localName ?? row.canonical_name,
      category: row.category, subcategory: row.subcategory ?? null,
      aliases: aliasesBy.get(row.id) ?? [],
      classification: String(row.classification ?? "investigation"),
      detailFields: parseDetailFields(row.detail_fields),
      source: row.workspace_id ? "practice" : "platform",
      // ⚠ ABSENCE IS ENABLED. A practice that has configured nothing must still see the whole catalogue.
      enabled: act ? !!act.enabled : true,
      renamed: localName !== null,
      favourite: !!pref?.favourite,
      usageCount: Number(pref?.usage_count ?? 0),
      lastUsedAt: pref?.last_used_at ?? null,
    };
  });

  const selectable = all.filter(i => i.enabled);
  const byId = new Map(all.map(i => [i.id, i]));

  const sets: InvestigationSet[] = ((setRes.data ?? []) as any[]).map(s => ({
    id: s.id, name: s.name, ownerType: s.owner_type, ownerId: s.owner_id ?? null,
    mine: s.owner_type === "practice" || s.owner_id === practitionerId,
    active: !!s.active,
    itemIds: ((setItemRes.data ?? []) as any[])
      .filter(i => i.set_id === s.id)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map(i => i.investigation_id)
      // An item whose catalogue row was disabled or deleted is dropped from the SET rather than
      // rendered as a name nothing can add. CINV-CAP-001 s8: a set references ids, it does not own names.
      .filter(id => byId.has(id)),
  })).filter(s => s.ownerType === "practice" || s.ownerId === practitionerId);

  return {
    permitted: true, unavailable: false, detail: null, storeState: "present", storeNotice: null,
    all, selectable,
    categories: [...new Set(selectable.map(i => i.category))],
    quickAdd: rankQuickAdd(selectable, settings.quickAddLimit),
    sets, settings, boundary: INVESTIGATION_BOUNDARY, refusals: INVESTIGATION_REFUSALS,
  };
}

/**
 * CINV-CAP-001 s7 and CPR-INV-001 s10: favourites first, then frequency, then recency -- and the reason
 * TRAVELS WITH THE ITEM, because s11 requires the endpoint to expose why an item is present.
 *
 * ⚠ NOT A RECOMMENDATION, AND THE SHAPE MAKES THAT CHECKABLE. There is no score here that mixes the
 * three signals into one number nobody can explain. An item is on this row for exactly one stated
 * reason.
 */
export function rankQuickAdd(items: CatalogueItem[], limit: number): { item: CatalogueItem; reason: string }[] {
  const out: { item: CatalogueItem; reason: string }[] = [];
  const taken = new Set<string>();

  for (const i of items.filter(x => x.favourite).sort((a, b) => a.displayName.localeCompare(b.displayName))) {
    out.push({ item: i, reason: "favourite" });
    taken.add(i.id);
  }
  for (const i of items.filter(x => !taken.has(x.id) && x.usageCount > 0).sort((a, b) => b.usageCount - a.usageCount)) {
    out.push({ item: i, reason: "frequent" });
    taken.add(i.id);
  }
  for (const i of items.filter(x => !taken.has(x.id) && x.lastUsedAt)
    .sort((a, b) => String(b.lastUsedAt).localeCompare(String(a.lastUsedAt)))) {
    out.push({ item: i, reason: "recent" });
    taken.add(i.id);
  }
  return out.slice(0, limit);
}

// ── THE ENCOUNTER'S OWN INVESTIGATIONS ──────────────────────────────────────────────────────────────

export type EncounterInvestigation = {
  id: string; label: string; status: string; summary: string | null;
  investigationId: string | null; displayNameSnapshot: string | null;
  category: string | null;
  reason: string | null; reasonShared: string | null; reasonOverride: string | null;
  requestedAt: string; reviewedAt: string | null; cancelledAt: string | null;
  cancelledReason: string | null; linkedDocumentId: string | null; batchId: string | null;
  /** The linked inbox document's title, so a row can say WHICH report answers it, not merely that one does. */
  linkedDocumentTitle: string | null;
};

/**
 * Everything recorded on this encounter, with the category the catalogue knows.
 *
 * ⚠ THE LABEL IS NEVER DERIVED FROM THE JOIN. display_name_snapshot and label are on the row itself,
 * exactly so that a catalogue rename or a deleted custom item cannot change what a consultation says it
 * asked for -- CINV-CAP-001 s8 and AC-06.
 */
export async function encounterInvestigations(
  admin: any, ctx: WorkspaceContext, encounterId: string,
): Promise<Panel<EncounterInvestigation>> {
  if (!hasCapability(ctx, "encounter.list")) return denied();

  const { data, error } = await admin.from(INVESTIGATION_TABLES.encounterInvestigation)
    .select("id, label, status, summary, investigation_id, display_name_snapshot, reason_shared, "
      + "reason_override, requested_at, reviewed_at, cancelled_at, cancelled_reason, linked_document_id, batch_id")
    .eq("workspace_id", ctx.workspaceId).eq("encounter_id", encounterId)
    .order("requested_at");
  if (error) {
    // The columns 275 adds do not exist until it is applied. Falling back to the 238 shape keeps the tab
    // READABLE on a deployment that has not run the migration, instead of showing an empty encounter.
    const fallback = await admin.from(INVESTIGATION_TABLES.encounterInvestigation)
      .select("id, label, status, summary, requested_at, reviewed_at")
      .eq("workspace_id", ctx.workspaceId).eq("encounter_id", encounterId).order("requested_at");
    if (fallback.error) return failed(`the encounter investigations could not be read: ${error.message}`);
    return loaded(((fallback.data ?? []) as any[]).map(r => ({
      id: r.id, label: r.label, status: r.status, summary: r.summary ?? null,
      investigationId: null, displayNameSnapshot: null, category: null,
      reason: null, reasonShared: null, reasonOverride: null,
      requestedAt: r.requested_at, reviewedAt: r.reviewed_at ?? null, cancelledAt: null,
      cancelledReason: null, linkedDocumentId: null, batchId: null, linkedDocumentTitle: null,
    })));
  }

  const rows = (data ?? []) as any[];
  const ids = [...new Set(rows.map(r => r.investigation_id).filter(Boolean))];
  const { data: cats } = ids.length
    ? await admin.from(INVESTIGATION_TABLES.catalogue).select("id, category").in("id", ids)
    : { data: [] };
  const catBy = new Map(((cats ?? []) as any[]).map(c => [c.id, c.category]));

  // The linked report's title, read WORKSPACE-SCOPED even though the FK narrows it already -- the same
  // rule the alias read follows since 301: a child read keyed only on parent ids is one schema change
  // away from a leak. Best-effort: a failed title read renders "a report", never a broken tab.
  const docIds = [...new Set(rows.map(r => r.linked_document_id).filter(Boolean))];
  const { data: docs } = docIds.length
    ? await admin.from("practice_incoming_document").select("id, title")
      .eq("workspace_id", ctx.workspaceId).in("id", docIds)
    : { data: [] };
  const titleBy = new Map(((docs ?? []) as any[]).map(d => [d.id, d.title]));

  return loaded(rows.map(r => ({
    id: r.id, label: r.label, status: r.status, summary: r.summary ?? null,
    investigationId: r.investigation_id ?? null,
    displayNameSnapshot: r.display_name_snapshot ?? null,
    category: r.investigation_id ? (catBy.get(r.investigation_id) ?? null) : null,
    reason: r.reason_override ?? r.reason_shared ?? null,
    reasonShared: r.reason_shared ?? null, reasonOverride: r.reason_override ?? null,
    requestedAt: r.requested_at, reviewedAt: r.reviewed_at ?? null,
    cancelledAt: r.cancelled_at ?? null, cancelledReason: r.cancelled_reason ?? null,
    linkedDocumentId: r.linked_document_id ?? null, batchId: r.batch_id ?? null,
    linkedDocumentTitle: r.linked_document_id ? (titleBy.get(r.linked_document_id) ?? null) : null,
  })));
}

export type BatchItemInput = {
  investigationId?: string | null; label?: string | null; reasonOverride?: string | null;
  /** s6/s9 (migration 301): answers to the definition's detail fields, keyed by field key. */
  details?: Record<string, string> | null;
};
export type BatchItemResult = {
  index: number; ok: boolean; id: string | null; label: string;
  code: string | null; message: string | null;
};

/**
 * CPR-INV-001 s2 and AC-02: a batch of four recorded by ONE action.
 *
 * ⚠ ONE REQUEST, AND PER-ITEM RESULTS. s15 requires the caller to be told what succeeded and what did
 * not "without silently dropping" anything, so a duplicate refusal comes back as a refused ITEM while
 * the rest are written -- not as a 422 that discards the practitioner's whole selection.
 *
 * ⚠ ONE batch_id ON EVERY ROW. That is what makes "they added these four together" answerable
 * afterwards, and it is the only thing in the schema that records the batch as an act.
 *
 * ⚠ DUPLICATES ARE NEVER MERGED. s11's last line. A second row is a second row, with its own id and its
 * own time. The `allowDuplicate` flag on an item is the practitioner's explicit Add again.
 */
export async function addInvestigations(admin: any, ctx: WorkspaceContext, args: {
  encounterId: string;
  items: BatchItemInput[];
  reasonShared?: string | null;
  /** Items the practitioner has explicitly said to add again, by index. */
  allowDuplicate?: number[];
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ batchId: string; results: BatchItemResult[]; recorded: number }>> {
  if (!hasCapability(ctx, CAP_ENCOUNTER_EDIT))
    return fail(403, "FORBIDDEN", `recording an investigation needs ${CAP_ENCOUNTER_EDIT}`);

  const guard = await editableEncounter(admin, ctx.workspaceId, args.encounterId);
  if (!guard.ok) return guard;

  const items = (args.items ?? []).slice(0, 50);
  if (items.length === 0) return fail(422, "VALIDATION_ERROR", "nothing was selected");

  const settings = await captureSettings(admin, ctx.workspaceId);
  const reasonShared = trim(args.reasonShared) || null;
  if (settings.investigationReasonRequired && !reasonShared
    && !items.every(i => trim(i.reasonOverride))) {
    return fail(422, "REASON_REQUIRED",
      "this practice requires a clinical question on every investigation. Add a shared reason, or one on each item.");
  }

  // Resolve the catalogue rows named by the selection, in one read.
  const ids = [...new Set(items.map(i => trim(i.investigationId)).filter(Boolean))];
  const catBy = new Map<string, any>();
  if (ids.length > 0) {
    const { data, error } = await admin.from(INVESTIGATION_TABLES.catalogue)
      .select("id, workspace_id, canonical_name, code, detail_fields")
      .in("id", ids).or(`workspace_id.is.null,workspace_id.eq.${ctx.workspaceId}`);
    if (error && isMissingTable(error)) return storeAbsent();
    if (error) return fail(503, "UNAVAILABLE", `the catalogue could not be read: ${error.message}`);
    for (const r of ((data ?? []) as any[])) catBy.set(r.id, r);
  }

  // What is already on this encounter, for s11's duplicate rule.
  const existing = await admin.from(INVESTIGATION_TABLES.encounterInvestigation)
    .select("id, label, investigation_id, status")
    .eq("workspace_id", ctx.workspaceId).eq("encounter_id", args.encounterId);
  // ⚠ A FAILED READ IS NOT "NO DUPLICATES". If the existing list could not be read, the rule cannot be
  // applied, and the honest thing is to say so rather than to write a second copy in silence.
  if (existing.error && !isMissingTable(existing.error))
    return fail(503, "UNAVAILABLE", `what is already on this encounter could not be read: ${existing.error.message}`);
  const existingRows = (existing.data ?? []) as any[];
  const already = (investigationId: string | null, label: string) =>
    existingRows.some(r => r.status !== "cancelled" && (
      (investigationId && r.investigation_id === investigationId)
      || (!investigationId && String(r.label ?? "").trim().toLowerCase() === label.toLowerCase())));

  const batchId = crypto.randomUUID();
  const allow = new Set(args.allowDuplicate ?? []);
  const results: BatchItemResult[] = [];
  const rows: Record<string, unknown>[] = [];
  const usedCatalogueIds: string[] = [];

  items.forEach((item, index) => {
    const catalogueId = trim(item.investigationId) || null;
    const catalogue = catalogueId ? catBy.get(catalogueId) : null;
    if (catalogueId && !catalogue) {
      results.push({ index, ok: false, id: null, label: trim(item.label) || catalogueId,
        code: "NOT_IN_CATALOGUE", message: "that item is not in this practice's catalogue" });
      return;
    }
    const label = trim(item.label) || (catalogue ? String(catalogue.canonical_name) : "");
    if (!label) {
      results.push({ index, ok: false, id: null, label: "", code: "VALIDATION_ERROR", message: "name the investigation" });
      return;
    }
    // s6's validation, applied only where a definition declares fields. detailFieldIssues returns the
    // missing LABELS, so the refusal names the field rather than counting it.
    const fieldIssues = catalogue
      ? detailFieldIssues(parseDetailFields(catalogue.detail_fields), item.details ?? undefined)
      : [];
    if (fieldIssues.length > 0) {
      results.push({ index, ok: false, id: null, label, code: "DETAIL_REQUIRED",
        message: `needs ${fieldIssues.join(", ")}` });
      return;
    }
    if (already(catalogueId, label) && !allow.has(index)) {
      if (settings.duplicateRule === "prevent") {
        results.push({ index, ok: false, id: null, label, code: "DUPLICATE_PREVENTED",
          message: "already recorded in this encounter, and this practice prevents a duplicate" });
        return;
      }
      if (settings.duplicateRule === "warn") {
        results.push({ index, ok: false, id: null, label, code: "DUPLICATE_WARNING",
          message: "already recorded in this encounter. Use Add again if this is a genuine repeat." });
        return;
      }
    }
    if (catalogueId) usedCatalogueIds.push(catalogueId);
    rows.push({
      workspace_id: ctx.workspaceId, encounter_id: args.encounterId, patient_id: guard.data.patient_id,
      label, status: "requested",
      investigation_id: catalogueId,
      // s7's immutable display snapshot. Written at the moment of recording, never updated.
      display_name_snapshot: label,
      reason_shared: reasonShared,
      reason_override: trim(item.reasonOverride) || null,
      batch_id: batchId,
      created_by: args.actorId,
    });
    results.push({ index, ok: true, id: null, label, code: null, message: null });
  });

  if (rows.length > 0) {
    const { data, error } = await admin.from(INVESTIGATION_TABLES.encounterInvestigation)
      .insert(rows).select("id, label");
    if (error) {
      // Migration 275 not applied: the added columns do not exist. Retry on the 238 shape rather than
      // refusing, because recording the request is what matters and the extras are additive.
      const bare = rows.map(r => ({
        workspace_id: r.workspace_id, encounter_id: r.encounter_id, patient_id: r.patient_id,
        label: r.label, status: "requested", created_by: r.created_by,
      }));
      const retry = await admin.from(INVESTIGATION_TABLES.encounterInvestigation).insert(bare).select("id, label");
      if (retry.error) return fail(422, "WRITE_FAILED", `nothing was recorded: ${retry.error.message}`);
      assignIds(results, (retry.data ?? []) as any[]);
    } else {
      assignIds(results, (data ?? []) as any[]);
    }
  }

  // ── s6's DETAIL ANSWERS (migration 301), keyed to the rows the insert just returned ─────────────
  //
  // ⚠ THE LABEL IS WRITTEN DOWN BESIDE EVERY VALUE, exactly as 297's practice_procedure_detail does: a
  // field renamed in the catalogue next year must not rewrite what was recorded today. Only values for
  // DECLARED fields travel -- detailValues filters against the definition -- so a caller cannot use
  // this to store arbitrary keys against a patient's investigation.
  const detailRows: Record<string, unknown>[] = [];
  for (const r of results) {
    if (!r.ok || !r.id) continue;
    const item = items[r.index];
    const catalogue = item?.investigationId ? catBy.get(trim(item.investigationId)) : null;
    if (!catalogue || !item?.details) continue;
    for (const f of parseDetailFields(catalogue.detail_fields)) {
      const value = String(item.details[f.key] ?? "").trim();
      if (!value || value.length > 500) continue;
      detailRows.push({
        workspace_id: ctx.workspaceId, encounter_investigation_id: r.id,
        field_key: f.key, field_label: f.label, value_text: value, created_by: args.actorId,
      });
    }
  }
  if (detailRows.length > 0) {
    const { error: detailError } = await admin.from("practice_investigation_detail").insert(detailRows);
    if (detailError)
      await audit(admin, {
        workspaceId: ctx.workspaceId, actorId: args.actorId,
        eventType: "practice.investigation_detail_failed",
        payload: { batchId, detail: detailError.message, fields: detailRows.map(d => d.field_key) },
        correlationId: args.correlationId,
      });
  }

  // CINV-CAP-001 s7's observed frequency. ⚠ AFTER the write, and a failure here never fails the
  // recording: a preference row is a convenience and a consultation is not.
  await bumpUsage(admin, ctx.workspaceId, args.actorId, usedCatalogueIds);

  const recorded = results.filter(r => r.ok).length;
  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.investigations_recorded",
    payload: {
      encounterId: args.encounterId, batchId, recorded,
      refused: results.filter(r => !r.ok).map(r => ({ label: r.label, code: r.code })),
    },
    correlationId: args.correlationId,
  });

  return { ok: true, data: { batchId, results, recorded } };
}

/** Fills the ids the insert returned back onto the per-item results, matched by label in order. */
function assignIds(results: BatchItemResult[], written: { id: string; label: string }[]) {
  const queue = [...written];
  for (const r of results) {
    if (!r.ok) continue;
    const at = queue.findIndex(w => w.label === r.label);
    if (at >= 0) { r.id = queue[at].id; queue.splice(at, 1); }
  }
}

async function bumpUsage(admin: any, workspaceId: string, practitionerId: string, investigationIds: string[]) {
  if (investigationIds.length === 0) return;
  const counted = new Map<string, number>();
  for (const id of investigationIds) counted.set(id, (counted.get(id) ?? 0) + 1);

  const { data } = await admin.from(INVESTIGATION_TABLES.preference)
    .select("investigation_id, usage_count, favourite")
    .eq("workspace_id", workspaceId).eq("practitioner_id", practitionerId)
    .in("investigation_id", [...counted.keys()]);
  const current = new Map(((data ?? []) as any[]).map(p => [p.investigation_id, p]));

  const rows = [...counted.entries()].map(([investigationId, n]) => ({
    workspace_id: workspaceId, practitioner_id: practitionerId, investigation_id: investigationId,
    favourite: !!current.get(investigationId)?.favourite,
    usage_count: Number(current.get(investigationId)?.usage_count ?? 0) + n,
    last_used_at: nowIso(),
  }));
  // ⚠ FULL UNIQUE INDEX ON THREE NOT NULL COLUMNS. The error is logged rather than discarded: a
  // preference that silently stops updating is a Quick Add row that quietly stops changing.
  const { error } = await admin.from(INVESTIGATION_TABLES.preference)
    .upsert(rows, { onConflict: "workspace_id,practitioner_id,investigation_id" });
  if (error) console.error(`[practice] investigation usage was not recorded: ${error.message}`);
}

/**
 * CPR-INV-001 s9: batch review, ONE review event per selected item, SHARED timestamp and reviewing user.
 *
 * ⚠ "REVIEWED" MEANS THE PRACTITIONER LOOKED. It does not mean this product verified anything, and the
 * summary is their sentence about it, never a result.
 */
export async function reviewInvestigations(admin: any, ctx: WorkspaceContext, args: {
  encounterId: string; investigationIds: string[]; summary?: string | null;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ reviewed: string[]; reviewedAt: string }>> {
  if (!hasCapability(ctx, CAP_ENCOUNTER_EDIT))
    return fail(403, "FORBIDDEN", `reviewing an investigation needs ${CAP_ENCOUNTER_EDIT}`);
  const guard = await editableEncounter(admin, ctx.workspaceId, args.encounterId);
  if (!guard.ok) return guard;

  const ids = [...new Set((args.investigationIds ?? []).map(trim).filter(Boolean))];
  if (ids.length === 0) return fail(422, "VALIDATION_ERROR", "nothing was selected");

  const reviewedAt = nowIso();
  const patch: Record<string, unknown> = { status: "reviewed", reviewed_at: reviewedAt };
  if (trim(args.summary)) patch.summary = trim(args.summary);

  let { data, error } = await admin.from(INVESTIGATION_TABLES.encounterInvestigation)
    .update({ ...patch, reviewed_by: args.actorId })
    .eq("workspace_id", ctx.workspaceId).eq("encounter_id", args.encounterId)
    .eq("status", "requested").in("id", ids).select("id");
  if (error) {
    // reviewed_by is a 275 column. Without it the review still records, and saying so is better than
    // refusing the whole action on a deployment that has not migrated.
    const retry = await admin.from(INVESTIGATION_TABLES.encounterInvestigation)
      .update(patch)
      .eq("workspace_id", ctx.workspaceId).eq("encounter_id", args.encounterId)
      .eq("status", "requested").in("id", ids).select("id");
    if (retry.error) return fail(422, "WRITE_FAILED", `nothing was marked as reviewed: ${retry.error.message}`);
    data = retry.data; error = null;
  }

  const reviewed = ((data ?? []) as any[]).map(r => r.id as string);
  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.investigations_reviewed",
    payload: { encounterId: args.encounterId, reviewed, requested: ids.length, reviewedAt },
    correlationId: args.correlationId,
  });

  // ── s9 DOMAIN EVENT ───────────────────────────────────────────────────────────────────────────
  //
  // ⚠ ONLY WHEN SOMETHING WAS ACTUALLY MARKED. `reviewed` is the ids the update came back with, and
  // it is empty when every named investigation had already left `requested` -- a review that changed
  // nothing. Emitting there would announce clinical judgement nobody exercised on this call.
  //
  // ONE EVENT FOR THE BATCH, not one per investigation: the practitioner performed one act on one
  // encounter, and `reviewed` carries how many rows it touched. `via` distinguishes it from the
  // inbox review in communication.ts -- different tables, different rows, no double count.
  if (reviewed.length > 0) {
    await emitAudited(admin, [{
      eventType: "result.reviewed", practiceId: ctx.workspaceId,
      practitionerId: args.actorId, actorId: args.actorId, source: "web",
      encounterId: args.encounterId, occurredAt: reviewedAt,
      payload: { encounterId: args.encounterId, reviewed, count: reviewed.length, via: "encounter" },
    }], args.correlationId);
  }

  return { ok: true, data: { reviewed, reviewedAt } };
}

/**
 * CPR-INV-001 s7 / migration 275: point a recorded investigation at the incoming document that answers
 * it. 275's own words apply -- THE RESULT LIVES THERE, NOT HERE. This writes a reference, never a
 * result, and unlinking (null) is the same act pointed at nothing.
 *
 * ⚠ DELIBERATELY NOT GUARDED BY editableEncounter. A report normally arrives AFTER the consultation is
 * signed, so requiring an editable encounter would confine linking to the one window in which there is
 * nothing to link. The encounter row is still read -- the link is checked against its WORKSPACE and its
 * PATIENT, because linked_document_id is a plain FK and a plain FK cannot see tenancy (the migration-301
 * alias lesson, applied before the bug this time).
 *
 * ⚠ AN UNASSIGNED INBOX DOCUMENT IS REFUSED, NOT ADOPTED. classifyIncoming is the one place a document
 * acquires its patient; quietly assigning it here because a link implies it would be a second owner of
 * that decision, and the refusal says where to go instead.
 */
export async function linkInvestigationDocument(admin: any, ctx: WorkspaceContext, args: {
  encounterId: string; investigationId: string; incomingDocumentId: string | null;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; linkedDocumentId: string | null }>> {
  if (!hasCapability(ctx, CAP_ENCOUNTER_EDIT))
    return fail(403, "FORBIDDEN", `linking a report needs ${CAP_ENCOUNTER_EDIT}`);

  const { data: enc, error: encErr } = await admin.from("practice_encounter")
    .select("id, patient_id").eq("id", args.encounterId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (encErr) return fail(503, "ENCOUNTER_UNAVAILABLE", "the encounter could not be read, so the link cannot be checked; try again");
  if (!enc) return fail(404, "NOT_FOUND", "that encounter does not exist in this practice");

  const { data: inv, error: invErr } = await admin.from(INVESTIGATION_TABLES.encounterInvestigation)
    .select("id, status, label").eq("id", trim(args.investigationId))
    .eq("workspace_id", ctx.workspaceId).eq("encounter_id", args.encounterId).maybeSingle();
  if (invErr) return fail(503, "INVESTIGATION_UNAVAILABLE", "the investigation could not be read, so the link cannot be checked; try again");
  if (!inv) return fail(404, "NOT_FOUND", "that investigation is not on this encounter");
  if (inv.status === "cancelled")
    return fail(422, "INVESTIGATION_CANCELLED", "this investigation was not pursued, so a report cannot belong to it");

  let linked: string | null = null;
  let linkedTitle: string | null = null;
  if (args.incomingDocumentId) {
    const { data: doc, error: docErr } = await admin.from("practice_incoming_document")
      .select("id, patient_id, title").eq("id", trim(args.incomingDocumentId))
      .eq("workspace_id", ctx.workspaceId).maybeSingle();
    if (docErr) return fail(503, "DOCUMENT_UNAVAILABLE", "the inbox document could not be read, so the link cannot be checked; try again");
    if (!doc) return fail(404, "DOCUMENT_NOT_FOUND", "that inbox document does not exist in this practice");
    if (!doc.patient_id)
      return fail(422, "DOCUMENT_UNASSIGNED",
        "that inbox document is not assigned to a patient yet; assign it in the inbox first, then link it here");
    if (doc.patient_id !== enc.patient_id)
      return fail(422, "WRONG_PATIENT", "that document belongs to a different patient than this encounter");
    linked = doc.id; linkedTitle = doc.title ?? null;
  }

  const { error } = await admin.from(INVESTIGATION_TABLES.encounterInvestigation)
    .update({ linked_document_id: linked })
    .eq("id", inv.id).eq("workspace_id", ctx.workspaceId);
  if (error) return fail(422, "WRITE_FAILED", `the link was not recorded: ${error.message}`);

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId,
    eventType: linked ? "practice.investigation_report_linked" : "practice.investigation_report_unlinked",
    payload: { encounterId: args.encounterId, investigationId: inv.id, incomingDocumentId: linked },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: inv.id as string, linkedDocumentId: linked, ...(linkedTitle ? { linkedDocumentTitle: linkedTitle } : {}) } as any };
}

/**
 * CPR-INV-001 s8's third status.
 *
 * ⚠ THE REASON IS REQUIRED, because "not pursued" with no explanation is indistinguishable from a
 * mis-tap, and the next reader has to be able to tell those apart.
 */
export async function cancelInvestigation(admin: any, ctx: WorkspaceContext, args: {
  encounterId: string; investigationId: string; reason: string;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  if (!hasCapability(ctx, CAP_ENCOUNTER_EDIT))
    return fail(403, "FORBIDDEN", `changing an investigation needs ${CAP_ENCOUNTER_EDIT}`);
  const guard = await editableEncounter(admin, ctx.workspaceId, args.encounterId);
  if (!guard.ok) return guard;

  const reason = trim(args.reason);
  if (!reason) return fail(422, "VALIDATION_ERROR", "say why it was not pursued");

  const { data, error } = await admin.from(INVESTIGATION_TABLES.encounterInvestigation)
    .update({ status: "cancelled", cancelled_at: nowIso(), cancelled_reason: reason })
    .eq("workspace_id", ctx.workspaceId).eq("encounter_id", args.encounterId)
    .eq("id", args.investigationId).select("id").maybeSingle();
  if (error) return fail(422, "WRITE_FAILED", error.message);
  if (!data) return fail(404, "NOT_FOUND", "Not found");

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.investigation_not_pursued",
    payload: { encounterId: args.encounterId, investigationId: args.investigationId, reason },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: data.id as string } };
}

// ── CONFIGURATION WRITES -- CINV-CAP-001 s5 ─────────────────────────────────────────────────────────

/**
 * CPR-INV-001 s12 and CINV-CAP-001 s5: a local custom investigation, immediately selectable.
 *
 * ⚠ IT IS SCOPED TO THIS PRACTICE AND NEVER PROMOTED. s10: a local item stays local unless platform
 * governance deliberately promotes it, and there is no promotion path in this product.
 *
 * The code is GENERATED, never taken from the user. It is the stable identity historical rows point at,
 * and two practices inventing the same abbreviation must not collide.
 */
/**
 * CPR-INV-CAT-007 s12 (migration 301): teach the search this practice's own word for a test.
 *
 * ⚠ THE WRITER THE COLUMN SHIPPED WITH, IN THE SAME COMMIT. practice_investigation_alias.workspace_id
 * with nothing writing it would be the dead-FK class this codebase has now recorded three times --
 * attachment.document_id, attachment.procedure_id, and the unused procedureTypes prop before them.
 *
 * ⚠ AN ALIAS RESOLVES, IT NEVER CREATES (s5, s14). It points at an existing catalogue row -- platform
 * or this practice's own -- and the foreign key holds that. Nothing here can mint a definition, and a
 * word already taken for that investigation (globally or by this practice) is refused rather than
 * silently doubled.
 */
export async function addLocalAlias(admin: any, ctx: WorkspaceContext, args: {
  investigationId: string; alias: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ alias: string }>> {
  if (!hasCapability(ctx, CAP_INVESTIGATION_CONFIGURE))
    return fail(403, "FORBIDDEN", `teaching the catalogue a word needs ${CAP_INVESTIGATION_CONFIGURE}`);

  const alias = trim(args.alias);
  if (!alias || alias.length > 120)
    return fail(422, "VALIDATION_ERROR", "an alias needs 1 to 120 characters");

  const { data: inv } = await admin.from(INVESTIGATION_TABLES.catalogue)
    .select("id, workspace_id, canonical_name").eq("id", args.investigationId)
    .or(`workspace_id.is.null,workspace_id.eq.${ctx.workspaceId}`).maybeSingle();
  if (!inv) return fail(404, "NOT_FOUND", "Not found");

  const { error } = await admin.from(INVESTIGATION_TABLES.alias).insert({
    investigation_id: inv.id, alias, workspace_id: ctx.workspaceId,
  });
  if (error) {
    if (/duplicate|unique/i.test(error.message))
      return fail(409, "ALIAS_EXISTS", `"${alias}" already finds ${inv.canonical_name}`);
    return fail(400, "VALIDATION_ERROR", error.message);
  }

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId,
    eventType: "practice.investigation_alias_added",
    payload: { investigationId: inv.id, alias },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { alias } };
}

export async function createCustomInvestigation(admin: any, ctx: WorkspaceContext, args: {
  canonicalName: string; shortName?: string | null; category: string;
  subcategory?: string | null; aliases?: string[]; favourite?: boolean;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; code: string }>> {
  if (!hasCapability(ctx, CAP_INVESTIGATION_CONFIGURE))
    return fail(403, "FORBIDDEN", `creating a catalogue item needs ${CAP_INVESTIGATION_CONFIGURE}`);

  const canonicalName = trim(args.canonicalName);
  const category = trim(args.category);
  if (!canonicalName) return fail(422, "VALIDATION_ERROR", "a custom investigation needs a name");
  if (!category) return fail(422, "VALIDATION_ERROR", "a custom investigation needs a category");

  const code = `CUS-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const { data, error } = await admin.from(INVESTIGATION_TABLES.catalogue).insert({
    workspace_id: ctx.workspaceId, code, canonical_name: canonicalName,
    short_name: trim(args.shortName) || null, category,
    subcategory: trim(args.subcategory) || null, source_system: "Practice custom",
    active: true, created_by: args.actorId,
  }).select("id, code").single();
  if (error && isMissingTable(error)) return storeAbsent();
  if (error) return fail(422, "REFUSED_BY_DATABASE", error.message);

  const aliases = (args.aliases ?? []).map(trim).filter(Boolean).slice(0, 10);
  if (aliases.length > 0) {
    const { error: aliasErr } = await admin.from(INVESTIGATION_TABLES.alias)
      .insert(aliases.map(alias => ({ investigation_id: data.id, alias })));
    // ⚠ NOT DISCARDED. A silently dropped alias is an item that cannot be found by the abbreviation the
    // practice actually uses, which is the whole reason they typed one.
    if (aliasErr) console.error(`[practice] custom investigation aliases were not saved: ${aliasErr.message}`);
  }
  if (args.favourite) {
    await setInvestigationFavourite(admin, ctx, {
      investigationId: data.id, favourite: true, practitionerId: args.actorId,
      actorId: args.actorId, correlationId: args.correlationId,
    });
  }

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.investigation_catalogue_item_created",
    payload: { investigationId: data.id, code: data.code, canonicalName, category },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: data.id as string, code: data.code as string } };
}

/**
 * CINV-CAP-001 s5: enable, disable or locally rename a catalogue item.
 *
 * ⚠ THE MASTER ROW IS NEVER TOUCHED. This writes an activation row, which is what keeps a platform
 * catalogue update from overwriting local state -- s5's last bullet.
 */
export async function setInvestigationActivation(admin: any, ctx: WorkspaceContext, args: {
  investigationId: string; enabled?: boolean; localDisplayName?: string | null;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ investigationId: string; enabled: boolean; localDisplayName: string | null }>> {
  if (!hasCapability(ctx, CAP_INVESTIGATION_CONFIGURE))
    return fail(403, "FORBIDDEN", `changing the catalogue needs ${CAP_INVESTIGATION_CONFIGURE}`);

  const { data: item, error: itemErr } = await admin.from(INVESTIGATION_TABLES.catalogue)
    .select("id, workspace_id").eq("id", args.investigationId)
    .or(`workspace_id.is.null,workspace_id.eq.${ctx.workspaceId}`).maybeSingle();
  if (itemErr && isMissingTable(itemErr)) return storeAbsent();
  if (itemErr) return fail(503, "UNAVAILABLE", itemErr.message);
  if (!item) return fail(404, "NOT_FOUND", "Not found");

  const { data: current } = await admin.from(INVESTIGATION_TABLES.activation)
    .select("enabled, local_display_name")
    .eq("workspace_id", ctx.workspaceId).eq("investigation_id", args.investigationId).maybeSingle();

  const enabled = args.enabled === undefined ? (current ? !!current.enabled : true) : !!args.enabled;
  const localDisplayName = args.localDisplayName === undefined
    ? (current?.local_display_name ?? null)
    : (trim(args.localDisplayName) || null);

  const { error } = await admin.from(INVESTIGATION_TABLES.activation).upsert({
    workspace_id: ctx.workspaceId, investigation_id: args.investigationId,
    enabled, local_display_name: localDisplayName, updated_at: nowIso(), updated_by: args.actorId,
  }, { onConflict: "workspace_id,investigation_id" });
  if (error) return fail(422, "REFUSED_BY_DATABASE", error.message);

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.investigation_activation_changed",
    payload: { investigationId: args.investigationId, enabled, localDisplayName },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { investigationId: args.investigationId, enabled, localDisplayName } };
}

/** CINV-CAP-001 s7 / CPR-INV-001 s10's pin and unpin. A practitioner preference, not practice-wide. */
export async function setInvestigationFavourite(admin: any, ctx: WorkspaceContext, args: {
  investigationId: string; favourite: boolean; practitionerId: string;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ investigationId: string; favourite: boolean }>> {
  if (!hasCapability(ctx, CAP_ENCOUNTER_EDIT) && !hasCapability(ctx, CAP_INVESTIGATION_CONFIGURE))
    return fail(403, "FORBIDDEN", "pinning an investigation needs access to the encounter workflow");

  const { data: current } = await admin.from(INVESTIGATION_TABLES.preference)
    .select("usage_count, last_used_at").eq("workspace_id", ctx.workspaceId)
    .eq("practitioner_id", args.practitionerId).eq("investigation_id", args.investigationId).maybeSingle();

  const { error } = await admin.from(INVESTIGATION_TABLES.preference).upsert({
    workspace_id: ctx.workspaceId, practitioner_id: args.practitionerId,
    investigation_id: args.investigationId, favourite: !!args.favourite,
    usage_count: Number(current?.usage_count ?? 0), last_used_at: current?.last_used_at ?? null,
  }, { onConflict: "workspace_id,practitioner_id,investigation_id" });
  if (error && isMissingTable(error)) return storeAbsent();
  if (error) return fail(422, "REFUSED_BY_DATABASE", error.message);

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.investigation_favourite_changed",
    payload: { investigationId: args.investigationId, favourite: !!args.favourite },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { investigationId: args.investigationId, favourite: !!args.favourite } };
}

/**
 * CINV-CAP-001 s8: create or replace a set.
 *
 * ⚠ THE ITEMS ARE REPLACED WHOLESALE AND NOTHING HISTORICAL MOVES. s8: "Editing a set affects future
 * uses only; it must not rewrite historical encounter investigations." No encounter row references a
 * set at all, which is how that is guaranteed rather than promised.
 */
export async function saveInvestigationSet(admin: any, ctx: WorkspaceContext, args: {
  setId?: string | null; name: string; ownerType: "practice" | "practitioner";
  practitionerId: string; investigationIds: string[];
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; items: number }>> {
  if (!hasCapability(ctx, CAP_ENCOUNTER_EDIT))
    return fail(403, "FORBIDDEN", `saving a set needs ${CAP_ENCOUNTER_EDIT}`);
  // A PRACTICE-SHARED set is configuration everybody sees, so it needs the configuration capability.
  // A PERSONAL set is a preference and does not. CINV-CAP-001 s8's separate ownership, as permissions.
  if (args.ownerType === "practice" && !hasCapability(ctx, CAP_INVESTIGATION_CONFIGURE))
    return fail(403, "FORBIDDEN", `a practice-shared set needs ${CAP_INVESTIGATION_CONFIGURE}`);

  const name = trim(args.name);
  if (!name) return fail(422, "VALIDATION_ERROR", "a set needs a name");
  const ids = [...new Set((args.investigationIds ?? []).map(trim).filter(Boolean))];
  if (ids.length === 0) return fail(422, "VALIDATION_ERROR", "a set with nothing in it is not a set");

  const ownerId = args.ownerType === "practitioner" ? args.practitionerId : null;

  let setId = trim(args.setId) || null;
  if (setId) {
    const { data: existing } = await admin.from(INVESTIGATION_TABLES.set)
      .select("id, owner_type, owner_id").eq("id", setId).eq("workspace_id", ctx.workspaceId).maybeSingle();
    if (!existing) return fail(404, "NOT_FOUND", "Not found");
    // ⚠ SOMEBODY ELSE'S PERSONAL SET IS NOT EDITABLE. s8 separates ownership and this is where that bites.
    if (existing.owner_type === "practitioner" && existing.owner_id !== args.practitionerId)
      return fail(403, "FORBIDDEN", "that is another practitioner's personal set");
    const { error } = await admin.from(INVESTIGATION_TABLES.set)
      .update({ name }).eq("id", setId);
    if (error) return fail(422, "REFUSED_BY_DATABASE", error.message);
    await admin.from(INVESTIGATION_TABLES.setItem).delete().eq("set_id", setId);
  } else {
    const { data, error } = await admin.from(INVESTIGATION_TABLES.set).insert({
      workspace_id: ctx.workspaceId, owner_type: args.ownerType, owner_id: ownerId,
      name, active: true, created_by: args.actorId,
    }).select("id").single();
    if (error && isMissingTable(error)) return storeAbsent();
    if (error) return fail(422, "REFUSED_BY_DATABASE", error.message);
    setId = data.id as string;
  }

  const { error: itemErr } = await admin.from(INVESTIGATION_TABLES.setItem)
    .insert(ids.map((investigation_id, i) => ({ set_id: setId, investigation_id, sort_order: i })));
  if (itemErr) return fail(422, "REFUSED_BY_DATABASE", `the set was saved without its items: ${itemErr.message}`);

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.investigation_set_saved",
    payload: { setId, name, ownerType: args.ownerType, items: ids.length },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: setId as string, items: ids.length } };
}

/** Retire a set. DEACTIVATED, NOT DELETED -- the same call configuration.ts makes about a location. */
export async function retireInvestigationSet(admin: any, ctx: WorkspaceContext, args: {
  setId: string; practitionerId: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  if (!hasCapability(ctx, CAP_ENCOUNTER_EDIT))
    return fail(403, "FORBIDDEN", `retiring a set needs ${CAP_ENCOUNTER_EDIT}`);

  const { data: existing } = await admin.from(INVESTIGATION_TABLES.set)
    .select("id, owner_type, owner_id").eq("id", args.setId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!existing) return fail(404, "NOT_FOUND", "Not found");
  if (existing.owner_type === "practitioner" && existing.owner_id !== args.practitionerId)
    return fail(403, "FORBIDDEN", "that is another practitioner's personal set");
  if (existing.owner_type === "practice" && !hasCapability(ctx, CAP_INVESTIGATION_CONFIGURE))
    return fail(403, "FORBIDDEN", `a practice-shared set needs ${CAP_INVESTIGATION_CONFIGURE}`);

  const { error } = await admin.from(INVESTIGATION_TABLES.set).update({ active: false }).eq("id", args.setId);
  if (error) return fail(422, "REFUSED_BY_DATABASE", error.message);

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.investigation_set_retired",
    payload: { setId: args.setId }, correlationId: args.correlationId,
  });
  return { ok: true, data: { id: args.setId } };
}
