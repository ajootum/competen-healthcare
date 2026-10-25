import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { learningEnabled } from "@/lib/learning/policy";
import { signEvidence, signLessonMedia } from "@/lib/learning/record";

// Request-time only: it reads the release gates and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// GET /api/individual/learning/file?record=<id>&media=<path>   a lesson file of the record's own version
// GET /api/individual/learning/file?record=<id>&evidence=1     the person's own external completion document
//
// A redirect to a five-minute signed URL, issued only after the checks: the record is the caller's, access is live
// (lesson files), and the version names the file. Anything else is 404, so a guessed path learns nothing.

export async function GET(req: Request) {
  const ctx = await requireIndividualContext();
  if (isGuardRefusal(ctx)) return ctx;
  if (!(await learningEnabled(ctx.admin))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const u = new URL(req.url);
  const record = (u.searchParams.get("record") ?? "").slice(0, 40);
  const media = (u.searchParams.get("media") ?? "").slice(0, 300);
  const url = u.searchParams.get("evidence") === "1" ? await signEvidence(ctx.admin, ctx.userId, record) : media ? await signLessonMedia(ctx.admin, ctx.userId, record, media) : null;
  if (!url) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.redirect(url, 302);
}
