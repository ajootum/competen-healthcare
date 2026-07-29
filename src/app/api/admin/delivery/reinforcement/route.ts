import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden } from "@/lib/api-auth";
import { loadReinforcementQueue, generateFromDecisions } from "@/lib/delivery/reinforcement";

// CDP-004 — reinforcement admin API. GET returns coverage (cards/due/mastered/learners + per-subject); POST
// generates cards from achieved competency decisions (idempotent). Super-admin, platform-wide.

export async function GET() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden("Reinforcement admin is super-admin only");
  return NextResponse.json(await loadReinforcementQueue(c.admin, c.hospitalId, isSuper(c)));
}

export async function POST() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden("Reinforcement admin is super-admin only");
  const me = await c.admin.from("profiles").select("full_name").eq("id", c.userId).maybeSingle();
  const r = await generateFromDecisions(c.admin, c.hospitalId, isSuper(c), { id: c.userId, name: me.data?.full_name ?? null });
  const queue = await loadReinforcementQueue(c.admin, c.hospitalId, isSuper(c));
  return NextResponse.json({ ...r, queue });
}
