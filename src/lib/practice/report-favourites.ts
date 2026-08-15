import { hasCapability, type WorkspaceContext } from "@/lib/practice/access";
import { getPreferences } from "@/lib/practice/preferences";
import { reportTemplateById } from "@/lib/practice/report-templates";

// CPR-PI-001 v2 s12's Favourites row (Conditional) -- saved favourite report templates.
//
// A favourite is the PRACTITIONER's preference in this practice: it lives on their
// practice_user_preference row (migration 306's jsonb list), needs no capability beyond seeing the
// reports surface, and changes nothing about what any template computes. Ids are validated against
// the code catalogue ON READ AND ON WRITE -- the practice_cohort.segment_ids lesson: a stale or
// tampered row must not surface a template that no longer exists.

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function favouriteTemplates(admin: any, ctx: WorkspaceContext): Promise<string[]> {
  if (!hasCapability(ctx, "report.view")) return [];
  const { data } = await admin.from("practice_user_preference")
    .select("favourite_report_templates")
    .eq("workspace_id", ctx.workspaceId).eq("user_id", ctx.userId).maybeSingle();
  const raw = data?.favourite_report_templates;
  if (!Array.isArray(raw)) return [];
  return raw.filter((id: unknown): id is string => typeof id === "string" && !!reportTemplateById(id));
}

export async function setFavouriteTemplate(admin: any, ctx: WorkspaceContext, args: {
  templateId: string; favourite: boolean;
}): Promise<
  | { ok: true; favourites: string[] }
  | { ok: false; status: number; code: string; message: string }
> {
  if (!hasCapability(ctx, "report.view"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "favourites live on the reports surface, which needs report.view" };
  const tpl = reportTemplateById(args.templateId);
  if (!tpl)
    return { ok: false, status: 404, code: "UNKNOWN_TEMPLATE", message: `no report template is named "${args.templateId}"` };
  if (tpl.capability && !hasCapability(ctx, tpl.capability))
    return { ok: false, status: 403, code: "FORBIDDEN", message: `favouriting the ${tpl.name} report needs ${tpl.capability} -- a shortcut to a door you cannot open is a broken promise` };

  // getPreferences find-or-creates the row, so the update below always has a target.
  const pref = await getPreferences(admin, ctx.workspaceId, ctx.userId);
  const current = await favouriteTemplates(admin, ctx);
  const next = args.favourite
    ? [...new Set([...current, args.templateId])]
    : current.filter(id => id !== args.templateId);
  const { error } = await admin.from("practice_user_preference")
    .update({ favourite_report_templates: next, updated_at: new Date().toISOString() })
    .eq("id", pref.id);
  if (error) return { ok: false, status: 502, code: "FAVOURITE_SAVE_FAILED", message: error.message };
  return { ok: true, favourites: next };
}
