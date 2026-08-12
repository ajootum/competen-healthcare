// ⚠ NO CAPABILITY GATE ON THE READ, deliberately. This is the practice's own configuration -- the names
// of its visit types -- not patient data, and anybody already inside the workspace boundary needs it to
// render a booking form at all. Membership IS the gate, and ctx cannot be constructed without it.
// WRITING the taxonomy is a different matter and will require practice.settings.manage when the setup
// screens land.
import { type WorkspaceContext } from "@/lib/practice/access";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE BOOKING TAXONOMY (CP-BOOKING-TAXONOMY-001), read side.
//
// The spec's core rule: WHY the patient is being seen, HOW the consultation happens and WHERE the
// booking came from are three independent dimensions and must not share a dropdown. They used to: one
// appointment_type string held "new_consultation" and "teleconsultation" in the same list, so a
// teleconsultation had no recorded clinical purpose and a follow-up had no recorded mode.
//
// ⚠ A FAILED READ IS NOT AN EMPTY TAXONOMY, and on this module that distinction has teeth. An empty
// visit-type list renders as a dropdown with nothing in it, which reads to a practitioner as "this
// practice has not configured any" -- when in fact the query failed. Worse, a booking form that treats
// an empty list as "no constraint" would happily submit without a visit type at all. So every loader
// returns `readable`, and no caller may render an empty list without checking it.
//
// ⚠ THE CODE IS THE IDENTITY, THE LABEL IS DECORATION. Practices may rename "Follow-up" to whatever
// they call it; no logic may ever branch on the label. Section 6: "use stable IDs/codes for logic and
// configurable labels for display".
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type VisitType = {
  id: string;
  code: string;
  label: string;
  active: boolean;
  selfBookable: boolean;
  /** Minutes, or null where this type does not carry one and the session default stands. */
  defaultDurationMinutes: number | null;
  sortOrder: number;
  systemSeeded: boolean;
};

export type ConsultationMode = {
  id: string;
  code: string;
  label: string;
  active: boolean;
  selfBookable: boolean;
  /** False for Home visit and Teleconsultation: those do not need a clinic room. */
  requiresLocation: boolean;
  sortOrder: number;
  systemSeeded: boolean;
};

export type Taxonomy = {
  visitTypes: VisitType[];
  modes: ConsultationMode[];
  defaultVisitTypeId: string | null;
  defaultModeId: string | null;
  /** ⚠ FALSE means the lists below are NOT a statement about this practice. See the header. */
  readable: boolean;
  detail: string | null;
};

/** The frozen defaults, mirroring migration 292's seed. Provisioning writes these for a new practice. */
export const SEED_VISIT_TYPES: ReadonlyArray<{
  code: string; label: string; selfBookable: boolean; minutes: number | null; sortOrder: number;
}> = [
  { code: "new_consultation", label: "New consultation", selfBookable: true, minutes: 30, sortOrder: 10 },
  { code: "follow_up", label: "Follow-up", selfBookable: true, minutes: 15, sortOrder: 20 },
  { code: "urgent_review", label: "Urgent review", selfBookable: false, minutes: 20, sortOrder: 30 },
  { code: "procedure", label: "Procedure", selfBookable: false, minutes: 30, sortOrder: 40 },
  { code: "results_review", label: "Results review", selfBookable: true, minutes: 15, sortOrder: 50 },
  // ⚠ "Other" carries NO default duration on purpose. It is the catch-all, so any minutes figure here
  // would be a guess applied to every visit nobody had a better word for.
  { code: "other", label: "Other", selfBookable: false, minutes: null, sortOrder: 60 },
];

export const SEED_MODES: ReadonlyArray<{
  code: string; label: string; requiresLocation: boolean; sortOrder: number;
}> = [
  { code: "in_person", label: "In-person", requiresLocation: true, sortOrder: 10 },
  { code: "teleconsultation", label: "Teleconsultation", requiresLocation: false, sortOrder: 20 },
  { code: "home_visit", label: "Home visit", requiresLocation: false, sortOrder: 30 },
];

export const DEFAULT_VISIT_TYPE_CODE = "new_consultation";
export const DEFAULT_MODE_CODE = "in_person";

/** The provenance values. `unknown` is legacy-only and no new booking may be written with it. */
export const BOOKING_SOURCES = [
  "practitioner_created", "staff_created", "self_booked", "walk_in", "system",
] as const;
export type BookingSource = (typeof BOOKING_SOURCES)[number];

const EMPTY: Taxonomy = {
  visitTypes: [], modes: [], defaultVisitTypeId: null, defaultModeId: null,
  readable: true, detail: null,
};

/**
 * Everything a booking screen needs, in one read.
 *
 * `includeInactive` is for the CONFIGURATION screen only. A booking form must never offer an inactive
 * item (section 7: "cannot be selected for a new booking"), but the setup screen has to show them in
 * order to reactivate them -- and historical appointments keep pointing at them either way, which is
 * why the spec says deactivate and never delete.
 */
export async function loadTaxonomy(admin: any, ctx: WorkspaceContext, opts: {
  includeInactive?: boolean;
  /** s9: the public booking flow may only see what is marked self-bookable. */
  selfBookableOnly?: boolean;
} = {}): Promise<Taxonomy> {
  let vq = admin.from("practice_visit_type")
    .select("id, code, label, active, self_bookable, default_duration_minutes, sort_order, system_seeded")
    .eq("workspace_id", ctx.workspaceId).order("sort_order");
  let mq = admin.from("practice_consultation_mode")
    .select("id, code, label, active, self_bookable, requires_location, sort_order, system_seeded")
    .eq("workspace_id", ctx.workspaceId).order("sort_order");
  if (!opts.includeInactive) { vq = vq.eq("active", true); mq = mq.eq("active", true); }
  if (opts.selfBookableOnly) { vq = vq.eq("self_bookable", true); mq = mq.eq("self_bookable", true); }

  const [v, m, d] = await Promise.all([
    vq,
    mq,
    admin.from("practice_taxonomy_default").select("dimension, item_id").eq("workspace_id", ctx.workspaceId),
  ]);

  // ⚠ EITHER LIST FAILING MAKES THE WHOLE TAXONOMY UNREADABLE. Returning modes with an empty visit-type
  // list would let a booking form submit a mode and no purpose, which is the exact conflation this
  // whole arc exists to end.
  if (v.error || m.error)
    return { ...EMPTY, readable: false, detail: `the booking taxonomy could not be read: ${(v.error ?? m.error).message}` };

  const configured = new Map(((d.data ?? []) as any[]).map(r => [r.dimension, r.item_id as string]));
  const lists = {
    visitTypes: ((v.data ?? []) as any[]).map(r => ({
      id: r.id, code: r.code, label: r.label, active: !!r.active, selfBookable: !!r.self_bookable,
      defaultDurationMinutes: r.default_duration_minutes ?? null,
      sortOrder: r.sort_order ?? 100, systemSeeded: !!r.system_seeded,
    })),
    modes: ((m.data ?? []) as any[]).map(r => ({
      id: r.id, code: r.code, label: r.label, active: !!r.active, selfBookable: !!r.self_bookable,
      requiresLocation: r.requires_location !== false,
      sortOrder: r.sort_order ?? 100, systemSeeded: !!r.system_seeded,
    })),
  };

  return {
    ...lists,
    ...resolveDefaults(lists, configured.get("visit_type") ?? null, configured.get("consultation_mode") ?? null),
    readable: true,
    // A failed DEFAULTS read does not fail the taxonomy: the lists are still true and resolveDefaults
    // falls back to the first item. Reported rather than swallowed.
    detail: d.error ? `the practice default could not be read: ${d.error.message}` : null,
  };
}

/**
 * WHICH DEFAULTS ARE ACTUALLY USABLE. Pure, so the rule can be tested without a database.
 *
 * ⚠ A CONFIGURED DEFAULT THAT IS NOT IN THE OFFERED LIST IS DISCARDED. It happens the moment somebody
 * deactivates the item that was the default, and handing a form an id absent from its own options
 * selects nothing while looking like the user simply had not chosen. Falling back to the first offered
 * item is better than a blank, and better than silently booking against a deactivated type.
 */
export function resolveDefaults(
  t: Pick<Taxonomy, "visitTypes" | "modes">,
  configuredVisitTypeId: string | null,
  configuredModeId: string | null,
): { defaultVisitTypeId: string | null; defaultModeId: string | null } {
  const pick = (items: { id: string }[], configured: string | null) =>
    (configured && items.some(i => i.id === configured)) ? configured : (items[0]?.id ?? null);
  return {
    defaultVisitTypeId: pick(t.visitTypes, configuredVisitTypeId),
    defaultModeId: pick(t.modes, configuredModeId),
  };
}

export type TaxonomyChoice = {
  visitTypeId: string;
  consultationModeId: string;
  /** Resolved from the visit type unless the caller was permitted to override it. */
  durationMinutes: number | null;
};

/**
 * Section 7's validation, as one answer rather than a scatter of checks at each call site.
 *
 * ⚠ IT VALIDATES AGAINST THE ACTIVE LIST, so a booking cannot be made against a deactivated item even
 * if the id is real and the browser sent it. Never trust the client for this: the ids are visible in
 * the page source, and "inactive" is a configuration decision the server owns.
 */
export function validateChoice(t: Taxonomy, choice: {
  visitTypeId?: string | null; consultationModeId?: string | null; durationMinutes?: number | null;
}): { ok: true; value: TaxonomyChoice } | { ok: false; code: string; message: string } {
  if (!t.readable)
    return { ok: false, code: "TAXONOMY_UNAVAILABLE", message: t.detail ?? "the booking taxonomy could not be read" };

  const vt = t.visitTypes.find(v => v.id === choice.visitTypeId);
  if (!choice.visitTypeId)
    return { ok: false, code: "VISIT_TYPE_REQUIRED", message: "choose why this patient is being seen" };
  if (!vt)
    return {
      ok: false, code: "VISIT_TYPE_INVALID",
      message: "that visit type is not available for this practice -- it may have been deactivated since this page was opened",
    };

  const mode = t.modes.find(m => m.id === choice.consultationModeId);
  if (!choice.consultationModeId)
    return { ok: false, code: "MODE_REQUIRED", message: "choose how this consultation will happen" };
  if (!mode)
    return {
      ok: false, code: "MODE_INVALID",
      message: "that consultation mode is not available for this practice -- it may have been deactivated since this page was opened",
    };

  // The visit type's minutes stand unless a caller supplied its own, which only permitted callers do.
  const duration = choice.durationMinutes ?? vt.defaultDurationMinutes ?? null;
  if (duration !== null && (!Number.isInteger(duration) || duration < 5 || duration > 480))
    return { ok: false, code: "DURATION_INVALID", message: "an appointment lasts between 5 and 480 minutes" };

  return { ok: true, value: { visitTypeId: vt.id, consultationModeId: mode.id, durationMinutes: duration } };
}

/**
 * s2.3: booking source is provenance and is DERIVED, not asked for.
 *
 * ⚠ THE ONE VALUE A CALLER MAY ASSERT IS `walk_in`, and only from a workflow that genuinely captures
 * one. Everything else follows from who is acting: the patient-facing engine self-books, an
 * authenticated member of staff creates, a cron creates as the system. Letting a form post this field
 * would make the audit trail say whatever the browser wanted it to.
 */
export function deriveBookingSource(input: {
  channel: "patient_facing" | "in_house" | "system";
  isWalkIn?: boolean;
  actorIsPractitioner?: boolean;
}): BookingSource {
  if (input.isWalkIn) return "walk_in";
  if (input.channel === "patient_facing") return "self_booked";
  if (input.channel === "system") return "system";
  return input.actorIsPractitioner === false ? "staff_created" : "practitioner_created";
}

/**
 * Seed the frozen taxonomy for a NEW practice.
 *
 * ⚠ THIS EXISTS BECAUSE A MIGRATION SEEDS ONCE. Migration 292 filled every workspace that existed when
 * it ran, and nothing else, so without this the next practice provisioned comes up with two empty
 * dropdowns and cannot take a booking at all. This is the same failure the booking fallback contact hit
 * after migration 291, found only because a harness created a workspace minutes later.
 */
export async function seedTaxonomy(admin: any, workspaceId: string): Promise<{ ok: boolean; detail?: string }> {
  const { error: vErr } = await admin.from("practice_visit_type").upsert(
    SEED_VISIT_TYPES.map(v => ({
      workspace_id: workspaceId, code: v.code, label: v.label, active: true,
      self_bookable: v.selfBookable, default_duration_minutes: v.minutes,
      sort_order: v.sortOrder, system_seeded: true,
    })),
    { onConflict: "workspace_id,code", ignoreDuplicates: true },
  );
  if (vErr) return { ok: false, detail: `visit types: ${vErr.message}` };

  const { error: mErr } = await admin.from("practice_consultation_mode").upsert(
    SEED_MODES.map(m => ({
      workspace_id: workspaceId, code: m.code, label: m.label, active: true,
      self_bookable: true, requires_location: m.requiresLocation,
      sort_order: m.sortOrder, system_seeded: true,
    })),
    { onConflict: "workspace_id,code", ignoreDuplicates: true },
  );
  if (mErr) return { ok: false, detail: `modes: ${mErr.message}` };

  // The defaults have to point at the rows just written, so they are read back rather than assumed.
  const [{ data: vt }, { data: cm }] = await Promise.all([
    admin.from("practice_visit_type").select("id").eq("workspace_id", workspaceId).eq("code", DEFAULT_VISIT_TYPE_CODE).maybeSingle(),
    admin.from("practice_consultation_mode").select("id").eq("workspace_id", workspaceId).eq("code", DEFAULT_MODE_CODE).maybeSingle(),
  ]);
  const rows = [
    vt?.id ? { workspace_id: workspaceId, dimension: "visit_type", item_id: vt.id } : null,
    cm?.id ? { workspace_id: workspaceId, dimension: "consultation_mode", item_id: cm.id } : null,
  ].filter(Boolean);
  if (rows.length) {
    const { error } = await admin.from("practice_taxonomy_default")
      .upsert(rows as any[], { onConflict: "workspace_id,dimension", ignoreDuplicates: true });
    if (error) return { ok: false, detail: `defaults: ${error.message}` };
  }
  return { ok: true };
}
