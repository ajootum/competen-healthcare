import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { LEARNING_OFF, learningEnabled } from "@/lib/learning/policy";
import { answerCheck, completeActivity, enrol, withdraw } from "@/lib/learning/record";

// Request-time only: it reads the release gates and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// POST /api/individual/learning -- COMPETEN-LEARNING-01 S2, migration 462. The person's own learning record.
//
// Body: { action: "enrol", offeringId } | { action: "complete", recordId, activityKey }
//     | { action: "answer", recordId, activityKey, answers } | { action: "withdraw", recordId }
//
// ⚠ GATE 3 (membership), NOT AN EXPERIENCE. A course-only member holds no Scholar or Professional period and is
// served here exactly like anybody else (owner D2). The person is the session's, and every write is to their own
// record. Scoring, completion and certificates are decided on the server against the stored version.

const str = (v: unknown, max = 60) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(req: Request) {
  const ctx = await requireIndividualContext();
  if (isGuardRefusal(ctx)) return ctx;
  if (!(await learningEnabled(ctx.admin))) return NextResponse.json({ error: LEARNING_OFF }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const me = ctx.userId;
  let r;
  switch (body?.action) {
    case "enrol": r = await enrol(ctx.admin, me, str(body.offeringId, 40)); break;
    case "complete": r = await completeActivity(ctx.admin, me, str(body.recordId, 40), str(body.activityKey, 41)); break;
    case "answer": r = await answerCheck(ctx.admin, me, str(body.recordId, 40), str(body.activityKey, 41), body.answers); break;
    case "withdraw": r = await withdraw(ctx.admin, me, str(body.recordId, 40)); break;
    default: return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status ?? 409 });
  return NextResponse.json(r);
}
