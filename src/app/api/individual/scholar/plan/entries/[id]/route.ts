import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { entryUpdateService, entryDeleteService } from "@/lib/individual/scholar/plan-service";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// PATCH  /api/individual/scholar/plan/entries/[id]  change the WHOLE series (any field left out keeps its value) and/or its status (planned | completed | cancelled).
// DELETE /api/individual/scholar/plan/entries/[id]  delete the whole series (its exceptions go with it).
// OWN ROWS ONLY (the guard's user id, never a body field), experience "scholar" only. NO AI. The logic and its limits are in plan-service.ts.

const json = (r: { status: number; body: Record<string, unknown> }) => NextResponse.json(r.body, { status: r.status, headers: { "Cache-Control": "private, no-store" } });

export async function PATCH(req: Request, ctx2: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const { id } = await ctx2.params;
  const body = await req.json().catch(() => ({}));
  return json(await entryUpdateService(ctx, id, body, req.headers));
}

export async function DELETE(_req: Request, ctx2: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const { id } = await ctx2.params;
  return json(await entryDeleteService(ctx, id));
}
