import { NextResponse } from "next/server";
import { getCaller, isResponse } from "@/lib/api-auth";
import { learnerPractice, recordPractice } from "@/lib/delivery/simulation-practice";

// CDP-005 — learner simulation practice API. GET returns the caller's practice history; POST logs a practice
// session (scenario + debrief + self-rating). Any authenticated user, own sessions only.

export async function GET() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  return NextResponse.json(await learnerPractice(c.admin, c.userId));
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const b = await req.json().catch(() => ({}));
  const r = await recordPractice(c.admin, c.userId, {
    scenario_id: b.scenario_id || null, outcome: b.outcome,
    self_rating: b.self_rating != null && b.self_rating !== "" ? Number(b.self_rating) : null,
    duration_min: b.duration_min != null && b.duration_min !== "" ? Number(b.duration_min) : null,
    went_well: b.went_well || null, to_improve: b.to_improve || null, action_plan: b.action_plan || null,
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ ...r, history: await learnerPractice(c.admin, c.userId) });
}
