import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import {
  writeReflection, reviseReflection, lockReflection, setReflectionVisibility,
  commitToAction, promoteLearning, listReflections, getReflection, reflectionJournal,
  REFLECTION_CATEGORIES, REFLECTION_PROMPTS, REFLECTION_LIMITS,
} from "@/lib/practice/reflection";

// GET   /api/v1/practice/reflections               -- the caller's journal, plus what colleagues shared
// GET   /api/v1/practice/reflections?id=<id>       -- one reflection, its history, actions and learnings
// GET   /api/v1/practice/reflections?view=journal  -- the summary
// POST  /api/v1/practice/reflections               -- write one, commit to an action, promote a learning
// PATCH /api/v1/practice/reflections               -- revise, lock, or change who can see it
//
// NO CAPABILITY IS REQUIRED TO REFLECT. Reflecting on your own practice is not a permission somebody
// grants; `practice.home.view` is the floor for being a member at all. What IS gated is what a
// reflection touches -- promoting a learning point goes through CPR-220, which asks for encounter.edit.

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("practice.home.view");
  if (isDenied(auth)) return auth;

  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (id) {
    const one = await getReflection(auth.caller.admin, auth.ctx, id);
    // A colleague's PRIVATE reflection is a 404, not a 403 -- "you may not read it" confirms it exists.
    if (!one) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ...one, correlationId: auth.caller.traceId });
  }

  if (url.searchParams.get("view") === "journal") {
    const journal = await reflectionJournal(auth.caller.admin, auth.ctx);
    return NextResponse.json({ ...journal, correlationId: auth.caller.traceId });
  }

  const reflections = await listReflections(auth.caller.admin, auth.ctx, {
    mineOnly: url.searchParams.get("mine") === "1",
    encounterId: url.searchParams.get("encounterId") ?? undefined,
    category: url.searchParams.get("category") ?? undefined,
  });
  return NextResponse.json({
    reflections, categories: REFLECTION_CATEGORIES, prompts: REFLECTION_PROMPTS,
    limits: REFLECTION_LIMITS, correlationId: auth.caller.traceId,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("practice.home.view");
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const fail = (r: { code: string; message: string; status: number }) =>
    NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });

  if (body.action) {
    const a = body.action as Record<string, unknown>;
    const result = await commitToAction(auth.caller.admin, auth.ctx, {
      reflectionId: String(a.reflectionId ?? ""), title: String(a.title ?? ""),
      detail: a.detail ? String(a.detail) : undefined,
      dueOn: a.dueOn ? String(a.dueOn) : null, correlationId: auth.caller.traceId,
    });
    if (!result.ok) return fail(result);
    return NextResponse.json({ task: result.data, correlationId: auth.caller.traceId }, { status: 201 });
  }

  if (body.promote) {
    const p = body.promote as Record<string, unknown>;
    const result = await promoteLearning(auth.caller.admin, auth.ctx, {
      reflectionId: String(p.reflectionId ?? ""), kind: String(p.kind ?? "observation"),
      body: String(p.body ?? ""), correlationId: auth.caller.traceId,
    });
    if (!result.ok) return fail(result);
    return NextResponse.json({ learning: result.data, correlationId: auth.caller.traceId }, { status: 201 });
  }

  const result = await writeReflection(auth.caller.admin, auth.ctx, {
    encounterId: body.encounterId ? String(body.encounterId) : null,
    procedureId: body.procedureId ? String(body.procedureId) : null,
    category: body.category ? String(body.category) : undefined,
    wentWell: body.wentWell ? String(body.wentWell) : undefined,
    couldImprove: body.couldImprove ? String(body.couldImprove) : undefined,
    learned: body.learned ? String(body.learned) : undefined,
    willDoDifferently: body.willDoDifferently ? String(body.willDoDifferently) : undefined,
    narrative: body.narrative ? String(body.narrative) : undefined,
    correlationId: auth.caller.traceId,
  });
  if (!result.ok) return fail(result);
  return NextResponse.json({ reflection: result.data, correlationId: auth.caller.traceId }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const auth = await requirePracticeContext("practice.home.view");
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const fail = (r: { code: string; message: string; status: number }) =>
    NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });
  const id = String(body.id);

  if (body.lock === true) {
    const result = await lockReflection(auth.caller.admin, auth.ctx, { id, correlationId: auth.caller.traceId });
    if (!result.ok) return fail(result);
    return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId });
  }

  if (body.visibility !== undefined) {
    const v = body.visibility === "practice" ? "practice" : "private";
    const result = await setReflectionVisibility(auth.caller.admin, auth.ctx, {
      id, visibility: v, correlationId: auth.caller.traceId,
    });
    if (!result.ok) return fail(result);
    return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId });
  }

  const result = await reviseReflection(auth.caller.admin, auth.ctx, {
    id,
    category: body.category ? String(body.category) : undefined,
    wentWell: body.wentWell === undefined ? undefined : String(body.wentWell),
    couldImprove: body.couldImprove === undefined ? undefined : String(body.couldImprove),
    learned: body.learned === undefined ? undefined : String(body.learned),
    willDoDifferently: body.willDoDifferently === undefined ? undefined : String(body.willDoDifferently),
    narrative: body.narrative === undefined ? undefined : String(body.narrative),
    correlationId: auth.caller.traceId,
  });
  if (!result.ok) return fail(result);
  return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId });
}
