import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal, type IndividualContext } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { parseEntryKey, parseHistoryQuery, validateCapture } from "@/lib/individual/scholar/search-history";
import { clearHistory, historySchema, listHistory, recordCapture, removeEntry, setPinned } from "@/lib/individual/scholar/search-history-data";
import { findPatientIdentifiers } from "@/lib/individual/scholar/extract";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// /api/individual/scholar/library/history -- SCHOLAR-SEARCH-HISTORY-01 (owner directive 4 Nov 2026), migration 992.
//
// The learner's OWN search history, inside the Personal Learning Library.
//   GET    ?q&activity&material&topic&from&to&pinned&page   one page of their history, newest first (the page's own filters)
//   POST   { activity, query, requestKey, materialId?, chunkId?, artefactId?, sessionId?, step?, topic?, resultCount? }
//          keep one SUBMITTED search or question (search-history validateCapture). Always 200 with { kept, reason }: a capture
//          is a side note of the learner's own action, so it never shows an error to them. Nothing is kept when the key is off,
//          992 is absent, the words are not a meaningful submission, or they look like they identify a patient.
//   PATCH  { key, pinned }                   pin or unpin one entry
//   DELETE ?key=<entry key>                  remove one entry (a saved teaching or lesson stays: only its history entry goes)
//   DELETE ?all=1&confirm=CLEAR              clear the whole history
// Keyed on the caller (the guard's id) everywhere: another learner's entry or record is 404, never disclosed. Gated by policy
// scholar_search_history (403 when off) and migration 992 (409 while absent). NO AI. NO AUDIT ROW: a row naming a learner's
// searching would itself be identifiable activity outside the learner's plane, so this route writes none.

type Ctx = IndividualContext;
async function gate(ctx: Ctx): Promise<NextResponse | null> {
  const policy = await loadIndividualPolicy(ctx.admin);
  if (policy.scholarSearchHistory !== "on") return NextResponse.json({ error: "Search history is not offered here." }, { status: 403 });
  if (!(await historySchema(ctx.admin))) return NextResponse.json({ error: "Search history is not available here yet." }, { status: 409 });
  return null;
}
const NOT_FOUND = "That history entry could not be found.";

export async function GET(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const refused = await gate(ctx);
  if (refused) return refused;
  const q = parseHistoryQuery(Object.fromEntries(new URL(req.url).searchParams));
  const r = await listHistory(ctx.admin, ctx.userId, q);
  if (!r.ok) return NextResponse.json({ error: "Your history could not be read just now." }, { status: 503 });
  return NextResponse.json({ entries: r.data.entries, total: r.data.total, page: q.page });
}

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  if ((await loadIndividualPolicy(ctx.admin)).scholarSearchHistory !== "on") return NextResponse.json({ kept: false, reason: "off" });
  const v = validateCapture(await req.json().catch(() => null));
  if (!v.ok) return NextResponse.json({ kept: false, reason: v.problem });
  // Learner text is screened like every other learner text: words that look like they identify a patient are never kept.
  if (findPatientIdentifiers(v.entry.query).length > 0 || (v.entry.topic && findPatientIdentifiers(v.entry.topic).length > 0)) return NextResponse.json({ kept: false, reason: "identifiers" });
  const r = await recordCapture(ctx.admin, ctx.userId, v.entry, new Date().toISOString());
  return NextResponse.json({ kept: r === "kept" || r === "existing" || r === "repeat", reason: r });
}

export async function PATCH(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const refused = await gate(ctx);
  if (refused) return refused;
  const body = await req.json().catch(() => ({}));
  const ref = parseEntryKey(body?.key);
  if (!ref || typeof body?.pinned !== "boolean") return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
  const r = await setPinned(ctx.admin, ctx.userId, ref, body.pinned, new Date().toISOString());
  if (r !== "ok") return NextResponse.json({ error: r === "not_found" ? NOT_FOUND : "That could not be changed just now." }, { status: r === "not_found" ? 404 : 500 });
  return NextResponse.json({ ok: true, pinned: body.pinned });
}

export async function DELETE(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const refused = await gate(ctx);
  if (refused) return refused;
  const u = new URL(req.url).searchParams;
  if (u.get("all") === "1") {
    if (u.get("confirm") !== "CLEAR") return NextResponse.json({ error: "Confirm that you want to clear your whole search history." }, { status: 400 });
    const r = await clearHistory(ctx.admin, ctx.userId);
    if (!r.ok) return NextResponse.json({ error: "Your history could not be cleared just now." }, { status: 500 });
    return NextResponse.json({ ok: true, cleared: r.cleared });
  }
  const ref = parseEntryKey(u.get("key"));
  if (!ref) return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
  const r = await removeEntry(ctx.admin, ctx.userId, ref, new Date().toISOString());
  if (r !== "ok") return NextResponse.json({ error: r === "not_found" ? NOT_FOUND : "That could not be removed just now." }, { status: r === "not_found" ? 404 : 500 });
  return NextResponse.json({ ok: true });
}
