import { NextResponse } from "next/server";
import { getCaller, isResponse } from "@/lib/api-auth";
import { startAdaptiveSession, submitAdaptiveAnswer } from "@/lib/delivery/adaptive";

// CDP-003 — adaptive exam runtime API. POST {action:"start", exam_id} begins a CAT session and returns the
// first item; POST {action:"answer", session_id, question_id, answer} scores it server-side and returns the
// next item or the final result. Any authenticated user, own sessions only. Correct answers stay server-side.

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const b = await req.json().catch(() => ({}));

  if (b.action === "start") {
    const r = await startAdaptiveSession(c.admin, String(b.exam_id ?? ""), c.userId);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json(r);
  }
  if (b.action === "answer") {
    const r = await submitAdaptiveAnswer(c.admin, String(b.session_id ?? ""), String(b.question_id ?? ""), String(b.answer ?? ""), c.userId);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json(r);
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
