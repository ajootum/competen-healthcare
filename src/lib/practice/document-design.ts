import { audit } from "@/lib/practice/audit";
import { hasCapability, type WorkspaceContext } from "@/lib/practice/access";
import type { EngineResult } from "@/lib/practice/encounters";
import {
  PLATFORM_BASELINE, presetTokens, validateTokens,
  type PresetName, type StyleTokens, PRESETS,
} from "@/lib/practice/document-style";

// CPR-DOC-CONFIG-001 sections 11, 13 and 14 -- SAVING, PUBLISHING AND VERSIONING A PRACTICE STYLE.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// PUBLISHING IS THE ONLY ACT THAT CHANGES ANYTHING. A draft can be saved, previewed and abandoned
// freely -- section 11: "Stores configuration without changing documents generated for normal use."
// Only publish moves the practice, and only publish needs the confirmation section 17 describes.
//
// ⚠ AND IT CHANGES THE FUTURE ONLY. Documents already generated carry a style_id pinning what they
// were rendered with, so publishing repaints nothing that exists. That guarantee lives in the pin
// (migration 357) and in resolveStyle, not here -- this module could not break it if it tried, which
// is the point of putting it there.
//
// ONE PUBLISHED STYLE PER PRACTICE IS THE DATABASE'S JOB. The generated published_slot column makes a
// second one uninsertable, so the demotion below is how the old one gets out of the way, not how the
// rule is enforced. If this code forgot to demote, the insert would fail rather than silently leaving
// two published styles.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// NO NEW CAPABILITY, AND THAT IS DELIBERATE. Section 13 allows "Practice owner/admin or explicit
// document-design capability" and requires the current capability model rather than role names.
// practice.settings.manage already means "may change practice-wide configuration", which is exactly
// what this is. Minting a document.design capability would need a catalogue insert AND a backfill onto
// every existing membership -- and this codebase has shipped the insert without the backfill before,
// locking every existing practice out of a feature while every harness stayed green. If a separate
// capability is wanted later it is a governed change, not a line in this file.

/* eslint-disable @typescript-eslint/no-explicit-any */

export const DESIGN_CAPABILITY = "practice.settings.manage";

export type StyleSummary = {
  id: string; name: string; version: number; status: string;
  preset: string | null; publishedAt: string | null; archivedAt: string | null;
};

const summarise = (r: any): StyleSummary => ({
  id: r.id, name: r.name, version: r.version, status: r.status,
  preset: r.preset ?? null, publishedAt: r.published_at ?? null, archivedAt: r.archived_at ?? null,
});

/** Every style this practice has, newest first, plus the tokens of the one being edited. */
export async function listStyles(admin: any, ctx: WorkspaceContext): Promise<{
  styles: StyleSummary[]; baseline: StyleTokens;
}> {
  const { data } = await admin.from("practice_document_style")
    .select("id, name, version, status, preset, published_at, archived_at")
    .eq("workspace_id", ctx.workspaceId).order("version", { ascending: false }).limit(50);
  return { styles: ((data ?? []) as any[]).map(summarise), baseline: PLATFORM_BASELINE };
}

export async function getStyle(admin: any, ctx: WorkspaceContext, id: string):
  Promise<{ summary: StyleSummary; tokens: StyleTokens } | null> {
  const { data } = await admin.from("practice_document_style")
    .select("id, name, version, status, preset, published_at, archived_at, tokens")
    .eq("id", id).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!data) return null;
  return { summary: summarise(data), tokens: data.tokens as StyleTokens };
}

async function nextVersion(admin: any, workspaceId: string): Promise<number> {
  const { data } = await admin.from("practice_document_style")
    .select("version").eq("workspace_id", workspaceId)
    .order("version", { ascending: false }).limit(1).maybeSingle();
  return (data?.version ?? 0) + 1;
}

/**
 * Create or update a DRAFT.
 *
 * ⚠ A PUBLISHED STYLE IS NEVER EDITED IN PLACE. Section 11 wants published versions to stay available
 * for revert, and a signed document pins one by id -- editing its tokens would change the appearance
 * of the letters that point at it, which is exactly what the pin exists to prevent. Editing a
 * published style therefore forks a new draft, and the practitioner publishes that when ready.
 */
export async function saveDraft(admin: any, ctx: WorkspaceContext, args: {
  id?: string | null; name?: string; preset?: string | null; tokens: unknown; correlationId: string;
}): Promise<EngineResult<{ id: string; version: number; forked: boolean }>> {
  if (!hasCapability(ctx, DESIGN_CAPABILITY))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "you cannot change the practice document style" };

  const problems = validateTokens(args.tokens);
  if (problems.length)
    return {
      ok: false, status: 422, code: "STYLE_NOT_VALID",
      message: problems.map(p => p.message).join("; "),
    };

  const name = (args.name ?? "Practice style").trim().slice(0, 80) || "Practice style";
  const preset = args.preset && PRESETS.includes(args.preset as PresetName) ? args.preset : null;

  if (args.id) {
    const existing = await getStyle(admin, ctx, args.id);
    if (!existing) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
    if (existing.summary.status === "draft") {
      const { error } = await admin.from("practice_document_style").update({
        name, preset, tokens: args.tokens, updated_by: ctx.userId, updated_at: new Date().toISOString(),
      }).eq("id", args.id);
      if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
      return { ok: true, data: { id: args.id, version: existing.summary.version, forked: false } };
    }
    // Published or archived: fork rather than edit. See the header.
  }

  const version = await nextVersion(admin, ctx.workspaceId);
  const { data, error } = await admin.from("practice_document_style").insert({
    workspace_id: ctx.workspaceId, name, version, status: "draft", preset, tokens: args.tokens,
    created_by: ctx.userId, updated_by: ctx.userId,
  }).select("id").maybeSingle();
  if (error || !data) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error?.message ?? "could not save" };

  return { ok: true, data: { id: data.id as string, version, forked: !!args.id } };
}

/**
 * Make a draft the practice's style.
 *
 * The previously published one is ARCHIVED rather than deleted -- section 11: "Archive stops future use
 * but preserves historical rendering provenance." Documents pinned to it keep rendering from it, which
 * is why it must survive.
 */
export async function publishStyle(admin: any, ctx: WorkspaceContext, args: {
  id: string; correlationId: string;
}): Promise<EngineResult<{ id: string; version: number; replaced: string | null }>> {
  if (!hasCapability(ctx, DESIGN_CAPABILITY))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "you cannot publish the practice document style" };

  const draft = await getStyle(admin, ctx, args.id);
  if (!draft) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (draft.summary.status === "published")
    return { ok: false, status: 422, code: "ALREADY_PUBLISHED", message: "that style is already the practice style" };

  // Re-validated at the moment of publishing, not only when it was saved. A draft can outlive a
  // tightening of the rules, and publishing is the act that puts it in front of patients.
  const problems = validateTokens(draft.tokens);
  if (problems.length)
    return { ok: false, status: 422, code: "STYLE_NOT_VALID", message: problems.map(p => p.message).join("; ") };

  const { data: current } = await admin.from("practice_document_style")
    .select("id").eq("workspace_id", ctx.workspaceId).eq("status", "published").maybeSingle();

  // Demote first: the unique index on published_slot refuses a second published row, so this is
  // ordering, not enforcement.
  if (current) {
    await admin.from("practice_document_style")
      .update({ status: "archived", archived_at: new Date().toISOString(), updated_by: ctx.userId })
      .eq("id", current.id);
  }

  const { error } = await admin.from("practice_document_style").update({
    status: "published", published_at: new Date().toISOString(), published_by: ctx.userId,
    updated_by: ctx.userId,
  }).eq("id", args.id);
  if (error) {
    // Put the old one back rather than leaving the practice with no published style at all.
    if (current) {
      await admin.from("practice_document_style")
        .update({ status: "published", archived_at: null }).eq("id", current.id);
    }
    return { ok: false, status: 400, code: "PUBLISH_FAILED", message: error.message };
  }

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.configuration.activated",
    payload: {
      what: "document_style", styleId: args.id, version: draft.summary.version,
      replaced: current?.id ?? null,
    },
    correlationId: args.correlationId,
  });

  return { ok: true, data: { id: args.id, version: draft.summary.version, replaced: current?.id ?? null } };
}

/**
 * Section 11's "Restore default": stop using any practice style, so future documents take the platform
 * baseline. The archived versions stay, because documents pinned to them still render from them.
 */
export async function restoreDefault(admin: any, ctx: WorkspaceContext, args: { correlationId: string }):
  Promise<EngineResult<{ restored: boolean }>> {
  if (!hasCapability(ctx, DESIGN_CAPABILITY))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "you cannot change the practice document style" };

  const { data: current } = await admin.from("practice_document_style")
    .select("id").eq("workspace_id", ctx.workspaceId).eq("status", "published").maybeSingle();
  if (!current) return { ok: true, data: { restored: false } };

  await admin.from("practice_document_style")
    .update({ status: "archived", archived_at: new Date().toISOString(), updated_by: ctx.userId })
    .eq("id", current.id);

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.configuration.rolled_back",
    payload: { what: "document_style", styleId: current.id },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { restored: true } };
}

/** A fresh draft from one of section 5's presets. */
export async function draftFromPreset(admin: any, ctx: WorkspaceContext, args: {
  preset: string; correlationId: string;
}): Promise<EngineResult<{ id: string; version: number; forked: boolean }>> {
  if (!PRESETS.includes(args.preset as PresetName))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "that is not one of the themes" };
  const name = args.preset.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  return saveDraft(admin, ctx, {
    name, preset: args.preset, tokens: presetTokens(args.preset as PresetName),
    correlationId: args.correlationId,
  });
}
