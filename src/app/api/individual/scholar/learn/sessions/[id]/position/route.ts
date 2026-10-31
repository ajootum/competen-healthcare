import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { getLearningPosition, putLearningPosition } from "@/lib/individual/scholar/store";
import { parsePositionPut } from "@/lib/individual/scholar/learn-position";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// /api/individual/scholar/learn/sessions/[id]/position -- SCHOLAR-CONTINUITY-01 item 1 (migration 790).
//
// GET  the caller's position in their own session: { provisioned, position } (null: none yet). Another learner's session
//      simply has none for the caller (every read is keyed on the caller).
// PUT  one position write (learn-position.ts parsePositionPut): { provisioned, accepted, reason, position }. The stale-write
//      rule is the database's (790 individual_scholar_learning_position_put): a stale device is answered accepted: false with
//      the stored position, never an error. A session that is not the caller's answers 404 (its composite foreign key).
// While 790 is absent both answer { provisioned: false } with 200: Learn stays device-only and the learner sees nothing.
// The client writes only on meaningful events and at most every 15 s while interacting (learn-position.ts PositionSync).
// A bookmark: no AI output and no notes content is ever accepted here.

export async function GET(_req: Request, ctx2: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const { id } = await ctx2.params;
  const r = await getLearningPosition(ctx.admin, ctx.userId, id);
  if (!r.ok) return r.notProvisioned ? NextResponse.json({ provisioned: false, position: null }) : NextResponse.json({ error: "Your place could not be read just now." }, { status: 503 });
  return NextResponse.json({ provisioned: true, position: r.data });
}

export async function PUT(req: Request, ctx2: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const { id } = await ctx2.params;
  const body = await req.json().catch(() => null);
  const p = parsePositionPut(body, Date.now());
  if (!p.ok) return NextResponse.json({ error: "That position could not be read.", field: p.error }, { status: 400 });
  const r = await putLearningPosition(ctx.admin, ctx.userId, id, p.value);
  if (!r.ok) {
    if (r.error === "not_provisioned") return NextResponse.json({ provisioned: false });
    if (r.error === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (r.error === "invalid") return NextResponse.json({ error: "That position could not be saved." }, { status: 400 });
    return NextResponse.json({ error: "Your place could not be saved just now." }, { status: 503 });
  }
  return NextResponse.json({ provisioned: true, accepted: r.accepted, reason: r.reason, position: r.position });
}
