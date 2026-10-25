import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { LEARNING_OFF, learningEnabled } from "@/lib/learning/policy";
import { recordExternalCompletion } from "@/lib/learning/record";

// Request-time only: it reads the release gates and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// POST /api/individual/learning/external -- COMPETEN-LEARNING-01 S2: recording completion of EXTERNAL learning.
//
// multipart/form-data: recordId, completedOn (YYYY-MM-DD), hours (optional), reflection (optional), file (optional:
// the provider's certificate). Self-declared, or self-declared with a document attached. Never verified: nothing reads
// the document, and nothing here contacts the provider (no external LMS API, owner GO).

export async function POST(req: Request) {
  const ctx = await requireIndividualContext();
  if (isGuardRefusal(ctx)) return ctx;
  if (!(await learningEnabled(ctx.admin))) return NextResponse.json({ error: LEARNING_OFF }, { status: 404 });
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Send the completion form." }, { status: 400 });
  const get = (k: string) => (typeof form.get(k) === "string" ? String(form.get(k)) : "");
  const file = form.get("file");
  const r = await recordExternalCompletion(ctx.admin, ctx.userId, get("recordId").slice(0, 40), {
    completedOn: get("completedOn").slice(0, 10), hours: get("hours"), reflection: get("reflection"), file: file instanceof File && file.size > 0 ? file : null,
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status ?? 409 });
  return NextResponse.json({ ok: true });
}
