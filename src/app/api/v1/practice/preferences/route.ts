import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import {
  resolvePreferences, updatePreferences, resetPreferences,
  exportPreferences, importPreferences, configurationChecklist,
} from "@/lib/practice/preferences";

// GET    /api/v1/practice/preferences          -- CPR-360 personal settings, resolved against the practice.
// PATCH  /api/v1/practice/preferences          -- change some of them.
// PUT    /api/v1/practice/preferences          -- import a preferences file.
// DELETE /api/v1/practice/preferences          -- reset to defaults.
//
// NO CAPABILITY IS REQUIRED beyond membership, and that is deliberate. Every other route in this product
// names one, but a person's own theme, text size and dashboard layout are not a permission a practice
// grants -- withholding them would mean somebody who needs larger text has to ask an administrator for
// it. The engine still scopes every read and write to (workspace, caller), so nobody can reach anyone
// else's row: `null` here means "membership is the check", not "no check".

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext(null);
  if (isDenied(auth)) return auth;

  if (new URL(req.url).searchParams.get("export") === "1") {
    const file = await exportPreferences(auth.caller.admin, auth.ctx.workspaceId, auth.caller.userId);
    return new NextResponse(JSON.stringify(file, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": 'attachment; filename="competen-practice-preferences.json"',
      },
    });
  }

  const [resolved, checklist] = await Promise.all([
    resolvePreferences(auth.caller.admin, auth.ctx.workspaceId, auth.caller.userId),
    configurationChecklist(auth.caller.admin, auth.ctx.workspaceId, auth.caller.userId),
  ]);
  return NextResponse.json({ ...resolved, checklist, correlationId: auth.caller.traceId });
}

export async function PATCH(req: NextRequest) {
  const auth = await requirePracticeContext(null);
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const result = await updatePreferences(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, userId: auth.caller.userId,
    patch: body as never, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  // `refused` travels with a SUCCESS: some of the change landed and some is the practice's to set. A
  // caller that only checked the status code would otherwise believe all of it applied.
  return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId });
}

export async function PUT(req: NextRequest) {
  const auth = await requirePracticeContext(null);
  if (isDenied(auth)) return auth;

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const result = await importPreferences(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, userId: auth.caller.userId,
    file: body, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId });
}

export async function DELETE() {
  const auth = await requirePracticeContext(null);
  if (isDenied(auth)) return auth;

  const result = await resetPreferences(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, userId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId });
}
