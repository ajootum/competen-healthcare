import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadLearningExport } from "@/lib/individual/scholar/learning-export-service";
import { parseExportScope } from "@/lib/individual/scholar/saved-library";
import { buildLearningExportPdf, exportFilename } from "@/lib/individual/scholar/learning-export";
import { currentTraceId } from "@/lib/trace";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// /api/individual/scholar/learn/export -- the PDF of a learner's SAVED learning (owner instruction 1 Nov 2026, item 2).
//
// GET  ?session=<id>&step=<n>   one saved lesson
//      ?material=<id>           all saved lessons for one of the caller's materials
//      ?study=<id>              a connected study session's lessons
//      ?selected=<id,id,...>    SCHOLAR-LIBRARY-01: up to 100 chosen saved teachings (any version)
//      ?topic=<topic>           the saved teaching on one topic's sections
//      ?from=<yyyy-mm-dd>&to=<yyyy-mm-dd>   the saved teaching from a date range
//      exactly ONE scope per request (saved-library.ts parseExportScope). The learner's own notes and highlights (820) are
//      included under "Your notes".
// One PDF of the caller's OWN saved teaching, lessons, citations and notes (learning-export-service.ts reads through the
// store, keyed on the caller; another person's id answers 404). Streamed back as an attachment, no-store: never stored,
// linked or shared.
//
// NO AI and no allowance: nothing here calls a model; every word is already stored. The audit row is written here
// directly (scholar/http.ts carries the AI runners) and holds codes and counts only, never a lesson's words.
// Refusals: Scholar not active 403 (guard); no or several selectors 400; not the caller's / nothing there 404.

export async function GET(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const parsed = parseExportScope(new URL(req.url).searchParams);
  if (!parsed) return NextResponse.json({ error: "Choose one lesson (session and step), one material, one study session, up to 100 saved lessons, one topic, or one date range." }, { status: 400 });
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
