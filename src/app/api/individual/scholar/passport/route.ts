import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { includeInPassport, removeFromPassport } from "@/lib/individual/scholar/store";
import { audit } from "@/lib/individual/scholar/http";
import { isStudyAchievementKind, parseLabel, PASSPORT_LABEL_MAX } from "@/lib/individual/scholar/passport-items";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// /api/individual/scholar/passport -- COMPETEN-IND-004 s11, owner continuation GO 2026-10-23 item 3.
// POST { materialId, achievement, label } shows one study achievement in the person's Passport. DELETE
// ?materialId=&achievement= takes that one off again. Each is the person's own act, one achievement at a
// time, and nothing else changes: the study history it is drawn from is never touched (migration 375).
// Every change is audited with ids only -- never the label, which may name the person's notes.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  if (!isStudyAchievementKind(body?.achievement)) return NextResponse.json({ error: "Choose an achievement." }, { status: 400 });
  const label = parseLabel(body?.label);
  if (!label) return NextResponse.json({ error: `Give it a title of 1 to ${PASSPORT_LABEL_MAX} characters.` }, { status: 400 });
  const r = await includeInPassport(ctx.admin, ctx.userId, { materialId: String(body?.materialId ?? ""), achievement: body.achievement, label });
  if (r === "not_eligible") return NextResponse.json({ error: "That is not an achievement on your record yet." }, { status: 404 });
  if (r === "failed") return NextResponse.json({ error: "It could not be added just now. Nothing has changed." }, { status: 500 });
  await audit(ctx, "individual_scholar_passport_included", "individual_scholar_passport_item", null,
    { material_id: body.materialId, achievement: body.achievement });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const q = new URL(req.url).searchParams;
  const achievement = q.get("achievement");
  if (!isStudyAchievementKind(achievement)) return NextResponse.json({ error: "Choose an achievement." }, { status: 400 });
  const r = await removeFromPassport(ctx.admin, ctx.userId, q.get("materialId") ?? "", achievement);
  if (!r.ok) return NextResponse.json({ error: "It could not be taken off just now. Nothing has changed." }, { status: 500 });
  if (!r.found) return NextResponse.json({ error: "That is not in your Passport." }, { status: 404 });
  await audit(ctx, "individual_scholar_passport_removed", "individual_scholar_passport_item", null,
    { material_id: q.get("materialId"), achievement });
  return NextResponse.json({ ok: true });
}
