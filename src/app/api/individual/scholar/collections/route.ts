import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { createCollection, deleteCollection, isUuid, listCollections } from "@/lib/individual/scholar/store";
import { cleanCollectionName } from "@/lib/individual/scholar/library";
import { audit } from "@/lib/individual/scholar/http";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// /api/individual/scholar/collections -- COMPETEN-SCHOLAR-UPLOAD-01 U5, the student's own shelves (migration 407).
//
// GET lists the caller's collections. POST { name } makes one (a name the caller already uses is refused).
// DELETE { id } removes one of the caller's: its materials are kept, taken off the shelf. Everything is keyed
// on the caller's own id. Where 407 is absent the answer says so (409), and the library offers no collections.

export async function GET() {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const r = await listCollections(ctx.admin, ctx.userId);
  if (!r.ok) return NextResponse.json({ error: r.notProvisioned ? "Collections are not available here yet." : "Your collections could not be read just now." }, { status: r.notProvisioned ? 409 : 503 });
  return NextResponse.json({ collections: r.data });
}

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const name = cleanCollectionName(body?.name);
  if (!name.ok) return NextResponse.json({ error: name.error }, { status: 400 });
  const r = await createCollection(ctx.admin, ctx.userId, name.value);
  if (!r.ok) {
    if (r.error === "exists") return NextResponse.json({ error: "You already have a collection with that name." }, { status: 409 });
    if (r.error === "not_provisioned") return NextResponse.json({ error: "Collections are not available here yet." }, { status: 409 });
    return NextResponse.json({ error: "The collection could not be made just now. Try again shortly." }, { status: 500 });
  }
  await audit(ctx, "individual_scholar_collection_created", "individual_scholar_collection", r.id, {});
  return NextResponse.json({ ok: true, id: r.id });
}

export async function DELETE(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  if (!isUuid(body?.id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const r = await deleteCollection(ctx.admin, ctx.userId, body.id);
  if (r === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (r === "failed") return NextResponse.json({ error: "The collection could not be removed just now. Try again shortly." }, { status: 500 });
  await audit(ctx, "individual_scholar_collection_deleted", "individual_scholar_collection", body.id, {});
  return NextResponse.json({ ok: true });
}
