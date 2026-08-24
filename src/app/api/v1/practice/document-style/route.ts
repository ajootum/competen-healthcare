import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { draftFromPreset, listStyles, publishStyle, restoreDefault, saveDraft } from "@/lib/practice/document-design";

// CPR-DOC-CONFIG-001 s11/s13 -- the practice document style.
//
// One route, four actions, because they are one decision surface: a practitioner saves, previews,
// publishes and reverts in a single sitting. Each action re-checks the capability in the engine rather
// than trusting this route, so a second caller cannot skip the check by not being this file.

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requirePracticeContext("practice.settings.manage");
  if (isDenied(auth)) return auth;
  const data = await listStyles(auth.caller.admin, auth.ctx);
  return NextResponse.json({ ...data, correlationId: auth.caller.traceId });
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("practice.settings.manage");
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const correlationId = auth.caller.traceId;
  const action = String(body.action ?? "save");

  const result =
    action === "publish"
      ? await publishStyle(auth.caller.admin, auth.ctx, { id: String(body.id ?? ""), correlationId })
    : action === "restore_default"
      ? await restoreDefault(auth.caller.admin, auth.ctx, { correlationId })
    : action === "preset"
      ? await draftFromPreset(auth.caller.admin, auth.ctx, { preset: String(body.preset ?? ""), correlationId })
    : action === "save"
      ? await saveDraft(auth.caller.admin, auth.ctx, {
          id: body.id ? String(body.id) : null,
          name: body.name ? String(body.name) : undefined,
          preset: body.preset ? String(body.preset) : null,
          tokens: body.tokens, correlationId,
        })
      : { ok: false as const, status: 400, code: "VALIDATION_ERROR", message: "unknown action" };

  if (!result.ok)
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ ...result.data, correlationId });
}
