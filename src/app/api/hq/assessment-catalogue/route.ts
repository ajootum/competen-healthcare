import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { parseCatalogueQuery, isUuid } from "@/lib/assessment/catalogue/filters";
import { searchCatalogue, catalogueStats } from "@/lib/assessment/catalogue/search";
import { registerInstrument } from "@/lib/assessment/catalogue/register";
import { plainError } from "@/lib/assessment/catalogue/db";

// Request-time only: it reads the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// /api/hq/assessment-catalogue -- the Holdings Assessment & Checklist Catalogue (migration 894).
//
//   GET   hq.assessment.catalogue.view    the registry page: ?q, family, method, product, status, population, domain, setting,
//                                         level, owner, collection, sort, page (50 a page). Also { stats: 1 } for the tiles.
//   POST  hq.assessment.catalogue.manage  register an identity: { family, name, description?, terms?: [{ termId, isPrimary }] }.
//                                         The next code of the family is assigned in the same database transaction. NO version.
//
// ⚠ NOTHING THE BROWSER SENDS PICKS AN ACTOR. The person registering is the session's person. The catalogue holds metadata
// only: this route reads no assessment instance, response, evidence or outcome.

const refuse = (status: number, error: string) => NextResponse.json({ error }, { status });
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function GET(req: Request) {
  const ctx = await hqApiGate(["hq.assessment.catalogue.view"]);
  if (isHqRefusal(ctx)) return ctx;
  const url = new URL(req.url);
  try {
    if (url.searchParams.get("stats")) return NextResponse.json({ stats: await catalogueStats(ctx.admin) });
    const query = parseCatalogueQuery(Object.fromEntries(url.searchParams));
    return NextResponse.json(await searchCatalogue(ctx.admin, query));
  } catch (e) {
    return refuse(500, plainError(e));
  }
}

export async function POST(req: Request) {
  const ctx = await hqApiGate(["hq.assessment.catalogue.manage"]);
  if (isHqRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const family = text(body?.family, 6).toUpperCase();
  const name = text(body?.name, 200);
  if (!/^[A-Z]{1,6}$/.test(family)) return refuse(400, "Choose a family.");
  if (name.length < 3) return refuse(400, "Give the instrument a title of at least three characters.");
  const terms = Array.isArray(body?.terms)
    ? body.terms.filter((t: unknown): t is { termId: string; isPrimary?: boolean } => !!t && typeof t === "object" && isUuid((t as { termId?: unknown }).termId))
        .map((t: { termId: string; isPrimary?: boolean }) => ({ termId: t.termId, isPrimary: !!t.isPrimary }))
    : [];
  try {
    const made = await registerInstrument(ctx.admin, ctx.userId, { family, name, description: text(body?.description, 2000) || null, terms });
    return NextResponse.json(made, { status: 201 });
  } catch (e) {
    return refuse(400, plainError(e));
  }
}
