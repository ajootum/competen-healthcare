import { hasCapability, type WorkspaceContext } from "@/lib/practice/access";
import { audit } from "@/lib/practice/audit";
import { loadTaxonomy, type Taxonomy } from "@/lib/practice/taxonomy";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CONFIGURING THE BOOKING TAXONOMY (CP-BOOKING-TAXONOMY-001 s4), write side.
//
// "All taxonomy must be configurable from Practice Setup without code deployment."
//
// ⚠ NOTHING HERE DELETES. s4 is explicit -- "Delete after use: No; deactivate" -- and the reason is in
// s4's next line: "historical appointments retain their stored taxonomy reference and remain
// interpretable after an item is deactivated". A deleted visit type turns every appointment that used
// it into a row pointing at nothing, and a year of history stops being readable. So the only way out of
// the list is `active = false`, and there is no delete function in this file to reach for later.
//
// ⚠ THE CODE IS IMMUTABLE, THE LABEL IS NOT. s4: "system codes/IDs are immutable after creation; display
// labels may change". Renaming a label is a display change; renaming a code would silently redefine
// every historical row that carries it.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type AdminResult<T = Record<string, unknown>> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string };

type Dimension = "visit_type" | "consultation_mode";
const TABLE: Record<Dimension, string> = {
  visit_type: "practice_visit_type",
  consultation_mode: "practice_consultation_mode",
};

const deny = (): AdminResult<never> => ({
  ok: false, status: 403, code: "FORBIDDEN",
  message: "changing this practice's booking taxonomy needs the settings permission",
});

/** A new code from a typed label: lowercase, underscored, and stable from that moment on. */
export function codeFromLabel(label: string): string {
  return label.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

/**
 * Add a practice's own item. s4: "add custom item -- yes", for both dimensions.
 *
 * ⚠ THE CODE IS DERIVED ONCE AND NEVER AGAIN. Deriving it from the label on every save would mean
 * renaming "Follow-up" to "Review" silently redefined every appointment already pointing at it.
 */
export async function addTaxonomyItem(admin: any, ctx: WorkspaceContext, input: {
  dimension: Dimension;
  label: string;
  selfBookable?: boolean;
  defaultDurationMinutes?: number | null;
  requiresLocation?: boolean;
  correlationId?: string;
}): Promise<AdminResult<{ id: string; code: string }>> {
  if (!hasCapability(ctx, "practice.settings.manage")) return deny();

  const label = input.label.trim();
  if (!label) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a name is required" };
  const code = codeFromLabel(label);
  if (!code)
    return {
      ok: false, status: 400, code: "VALIDATION_ERROR",
      message: "that name has no letters or numbers in it, so it cannot become a stable code",
    };

  const duration = input.defaultDurationMinutes ?? null;
  if (duration !== null && (!Number.isInteger(duration) || duration < 5 || duration > 480))
    return { ok: false, status: 422, code: "DURATION_INVALID", message: "a default duration is between 5 and 480 minutes" };

  // New items sort after everything seeded, rather than jumping to the top of somebody's list.
  const { data: last } = await admin.from(TABLE[input.dimension])
    .select("sort_order").eq("workspace_id", ctx.workspaceId)
    .order("sort_order", { ascending: false }).limit(1).maybeSingle();

  const row: Record<string, unknown> = {
    workspace_id: ctx.workspaceId, code, label, active: true,
    self_bookable: input.selfBookable === true,
    sort_order: (last?.sort_order ?? 0) + 10,
    system_seeded: false,
  };
  if (input.dimension === "visit_type") row.default_duration_minutes = duration;
  else row.requires_location = input.requiresLocation !== false;

  const { data, error } = await admin.from(TABLE[input.dimension]).insert(row).select("id, code").single();
  if (error) {
    if (/duplicate|unique/i.test(error.message))
      return {
        ok: false, status: 409, code: "ALREADY_EXISTS",
        message: `this practice already has an entry whose code is "${code}" -- rename the existing one rather than adding a second`,
      };
    return { ok: false, status: 400, code: "WRITE_FAILED", message: error.message };
  }

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.taxonomy_item_added",
    payload: { dimension: input.dimension, itemId: data.id, code: data.code, label },
    correlationId: input.correlationId,
  });
  return { ok: true, data: { id: data.id, code: data.code } };
}

/**
 * Rename, reorder, set self-bookable, set duration. s4's editable properties, in one call.
 *
 * ⚠ THE CODE IS NOT AMONG THEM, and cannot be added to this function's input without also answering what
 * happens to every appointment already carrying the old one.
 */
export async function updateTaxonomyItem(admin: any, ctx: WorkspaceContext, input: {
  dimension: Dimension;
  itemId: string;
  label?: string;
  sortOrder?: number;
  selfBookable?: boolean;
  defaultDurationMinutes?: number | null;
  requiresLocation?: boolean;
  correlationId?: string;
}): Promise<AdminResult> {
  if (!hasCapability(ctx, "practice.settings.manage")) return deny();

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.label !== undefined) {
    const label = input.label.trim();
    if (!label) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a name is required" };
    patch.label = label;
  }
  if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder;
  if (input.selfBookable !== undefined) patch.self_bookable = input.selfBookable;
  if (input.dimension === "visit_type" && input.defaultDurationMinutes !== undefined) {
    const d = input.defaultDurationMinutes;
    if (d !== null && (!Number.isInteger(d) || d < 5 || d > 480))
      return { ok: false, status: 422, code: "DURATION_INVALID", message: "a default duration is between 5 and 480 minutes" };
    patch.default_duration_minutes = d;
  }
  if (input.dimension === "consultation_mode" && input.requiresLocation !== undefined)
    patch.requires_location = input.requiresLocation;

  // ⚠ THE WORKSPACE FILTER IS THE TENANT BOUNDARY. service_role bypasses RLS, so an id from another
  // practice would otherwise be perfectly writable from here.
  const { data, error } = await admin.from(TABLE[input.dimension]).update(patch)
    .eq("id", input.itemId).eq("workspace_id", ctx.workspaceId).select("id").maybeSingle();
  if (error) return { ok: false, status: 400, code: "WRITE_FAILED", message: error.message };
  if (!data) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.taxonomy_item_updated",
    payload: { dimension: input.dimension, itemId: input.itemId, changed: Object.keys(patch) },
    correlationId: input.correlationId,
  });
  return { ok: true, data: {} };
}

/**
 * Activate or deactivate. THE ONLY WAY OUT OF A BOOKING LIST -- see the header on why nothing deletes.
 *
 * Two refusals, both from s4:
 *   "AT LEAST ONE ACTIVE CONSULTATION MODE MUST EXIST." A practice with none cannot take a booking at
 *   all, and the screen that broke it would be the one place least likely to explain why.
 *   AND THE PRACTICE DEFAULT CANNOT BE SWITCHED OFF beneath itself. resolveDefaults would quietly fall
 *   back to the first remaining item, so nothing would look broken -- bookings would simply start being
 *   filed as something nobody chose.
 */
export async function setTaxonomyItemActive(admin: any, ctx: WorkspaceContext, input: {
  dimension: Dimension; itemId: string; active: boolean; correlationId?: string;
}): Promise<AdminResult> {
  if (!hasCapability(ctx, "practice.settings.manage")) return deny();

  if (!input.active) {
    const { data: actives, error } = await admin.from(TABLE[input.dimension])
      .select("id").eq("workspace_id", ctx.workspaceId).eq("active", true);
    // ⚠ A FAILED COUNT IS NOT A COUNT OF ZERO, and here it would authorise the very change the check
    // exists to prevent. Refuse, rather than deactivate on the strength of a read that did not happen.
    if (error)
      return {
        ok: false, status: 503, code: "PRECHECK_UNAVAILABLE",
        message: "the other entries could not be read, so this cannot safely be switched off yet",
      };
    const remaining = ((actives ?? []) as any[]).filter(a => a.id !== input.itemId).length;
    if (remaining === 0)
      return {
        ok: false, status: 422, code: "LAST_ACTIVE_ITEM",
        message: input.dimension === "consultation_mode"
          ? "this is the only active consultation mode, and a practice with none cannot take a booking -- add or reactivate another first"
          : "this is the only active visit type, and a booking has to record why the patient is being seen -- add or reactivate another first",
      };

    const { data: def } = await admin.from("practice_taxonomy_default")
      .select("item_id").eq("workspace_id", ctx.workspaceId).eq("dimension", input.dimension).maybeSingle();
    if (def?.item_id === input.itemId)
      return {
        ok: false, status: 422, code: "ITEM_IS_DEFAULT",
        message: "this is the practice default -- choose a different default first, then switch this one off",
      };
  }

  const { data, error } = await admin.from(TABLE[input.dimension])
    .update({ active: input.active, updated_at: new Date().toISOString() })
    .eq("id", input.itemId).eq("workspace_id", ctx.workspaceId).select("id").maybeSingle();
  if (error) return { ok: false, status: 400, code: "WRITE_FAILED", message: error.message };
  if (!data) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId,
    eventType: input.active ? "practice.taxonomy_item_activated" : "practice.taxonomy_item_deactivated",
    payload: { dimension: input.dimension, itemId: input.itemId },
    correlationId: input.correlationId,
  });
  return { ok: true, data: {} };
}

/**
 * s4: "only one practice-level default Visit Type and one default Consultation Mode may be configured
 * at a time" -- which the primary key on practice_taxonomy_default enforces rather than this code.
 *
 * ⚠ AN INACTIVE ITEM CANNOT BECOME THE DEFAULT. It would be offered to nobody and selected by nothing,
 * so every booking form would fall back to its first option while the setup screen insisted otherwise.
 */
export async function setTaxonomyDefault(admin: any, ctx: WorkspaceContext, input: {
  dimension: Dimension; itemId: string; correlationId?: string;
}): Promise<AdminResult> {
  if (!hasCapability(ctx, "practice.settings.manage")) return deny();

  const { data: item, error: readErr } = await admin.from(TABLE[input.dimension])
    .select("id, active").eq("id", input.itemId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (readErr) return { ok: false, status: 400, code: "WRITE_FAILED", message: readErr.message };
  if (!item) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (!item.active)
    return {
      ok: false, status: 422, code: "ITEM_INACTIVE",
      message: "an entry that is switched off cannot be the default -- switch it on first",
    };

  const { error } = await admin.from("practice_taxonomy_default").upsert(
    { workspace_id: ctx.workspaceId, dimension: input.dimension, item_id: input.itemId, updated_at: new Date().toISOString() },
    { onConflict: "workspace_id,dimension" },
  );
  if (error) return { ok: false, status: 400, code: "WRITE_FAILED", message: error.message };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.taxonomy_default_set",
    payload: { dimension: input.dimension, itemId: input.itemId }, correlationId: input.correlationId,
  });
  return { ok: true, data: {} };
}

/** Everything the setup screen shows, including switched-off entries so they can be switched back on. */
export async function taxonomyForSetup(admin: any, ctx: WorkspaceContext): Promise<{
  taxonomy: Taxonomy;
  permitted: boolean;
  /**
   * ⚠ WHAT s4 ASKS FOR AND MIGRATION 292 CANNOT STORE. "Restrict by location" needs a join table that
   * does not exist, so the screen says so rather than offering a control that would silently do nothing.
   * Named here so it travels with the data instead of living in one page's markup.
   */
  notYetConfigurable: string[];
}> {
  const taxonomy = await loadTaxonomy(admin, { workspaceId: ctx.workspaceId }, { includeInactive: true });
  return {
    taxonomy,
    permitted: hasCapability(ctx, "practice.settings.manage"),
    notYetConfigurable: [
      "Restricting a visit type or mode to particular locations (s4) -- this needs a store that does not exist yet, so it is not offered rather than being offered and ignored.",
    ],
  };
}
