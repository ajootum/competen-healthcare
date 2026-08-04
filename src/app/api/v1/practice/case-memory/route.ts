import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import {
  findSimilarCases, captureLearning, listLearning, deleteLearning,
  listCollections, createCollection, addToCollection, collectionCases, caseMemoryDashboard,
} from "@/lib/practice/case-memory";

// GET    /api/v1/practice/case-memory                      -- the Case Memory summary
// GET    /api/v1/practice/case-memory?similarTo=<enc>      -- cases sharing recorded facts with this one
// GET    /api/v1/practice/case-memory?view=learning        -- learning points (&mine=1 for the caller's)
// GET    /api/v1/practice/case-memory?view=collections     -- collections, with case counts
// GET    /api/v1/practice/case-memory?collectionId=<id>    -- one collection's cases
// POST   /api/v1/practice/case-memory                      -- capture a learning point, create a
//                                                             collection, or file a case into one
// DELETE /api/v1/practice/case-memory?learningId=<id>      -- remove your own learning point
//
// encounter.list THROUGHOUT: Case Memory reads consultations, and that is the capability meaning "may
// see consultations". It deliberately does NOT ask for patient.view -- learning from a case does not
// require knowing whose it was, and the engine de-identifies for callers who lack it.

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("encounter.list");
  if (isDenied(auth)) return auth;

  const url = new URL(req.url);
  const similarTo = url.searchParams.get("similarTo");
  const collectionId = url.searchParams.get("collectionId");

  if (similarTo) {
    const found = await findSimilarCases(auth.caller.admin, auth.ctx, {
      encounterId: similarTo,
      limit: Math.min(Math.max(Number(url.searchParams.get("limit")) || 10, 1), 50),
    });
    if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ...found, correlationId: auth.caller.traceId });
  }

  if (collectionId) {
    const c = await collectionCases(auth.caller.admin, auth.ctx, collectionId);
    if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ...c, correlationId: auth.caller.traceId });
  }

  switch (url.searchParams.get("view")) {
    case "learning": {
      const learning = await listLearning(auth.caller.admin, auth.ctx, {
        mine: url.searchParams.get("mine") === "1",
        encounterId: url.searchParams.get("encounterId") ?? undefined,
        kind: url.searchParams.get("kind") ?? undefined,
      });
      return NextResponse.json({ learning, correlationId: auth.caller.traceId });
    }
    case "collections": {
      const collections = await listCollections(auth.caller.admin, auth.ctx);
      return NextResponse.json({ collections, correlationId: auth.caller.traceId });
    }
    default: {
      const summary = await caseMemoryDashboard(auth.caller.admin, auth.ctx);
      return NextResponse.json({ ...summary, correlationId: auth.caller.traceId });
    }
  }
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("encounter.list");
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const fail = (r: { code: string; message: string; status: number }) =>
    NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });

  if (body.collection) {
    const c = body.collection as Record<string, unknown>;
    const result = await createCollection(auth.caller.admin, auth.ctx, {
      name: String(c.name ?? ""), description: c.description ? String(c.description) : undefined,
      shared: c.shared === true, correlationId: auth.caller.traceId,
    });
    if (!result.ok) return fail(result);
    return NextResponse.json({ collection: result.data, correlationId: auth.caller.traceId }, { status: 201 });
  }

  if (body.addToCollection) {
    const a = body.addToCollection as Record<string, unknown>;
    const result = await addToCollection(auth.caller.admin, auth.ctx, {
      collectionId: String(a.collectionId ?? ""), encounterId: String(a.encounterId ?? ""),
      note: a.note ? String(a.note) : undefined,
    });
    if (!result.ok) return fail(result);
    // added:false means it was already there. 200 rather than 201, because nothing was created -- but
    // not an error, because the caller's intention is satisfied either way.
    return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId },
      { status: result.data.added ? 201 : 200 });
  }

  // A LEARNING POINT IS A CLINICAL WRITE against a consultation, so it takes encounter.edit on top of
  // the encounter.list this route already required.
  if (!auth.ctx.capabilities.includes("encounter.edit"))
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "encounter.edit is required to write against a consultation" } }, { status: 403 });

  const result = await captureLearning(auth.caller.admin, auth.ctx, {
    encounterId: String(body.encounterId ?? ""), kind: String(body.kind ?? "observation"),
    body: String(body.body ?? ""), correlationId: auth.caller.traceId,
  });
  if (!result.ok) return fail(result);
  return NextResponse.json({ learning: result.data, correlationId: auth.caller.traceId }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const auth = await requirePracticeContext("encounter.list");
  if (isDenied(auth)) return auth;

  const learningId = new URL(req.url).searchParams.get("learningId");
  if (!learningId) return NextResponse.json({ error: "learningId is required" }, { status: 400 });

  const result = await deleteLearning(auth.caller.admin, auth.ctx, {
    id: learningId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId });
}
