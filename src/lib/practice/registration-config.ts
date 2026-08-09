import { audit } from "@/lib/practice/audit";
import type { EngineResult } from "@/lib/practice/encounters";
import { type WorkspaceContext } from "@/lib/practice/access";
import { conditionMet, type FieldCondition } from "@/lib/practice/registration-condition";

// CPR-PRM-001 s2, s9 -- THE REGISTRATION CONFIGURATION FRAMEWORK.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// "CONFIGURATION REPLACES HARD-CODED FORMS" -- BUT NOT THE MINIMUM DATASET.
//
// registerPatient refuses a registration with no name, with neither a date of birth nor an age
// estimate, and with neither a phone nor an email. If a template could hide those, either the engine
// still refuses -- and the practice gets an error about a field their own form never showed them, which
// they cannot fix from where they are standing -- or the engine stops refusing, and a safety rule has
// been switched off by configuration.
//
// So PROTECTED_FIELDS lives HERE, next to the rule it protects, and not in a table an administrator can
// edit. A floor that can be lowered is not a floor.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

const nowIso = () => new Date().toISOString();

/**
 * The core fields, and which of them a template may not touch.
 *
 * `group` is the either/or: birth_date and age_estimate_years satisfy one requirement between them, and
 * so do phone and email. Hiding ONE of a pair is allowed -- a practice that always records a date of
 * birth may hide the estimate. Hiding BOTH is not.
 */
// THE OPTIONS ON A CORE SELECT ARE THE DATABASE'S CHECK CONSTRAINT, WRITTEN OUT.
//
// practice_patient.sex and .preferred_contact_method both carry CHECK constraints (migrations 193 and
// 221). A template that offered a value outside them would build a form whose submission the database
// refuses -- and the registration desk would have no way to tell which of the choices on their own
// screen was the impossible one. Kept here so the two can be asserted equal.
const SEX_OPTIONS = [
  { value: "female", label: "Female" }, { value: "male", label: "Male" },
  { value: "other", label: "Other" }, { value: "unknown", label: "Unknown" },
  { value: "unspecified", label: "Not stated" },
];
const CONTACT_METHOD_OPTIONS = [
  { value: "phone", label: "Phone call" }, { value: "sms", label: "SMS" },
  { value: "email", label: "Email" }, { value: "in_person", label: "In person" },
  { value: "via_relative", label: "Via a relative" }, { value: "none", label: "Do not contact" },
];

export const CORE_FIELDS = [
  { key: "display_name", label: "Full name", type: "text", protected: true, group: "name", options: [] },
  { key: "sex", label: "Sex", type: "select", protected: false, group: null, options: SEX_OPTIONS },
  { key: "birth_date", label: "Date of birth", type: "date", protected: true, group: "age", options: [] },
  { key: "age_estimate_years", label: "Estimated age", type: "number", protected: true, group: "age", options: [] },
  { key: "phone", label: "Phone", type: "phone", protected: true, group: "contact", options: [] },
  { key: "email", label: "Email", type: "email", protected: true, group: "contact", options: [] },
  { key: "address", label: "Address", type: "long_text", protected: false, group: null, options: [] },
  { key: "preferred_contact_method", label: "Preferred contact", type: "select", protected: false, group: null, options: CONTACT_METHOD_OPTIONS },
  { key: "preferred_language", label: "Preferred language", type: "text", protected: false, group: null, options: [] },
  { key: "practice_note", label: "Practice note", type: "long_text", protected: false, group: null, options: [] },
] as const;

export const FIELD_TYPES = [
  "text", "long_text", "number", "date", "select", "multi_select", "boolean", "phone", "email",
] as const;

const coreField = (key: string) => CORE_FIELDS.find(f => f.key === key);

/** Every protected group, and which keys can satisfy it. */
const PROTECTED_GROUPS = [...new Set(CORE_FIELDS.filter(f => f.protected).map(f => f.group))]
  .map(group => ({
    group: group as string,
    keys: CORE_FIELDS.filter(f => f.protected && f.group === group).map(f => f.key),
  }));

// ── THE CONDITION EVALUATOR ──────────────────────────────────────────────────────────────────────────
//
// ⚠ IT LIVES IN registration-condition.ts NOW, AND IS RE-EXPORTED FROM HERE.
//
// Not a tidying. This module imports `audit` (node:crypto) and WorkspaceContext (next/headers), so a
// "use client" component that imported the evaluator from here would pull the server into the browser
// bundle. The evaluator is pure and had no business being on that side of the line -- and until it
// moved, the FORM had no way to reach it, so every conditional field was validated conditionally by
// this file and then drawn unconditionally on screen. A practice that asked for a guardian's name only
// for a minor showed that field to everybody.
//
// Re-exported rather than relocated-and-rewired so `conditionMet` still has exactly one definition and
// every existing importer of it keeps working.
export { conditionMet };
export type { FieldCondition };

// ── AUTHORING ────────────────────────────────────────────────────────────────────────────────────────

export async function listTemplates(admin: any, ctx: WorkspaceContext) {
  const { data } = await admin.from("practice_registration_template")
    .select("*").eq("workspace_id", ctx.workspaceId)
    .order("status").order("name");
  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  const { data: fields } = await admin.from("practice_registration_field")
    .select("template_id").in("template_id", rows.map(r => r.id));
  const counts = new Map<string, number>();
  for (const f of ((fields ?? []) as any[])) counts.set(f.template_id, (counts.get(f.template_id) ?? 0) + 1);

  return rows.map(r => ({ ...r, fields: counts.get(r.id) ?? 0 }));
}

export async function createTemplate(admin: any, ctx: WorkspaceContext, args: {
  name: string; specialty?: string; country?: string; practiceType?: string;
  seedCoreFields?: boolean; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  if (!ctx.capabilities.includes("practice.settings.manage"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "practice.settings.manage is required" };
  if (args.name.trim().length < 2)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a template needs a name" };

  const { data, error } = await admin.from("practice_registration_template").insert({
    workspace_id: ctx.workspaceId, name: args.name.trim(),
    specialty: args.specialty?.trim() || null, country: args.country?.trim() || null,
    practice_type: args.practiceType?.trim() || null,
    status: "draft", created_by: ctx.userId, updated_by: ctx.userId,
  }).select("id").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  // SEEDED WITH THE CORE FIELDS BY DEFAULT, because a template that starts empty is one whose first
  // publish attempt fails on the protected floor -- and being told what is missing is less useful than
  // starting with it already there.
  if (args.seedCoreFields !== false) {
    await admin.from("practice_registration_field").insert(
      CORE_FIELDS.map((f, i) => ({
        workspace_id: ctx.workspaceId, template_id: data.id, field_key: f.key, is_core: true,
        label: f.label, field_type: f.type, visible: true, options: f.options,
        required: f.key === "display_name", display_order: (i + 1) * 10,
      })),
    );
  }

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.reg_template_created",
    payload: { templateId: data.id, name: args.name.trim() }, correlationId: args.correlationId,
  });
  return { ok: true, data: { id: data.id as string } };
}

export async function upsertField(admin: any, ctx: WorkspaceContext, args: {
  templateId: string; fieldKey: string; label?: string; help?: string; fieldType?: string;
  required?: boolean; visible?: boolean; displayOrder?: number;
  options?: { value: string; label: string }[]; condition?: FieldCondition | null;
  correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  if (!ctx.capabilities.includes("practice.settings.manage"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "practice.settings.manage is required" };

  const { data: template } = await admin.from("practice_registration_template")
    .select("id, status").eq("id", args.templateId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!template) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  // A PUBLISHED TEMPLATE IS NOT EDITED IN PLACE. Somebody is filling it in right now, and changing what
  // is required underneath them would refuse a form that was valid when it opened.
  if (template.status === "published")
    return { ok: false, status: 409, code: "PUBLISHED", message: "this template is live -- retire it or copy it to a draft before changing it" };

  if (!/^[a-z][a-z0-9_]{1,40}$/.test(args.fieldKey))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a field key is lowercase letters, digits and underscores" };
  if (args.fieldType && !(FIELD_TYPES as readonly string[]).includes(args.fieldType))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `unknown field type: ${args.fieldType}` };

  const core = coreField(args.fieldKey);

  // THE FLOOR, ENFORCED AT THE POINT OF EDIT rather than only at publish, so the refusal arrives while
  // the person is looking at the field they just changed.
  if (core?.protected) {
    if (args.visible === false || args.required === false) {
      const siblings = PROTECTED_GROUPS.find(g => g.group === core.group)!.keys.filter(k => k !== core.key);
      if (siblings.length === 0)
        return {
          ok: false, status: 422, code: "PROTECTED_FIELD",
          message: `${core.label} cannot be hidden or made optional -- a patient record without it cannot be created at all`,
        };
      // For an either/or pair, hiding one is fine as long as the other survives. Checked at publish,
      // where the whole template is visible; here it is allowed through.
    }
    if (args.fieldType && args.fieldType !== core.type)
      return { ok: false, status: 422, code: "PROTECTED_FIELD", message: `${core.label} is a ${core.type} field and cannot be retyped` };
  }

  const row: Record<string, unknown> = {
    workspace_id: ctx.workspaceId, template_id: args.templateId, field_key: args.fieldKey,
    is_core: !!core,
    label: args.label?.trim() || core?.label || args.fieldKey,
    help: args.help?.trim() || null,
    field_type: core ? core.type : (args.fieldType ?? "text"),
    required: args.required ?? false,
    visible: args.visible ?? true,
    display_order: args.displayOrder ?? 999,
    // A CORE SELECT KEEPS THE DATABASE'S OWN LIST unless the caller supplies one -- so an edit that
    // touches only `required` cannot silently empty the choices and make the template unpublishable.
    options: args.options ?? (core ? [...core.options] : []),
    condition: args.condition ?? null,
  };

  const { data: existing } = await admin.from("practice_registration_field")
    .select("id").eq("template_id", args.templateId).eq("field_key", args.fieldKey).maybeSingle();

  if (existing) {
    const { error } = await admin.from("practice_registration_field").update(row).eq("id", existing.id);
    if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
    return { ok: true, data: { id: existing.id as string } };
  }
  const { data, error } = await admin.from("practice_registration_field").insert(row).select("id").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  return { ok: true, data: { id: data.id as string } };
}

/**
 * Everything wrong with a template, before it can go live.
 *
 * VALIDATED AT PUBLISH, NOT AT EVERY EDIT, so a template can be built over several sittings -- but a
 * broken one can never reach a registration desk.
 */
export async function validateTemplate(admin: any, ctx: WorkspaceContext, templateId: string) {
  const { data } = await admin.from("practice_registration_field")
    .select("*").eq("template_id", templateId).eq("workspace_id", ctx.workspaceId).order("display_order");
  const fields = (data ?? []) as any[];
  const problems: { field: string | null; problem: string }[] = [];

  // 1. THE PROTECTED FLOOR. Every group needs at least one visible, required member.
  for (const g of PROTECTED_GROUPS) {
    const members = fields.filter(f => g.keys.includes(f.field_key));
    const usable = members.filter(f => f.visible && f.required);
    if (usable.length === 0) {
      const labels = g.keys.map(k => coreField(k)!.label).join(" or ");
      problems.push({
        field: g.keys[0],
        problem: `${labels} has to be visible and required -- a patient cannot be registered without it, so a form that omits it can never be submitted`,
      });
    }
  }

  const byKey = new Map(fields.map(f => [f.field_key, f]));

  for (const f of fields) {
    // 2. A select with no options is a question with no answers.
    if ((f.field_type === "select" || f.field_type === "multi_select") &&
        (!Array.isArray(f.options) || f.options.length === 0))
      problems.push({ field: f.field_key, problem: `"${f.label}" is a list with nothing in it` });

    if (!f.condition) continue;
    const when = (f.condition as any).when;

    // 3. A CONDITION ON A FIELD THAT IS NOT ON THE FORM CAN NEVER FIRE, so the field it governs never
    //    appears -- a question silently missing from a registration form.
    if (!byKey.has(when)) {
      problems.push({ field: f.field_key, problem: `"${f.label}" depends on "${when}", which is not on this form` });
      continue;
    }
    if (!byKey.get(when)!.visible)
      problems.push({ field: f.field_key, problem: `"${f.label}" depends on "${when}", which is hidden -- it could never appear` });

    // 4. A PROTECTED FIELD BEHIND A CONDITION IS A HIDDEN PROTECTED FIELD by another route.
    if (coreField(f.field_key)?.protected)
      problems.push({ field: f.field_key, problem: `"${f.label}" is required for every patient and cannot be made conditional` });
  }

  // 5. A CYCLE. A depends on B depends on A: neither ever appears, and nothing else says why.
  for (const f of fields) {
    const seen = new Set<string>([f.field_key]);
    let cursor = f.condition ? (f.condition as any).when : null;
    // A HARD CAP AS WELL AS THE seen SET. The cycle check below is the only thing that ends this walk
    // when the conditions loop, which makes the termination of a server-side validator depend on one
    // `if` -- and a validator that hangs takes the request with it. The set is what REPORTS the cycle;
    // the cap is what guarantees this returns.
    let steps = 0;
    while (cursor && byKey.has(cursor) && steps++ <= fields.length) {
      if (seen.has(cursor)) {
        problems.push({ field: f.field_key, problem: `"${f.label}" is in a loop of conditions -- none of them can ever appear` });
        break;
      }
      seen.add(cursor);
      cursor = byKey.get(cursor)!.condition ? (byKey.get(cursor)!.condition as any).when : null;
    }
  }

  return { fields, problems, publishable: problems.length === 0 };
}

export async function publishTemplate(admin: any, ctx: WorkspaceContext, args: {
  templateId: string; makeDefault?: boolean; correlationId: string;
}): Promise<EngineResult<{ status: string; version: number }>> {
  if (!ctx.capabilities.includes("practice.settings.manage"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "practice.settings.manage is required" };

  const { data: template } = await admin.from("practice_registration_template")
    .select("*").eq("id", args.templateId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!template) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (template.status === "published") return { ok: true, data: { status: "published", version: template.version } };

  const check = await validateTemplate(admin, ctx, args.templateId);
  if (!check.publishable)
    return {
      ok: false, status: 422, code: "NOT_PUBLISHABLE",
      message: check.problems.map(p => p.problem).join("; "),
    };

  // A new default displaces the old one first, so the partial unique index cannot refuse the publish.
  if (args.makeDefault) {
    await admin.from("practice_registration_template")
      .update({ is_default: false, updated_at: nowIso() })
      .eq("workspace_id", ctx.workspaceId).eq("is_default", true).eq("status", "published");
  }

  const { data: updated, error } = await admin.from("practice_registration_template").update({
    status: "published", is_default: args.makeDefault === true,
    published_at: nowIso(), published_by: ctx.userId, updated_at: nowIso(), updated_by: ctx.userId,
  }).eq("id", template.id).select("id, version");
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  if (!updated || updated.length === 0)
    return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.reg_template_published",
    payload: { templateId: template.id, isDefault: args.makeDefault === true }, correlationId: args.correlationId,
  });
  return { ok: true, data: { status: "published", version: updated[0].version } };
}

/**
 * Copy a template into a new draft.
 *
 * WITHOUT THIS, PUBLISHING IS A ONE-WAY DOOR. A published template cannot be edited in place -- somebody
 * is filling it in right now -- so the only way to change a live form is to copy it, edit the copy, and
 * publish that. An editor with no copy button strands every practice on its first version.
 */
export async function duplicateTemplate(admin: any, ctx: WorkspaceContext, args: {
  templateId: string; name?: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  if (!ctx.capabilities.includes("practice.settings.manage"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "practice.settings.manage is required" };

  const { data: source } = await admin.from("practice_registration_template")
    .select("*").eq("id", args.templateId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!source) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  const { data: created, error } = await admin.from("practice_registration_template").insert({
    workspace_id: ctx.workspaceId,
    name: args.name?.trim() || `${source.name} (copy)`,
    specialty: source.specialty, country: source.country, practice_type: source.practice_type,
    // A COPY IS ALWAYS A DRAFT, and never the default -- publishing it is a separate, deliberate act.
    status: "draft", is_default: false,
    version: source.version + 1,
    created_by: ctx.userId, updated_by: ctx.userId,
  }).select("id").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  const { data: fields } = await admin.from("practice_registration_field")
    .select("*").eq("template_id", source.id);
  const rows = ((fields ?? []) as any[]).map(f => ({
    workspace_id: ctx.workspaceId, template_id: created.id, field_key: f.field_key,
    is_core: f.is_core, label: f.label, help: f.help, field_type: f.field_type,
    required: f.required, visible: f.visible, display_order: f.display_order,
    options: f.options, condition: f.condition,
  }));
  if (rows.length) {
    const { error: copyError } = await admin.from("practice_registration_field").insert(rows);
    // A COPY MISSING ITS FIELDS IS WORSE THAN NO COPY -- it looks like an empty form somebody made on
    // purpose. Removed rather than left behind.
    if (copyError) {
      await admin.from("practice_registration_template").delete().eq("id", created.id);
      return { ok: false, status: 500, code: "COPY_FAILED", message: `the fields could not be copied, so nothing was created: ${copyError.message}` };
    }
  }

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.reg_template_copied",
    payload: { from: source.id, to: created.id }, correlationId: args.correlationId,
  });
  return { ok: true, data: { id: created.id as string } };
}

/** Remove a field. Core fields are hidden rather than deleted, so the floor cannot be dodged. */
export async function removeField(admin: any, ctx: WorkspaceContext, args: {
  templateId: string; fieldKey: string; correlationId: string;
}): Promise<EngineResult<{ removed: true }>> {
  if (!ctx.capabilities.includes("practice.settings.manage"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "practice.settings.manage is required" };

  const { data: template } = await admin.from("practice_registration_template")
    .select("id, status").eq("id", args.templateId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!template) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (template.status === "published")
    return { ok: false, status: 409, code: "PUBLISHED", message: "this template is live -- copy it to a draft before changing it" };

  // DELETING A PROTECTED CORE FIELD WOULD DODGE THE FLOOR, which only checks the fields that are
  // present. Refused by name so it reads as a rule rather than a glitch.
  if (coreField(args.fieldKey)?.protected)
    return {
      ok: false, status: 422, code: "PROTECTED_FIELD",
      message: `${coreField(args.fieldKey)!.label} cannot be removed -- a patient record cannot be created without it`,
    };

  // ANYTHING THAT DEPENDED ON IT WOULD BECOME UNREACHABLE, so the dependants are cleared rather than
  // left pointing at a field that is gone -- which publish would then refuse with a confusing message.
  await admin.from("practice_registration_field")
    .update({ condition: null })
    .eq("template_id", args.templateId).contains("condition", { when: args.fieldKey });

  await admin.from("practice_registration_field")
    .delete().eq("template_id", args.templateId).eq("field_key", args.fieldKey);
  return { ok: true, data: { removed: true } };
}

/** Take a published template out of service. */
export async function retireTemplate(admin: any, ctx: WorkspaceContext, args: {
  templateId: string; correlationId: string;
}): Promise<EngineResult<{ status: string }>> {
  if (!ctx.capabilities.includes("practice.settings.manage"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "practice.settings.manage is required" };

  const { data: updated, error } = await admin.from("practice_registration_template")
    .update({ status: "retired", is_default: false, updated_at: nowIso(), updated_by: ctx.userId })
    .eq("id", args.templateId).eq("workspace_id", ctx.workspaceId).select("id");
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  if (!updated || updated.length === 0)
    return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.reg_template_retired",
    payload: { templateId: args.templateId }, correlationId: args.correlationId,
  });
  return { ok: true, data: { status: "retired" } };
}

/** One template with its fields, for the editor. */
export async function getTemplate(admin: any, ctx: WorkspaceContext, templateId: string) {
  const { data: template } = await admin.from("practice_registration_template")
    .select("*").eq("id", templateId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!template) return null;
  const check = await validateTemplate(admin, ctx, templateId);
  return { template, fields: check.fields, problems: check.problems, publishable: check.publishable };
}

// ── USING A TEMPLATE ─────────────────────────────────────────────────────────────────────────────────

/**
 * Which template a registration should use.
 *
 * MOST SPECIFIC WINS, and specificity is counted rather than ranked: a template naming a specialty AND
 * a country beats one naming only a country. A tie falls back to the default, then to nothing -- and
 * "nothing" is a legitimate answer that means the built-in form, not an error.
 */
export async function resolveTemplate(admin: any, ctx: WorkspaceContext, context: {
  specialty?: string | null; country?: string | null; practiceType?: string | null;
} = {}) {
  const { data } = await admin.from("practice_registration_template")
    .select("*").eq("workspace_id", ctx.workspaceId).eq("status", "published");
  const rows = (data ?? []) as any[];
  if (rows.length === 0) return null;

  const matches = rows.filter(t =>
    (!t.specialty || t.specialty === context.specialty) &&
    (!t.country || t.country === context.country) &&
    (!t.practice_type || t.practice_type === context.practiceType));
  if (matches.length === 0) return null;

  const specificity = (t: any) => [t.specialty, t.country, t.practice_type].filter(Boolean).length;
  matches.sort((a, b) => specificity(b) - specificity(a) || (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0));
  const chosen = matches[0];

  const { data: fields } = await admin.from("practice_registration_field")
    .select("*").eq("template_id", chosen.id).order("display_order");

  return { template: chosen, fields: (fields ?? []) as any[] };
}

/**
 * Check a filled-in form against its template.
 *
 * THE SERVER DECIDES, using the same evaluator the form used. A field whose condition is not met is not
 * required and its value is DISCARDED -- keeping it would store an answer to a question that was never
 * asked, which is worse than losing it: somebody reads it later as though it had been.
 */
export function validateSubmission(fields: any[], values: Record<string, unknown>): {
  ok: boolean; missing: { key: string; label: string }[];
  applicable: string[]; customFields: Record<string, unknown>;
} {
  const missing: { key: string; label: string }[] = [];
  const applicable: string[] = [];
  const customFields: Record<string, unknown> = {};

  for (const f of fields) {
    if (!f.visible) continue;
    if (!conditionMet(f.condition, values)) continue;
    applicable.push(f.field_key);

    const v = values[f.field_key];
    const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
    if (f.required && empty) missing.push({ key: f.field_key, label: f.label });
    if (!f.is_core && !empty) customFields[f.field_key] = v;
  }

  return { ok: missing.length === 0, missing, applicable, customFields };
}
