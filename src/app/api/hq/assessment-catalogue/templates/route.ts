import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { withOwnAppointments } from "@/lib/assessment/studio/appointed";
import { CAP } from "@/lib/assessment/studio/transitions";
import { createFromTemplate, listTemplates } from "@/lib/assessment/catalogue/template";
import { isUuid } from "@/lib/assessment/catalogue/filters";
import { plainError } from "@/lib/assessment/catalogue/db";

export const dynamic = "force-dynamic";

// /api/hq/assessment-catalogue/templates -- Create from template (ASMT-CATALOGUE-IMPORT-01, registration option 3).
//   GET   instruments with a published version, usable as templates
//   POST  { templateVersionId, family, name, description?, terms? } registers a new instrument whose first draft copies the
//         template's published content, settings, scoring, layouts and tags, and records the provenance as an adapted_from relation.
// Both admit a holder of hq.assessment.catalogue.manage OR of the Checklist authoring capability (owner decision 4, 3 Nov 2026),
// and a platform owner. The copy's author is the person creating it, so independence at review and publication is untouched.

const refuse = (status: number, error: string) => NextResponse.json({ error }, { status });
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

const ADMITS = ["hq.assessment.catalogue.manage", CAP.author];

export async function GET() {
  const ctx = await hqApiGate(ADMITS);
  if (isHqRefusal(ctx)) return ctx;
  try { return NextResponse.json({ templates: await listTemplates(ctx.admin) }); } catch (e) { return refuse(500, plainError(e)); }
}

export async function POST(req: Request) {
  const ctx = await withOwnAppointments(await hqApiGate(ADMITS));
  if (isHqRefusal(ctx)) return ctx;
  if (!(ctx.isOwner || ctx.capabilities.includes("hq.assessment.catalogue.manage") || ctx.capabilities.includes(CAP.author))) return refuse(403, "Creating from a template needs catalogue management or Checklist authoring, held through an appointment.");
  const b = await req.json().catch(() => ({}));
  if (!isUuid(b?.templateVersionId)) return refuse(400, "Choose a template.");
  const family = text(b?.family, 6).toUpperCase();
  const name = text(b?.name, 200);
  if (!/^[A-Z]{1,6}$/.test(family)) return refuse(400, "Choose a family.");
  if (name.length < 3) return refuse(400, "Give the instrument a title of at least three characters.");
  const terms = Array.isArray(b?.terms)
    ? b.terms.filter((t: unknown): t is { termId: string; isPrimary?: boolean } => !!t && typeof t === "object" && isUuid((t as { termId?: unknown }).termId))
        .map((t: { termId: string; isPrimary?: boolean }) => ({ termId: t.termId, isPrimary: !!t.isPrimary }))
    : [];
  try {
    const r = await createFromTemplate(ctx.admin, ctx.userId, { templateVersionId: b.templateVersionId, family, name, description: text(b?.description, 2000) || null, terms });
    return r.ok ? NextResponse.json(r, { status: 201 }) : refuse(r.status, r.error);
  } catch (e) {
    return refuse(400, plainError(e));
  }
}
