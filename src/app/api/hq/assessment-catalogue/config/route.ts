import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { isUuid } from "@/lib/assessment/catalogue/filters";
import { loadFamilies, createFamily, updateFamily } from "@/lib/assessment/catalogue/families";
import { loadTaxonomy, createTerm, updateTerm, updateDimension } from "@/lib/assessment/catalogue/classify";
import { loadCollections, createCollection, updateCollection } from "@/lib/assessment/catalogue/collections";
import { loadProductLines } from "@/lib/assessment/catalogue/availability";
import { plainError } from "@/lib/assessment/catalogue/db";

export const dynamic = "force-dynamic";

// /api/hq/assessment-catalogue/config -- the catalogue's lists and their upkeep.
//   GET   hq.assessment.catalogue.view    { families, taxonomy (dimensions with terms), collections, productLines }
//   POST  hq.assessment.catalogue.manage  { action, ... }
//           family_create      { code, label, position? }          the code is permanent (it prefixes every instrument code)
//           family_update      { code, label?, isActive?, position? }
//           dimension_update   { code, label?, isActive?, position?, allowsHierarchy? }
//           term_create        { dimensionCode, label, code?, parentId?, sourceKind?, sourceRef? }
//           term_update        { termId, label?, isActive?, position?, parentId? }
//           collection_create  { code, name, description? }
//           collection_update  { collectionId, name?, description?, isActive? }

const refuse = (status: number, error: string) => NextResponse.json({ error }, { status });
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : undefined);
const bool = (v: unknown) => (typeof v === "boolean" ? v : undefined);

export async function GET() {
  const ctx = await hqApiGate(["hq.assessment.catalogue.view"]);
  if (isHqRefusal(ctx)) return ctx;
  try {
    const [families, taxonomy, collections, productLines] = await Promise.all([
      loadFamilies(ctx.admin, { withCounts: true }), loadTaxonomy(ctx.admin), loadCollections(ctx.admin), loadProductLines(ctx.admin),
    ]);
    return NextResponse.json({ families, taxonomy, collections, productLines });
  } catch (e) {
    return refuse(500, plainError(e));
  }
}

export async function POST(req: Request) {
  const ctx = await hqApiGate(["hq.assessment.catalogue.manage"]);
  if (isHqRefusal(ctx)) return ctx;
  const b = await req.json().catch(() => ({}));
  try {
    switch (b?.action) {
      case "family_create": await createFamily(ctx.admin, { code: text(b.code, 6), label: text(b.label, 120), position: num(b.position) }); break;
      case "family_update": await updateFamily(ctx.admin, text(b.code, 6).toUpperCase(), { label: b.label === undefined ? undefined : text(b.label, 120), isActive: bool(b.isActive), position: num(b.position) }); break;
      case "dimension_update": await updateDimension(ctx.admin, text(b.code, 40), { label: b.label === undefined ? undefined : text(b.label, 120), isActive: bool(b.isActive), position: num(b.position), allowsHierarchy: bool(b.allowsHierarchy) }); break;
      case "term_create":
        await createTerm(ctx.admin, {
          dimensionCode: text(b.dimensionCode, 40), label: text(b.label, 120), code: text(b.code, 60) || undefined,
          parentId: isUuid(b.parentId) ? b.parentId : null, sourceKind: text(b.sourceKind, 41) || null, sourceRef: isUuid(b.sourceRef) ? b.sourceRef : null, position: num(b.position),
        });
        break;
      case "term_update":
        if (!isUuid(b.termId)) return refuse(400, "Choose the term.");
        await updateTerm(ctx.admin, b.termId, {
          label: b.label === undefined ? undefined : text(b.label, 120), isActive: bool(b.isActive), position: num(b.position),
          parentId: b.parentId === undefined ? undefined : isUuid(b.parentId) ? b.parentId : null,
        });
        break;
      case "collection_create": await createCollection(ctx.admin, ctx.userId, { code: text(b.code, 40), name: text(b.name, 120), description: text(b.description, 500) || null }); break;
      case "collection_update":
        if (!isUuid(b.collectionId)) return refuse(400, "Choose the collection.");
        await updateCollection(ctx.admin, b.collectionId, { name: b.name === undefined ? undefined : text(b.name, 120), description: b.description === undefined ? undefined : text(b.description, 500) || null, isActive: bool(b.isActive) });
        break;
      default: return refuse(400, "Unknown action.");
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return refuse(400, plainError(e));
  }
}
