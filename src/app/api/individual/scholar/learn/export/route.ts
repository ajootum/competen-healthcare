import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadLearningExport, type ExportRequest } from "@/lib/individual/scholar/learning-export-service";
import { buildLearningExportPdf, exportFilename } from "@/lib/individual/scholar/learning-export";
import { currentTraceId } from "@/lib/trace";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// /api/individual/scholar/learn/export -- the PDF of a learner's SAVED learning (owner instruction 1 Nov 2026, item 2).
//
// GET  ?session=<id>&step=<n>   one saved lesson
//      ?material=<id>           all saved lessons for one of the caller's materials
//      ?study=<id>              a connected study session's lessons
// One PDF of the caller's OWN saved teaching, lessons, citations and notes (learning-export-service.ts reads through the
// store, keyed on the caller; another person's id answers 404). Streamed back as an attachment, no-store: never stored,
// linked or shared.
//
// NO AI and no allowance: nothing here calls a model; every word is already stored. The audit row is written here
// directly (scholar/http.ts carries the AI runners) and holds codes and counts only, never a lesson's words.
// Refusals: Scholar not active 403 (guard); no or several selectors 400; not the caller's / nothing there 404.

const STEP_MAX = 500;

function parse(u: URLSearchParams): ExportRequest | null {
  const session = u.get("session"), material = u.get("material"), study = u.get("study");
  if ([session, material, study].filter(Boolean).length !== 1) return null;
  if (session) {
    const step = Number(u.get("step"));
    return Number.isInteger(step) && step >= 0 && step <= STEP_MAX ? { kind: "lesson", session, step } : null;
  }
  return material ? { kind: "material", material } : { kind: "study", study: study! };
}

export async function GET(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const parsed = parse(new URL(req.url).searchParams);
  if (!parsed) return NextResponse.json({ error: "Choose one lesson (session and step), one material, or one study session." }, { status: 400 });
  const r = await loadLearningExport(ctx, parsed);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  const file = await buildLearningExportPdf(r.input);
  // Codes and counts only: never a lesson's words, a title or a material's name.
  await ctx.admin.from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: ctx.userId, actor_name: ctx.profile?.fullName ?? null,
    action: "individual_scholar_learning_export", entity_type: "individual_scholar_learning_session", entity_id: null,
    new_value: { scope: parsed.kind, ...r.counts },
  }).then((x: unknown) => x, () => {});
  return new NextResponse(new Uint8Array(file), { headers: {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${exportFilename(r.input.title, r.input.generatedAt)}"`,
    "Content-Length": String(file.byteLength),
    "Cache-Control": "no-store, private",
    "X-Content-Type-Options": "nosniff",
  } });
}
