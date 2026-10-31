import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal, type IndividualContext } from "@/lib/individual/guard";
import { isUuid } from "@/lib/individual/scholar/store";
import { flashcardGate, loadCardSelection } from "@/lib/individual/scholar/flashcard-service";
import { asGuideVariant, asPrintLayout, buildFlashcardPdf, exportFilename, exportTitle, FLASHCARD_EXPORT_FORMATS, type FlashcardExportFormat } from "@/lib/individual/scholar/flashcard-pdf";
import { currentTraceId } from "@/lib/trace";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// /api/individual/scholar/flashcards/export -- SCHOLAR-FLASHCARDS-01 s8-12 (owner, 31 Oct 2026).
//
// GET  ?format=deck|print|guide &deck=<id or key>... &card=<id>... &topic= &competency= &material=
//      [&layout=duplex|fold] [&guide=comprehensive|concise]
//      One PDF of the caller's OWN cards the selection names (loadCardSelection: keyed on the caller, never anyone
//      else's), built by flashcard-pdf.ts. Streamed back to the caller as an attachment, no-store: never stored,
//      linked or shared. print is double-sided (long-edge flip) unless layout=fold (single-sided foldable; the older
//      layout=single still means fold). guide is comprehensive unless guide=concise (SCHOLAR-FLASHCARDS-QA-01).
// HEAD the same checks without building: the Download menu's probe.
//
// ⚠ NO AI. Nothing here, nor in flashcard-pdf.ts, calls a model: every word is already on the learner's cards
// (flashcard-pdf.test.ts walks this route's imports to prove it). The audit row is written here directly for that
// reason: scholar/http.ts carries the AI runners.
// Refusals: Scholar not active 403 (guard); flashcards off 403; that format not offered 403; no cards 404 (JSON).
// More cards than the policy's deck size: the first that many, and the file says so.

const asFormat = (v: string | null): FlashcardExportFormat | null => ((FLASHCARD_EXPORT_FORMATS as readonly string[]).includes(v ?? "") ? (v as FlashcardExportFormat) : null);

async function gate(req: Request): Promise<NextResponse | { ctx: IndividualContext; format: FlashcardExportFormat; cap: number }> {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const format = asFormat(new URL(req.url).searchParams.get("format"));
  if (!format) return NextResponse.json({ error: "Choose a download: deck, print or guide." }, { status: 400 });
  const g = await flashcardGate(ctx, false);
  if ("refusal" in g) return NextResponse.json({ error: g.refusal.error }, { status: g.refusal.status });
  if (!g.policy.scholarFlashcardExports.includes(format)) return NextResponse.json({ error: "That download is not offered here." }, { status: 403 });
  return { ctx, format, cap: g.policy.scholarFlashcardDeckMax };
}

export async function HEAD(req: Request) {
  const g = await gate(req);
  if (g instanceof NextResponse) return new NextResponse(null, { status: g.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store, private" } });
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store, private" } });
}

export async function GET(req: Request) {
  const g = await gate(req);
  if (g instanceof NextResponse) return g;
  const { ctx, format, cap } = g;
  const u = new URL(req.url).searchParams;
  const by = { topic: u.get("topic"), competencyId: u.get("competency"), materialId: u.get("material") };
  const sel = await loadCardSelection(ctx, {
    deckIds: u.getAll("deck").slice(0, 20), cardIds: u.getAll("card").filter(isUuid).slice(0, 1000), ...by,
  });
  if (!sel.ok) return NextResponse.json({ error: sel.reason === "off" ? "Flashcards are not offered here." : "Your cards could not be read just now." }, { status: sel.reason === "off" ? 403 : 503 });
  if (!sel.cards.length) return NextResponse.json({ error: "There are no cards in that selection." }, { status: 404 });
  const cards = sel.cards.slice(0, cap);
  const title = exportTitle(sel, { ...by, cardsNamed: u.getAll("card").some(isUuid) });
  const layout = asPrintLayout(u.get("layout"));
  const guide = asGuideVariant(u.get("guide"));
  const opts = { layout, guide };
  const file = await buildFlashcardPdf(format, { cards, title, generatedAt: sel.generatedAt, omitted: sel.cards.length - cards.length }, opts);
  // Codes and counts only: never a card's words or a deck's name.
  await ctx.admin.from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: ctx.userId, actor_name: ctx.profile?.fullName ?? null,
    action: "individual_scholar_flashcard_export", entity_type: "individual_scholar_question", entity_id: null,
    new_value: { format, layout: format === "print" ? layout : null, guide: format === "guide" ? guide : null, cards: cards.length, omitted: sel.cards.length - cards.length, decks: sel.decks.length },
  }).then((r: unknown) => r, () => {});
  return new NextResponse(new Uint8Array(file), { headers: {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${exportFilename(title, format, sel.generatedAt, opts)}"`,
    "Content-Length": String(file.byteLength),
    "Cache-Control": "no-store, private",
    "X-Content-Type-Options": "nosniff",
  } });
}
