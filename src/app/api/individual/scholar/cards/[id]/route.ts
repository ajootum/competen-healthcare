import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { reviewCard } from "@/lib/individual/scholar/store";
import { loadIndividualPolicy } from "@/lib/individual/policy";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// POST /api/individual/scholar/cards/[id] -- COMPETEN-IND-004 s4 (Revise). Body { quality: 0..5 }, the
// person's own grade of how well they recalled the answer. SM-2 (src/lib/delivery/reinforcement.ts)
// reschedules the card. Keyed on the caller's own id: another person's card answers 404.

export async function POST(req: Request, ctx2: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const { id } = await ctx2.params;
  const body = await req.json().catch(() => ({}));
  const quality = body?.quality;
  if (!Number.isInteger(quality) || quality < 0 || quality > 5) return NextResponse.json({ error: "Grade your recall from 0 to 5." }, { status: 400 });
  // REVISION-01 R3: the shared SM-2 within the policy's bounds (the defaults are the earlier rule exactly).
  const p = await loadIndividualPolicy(ctx.admin);
  const r = await reviewCard(ctx.admin, ctx.userId, id, quality, {
    masteryReps: p.scholarSrsMasteryReps, masteryDays: p.scholarSrsMasteryDays, maxIntervalDays: p.scholarSrsMaxIntervalDays, harderIntervalPercent: p.scholarSrsHarderIntervalPercent,
  });
  if (!r.ok) return NextResponse.json({ error: r.error === "not_found" ? "That card could not be found." : "Your review could not be saved." }, { status: r.error === "not_found" ? 404 : 500 });
  return NextResponse.json(r);
}
