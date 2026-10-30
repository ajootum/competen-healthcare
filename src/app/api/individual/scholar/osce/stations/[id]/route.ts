import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { deleteOsceStation } from "@/lib/individual/scholar/store";
import { osceGate } from "@/lib/individual/scholar/osce-service";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// DELETE /api/individual/scholar/osce/stations/[id] -- SCHOLAR-PRACTICE-EXAMS-01 (720). The learner deletes one of their
// own practice stations, and with it (720 cascade) every run of it. Keyed on the caller: another person's answers 404.
export async function DELETE(_req: Request, ctx2: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const gate = await osceGate(ctx.admin, ctx.userId);
  if (gate instanceof NextResponse) return gate;
  const { id } = await ctx2.params;
  const r = await deleteOsceStation(ctx.admin, ctx.userId, id);
  if (r === "not_found") return NextResponse.json({ error: "That station could not be found." }, { status: 404 });
  if (r === "failed") return NextResponse.json({ error: "The station could not be deleted just now." }, { status: 500 });
  return NextResponse.json({ deleted: true });
}
