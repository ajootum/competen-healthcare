import { NextResponse } from "next/server";
import { generateDecisionsForCycle } from "@/lib/engines/decisions";
import { getCaller, isResponse, forbidden, isStaff, isEducator, assertCycleScope } from "@/lib/api-auth";

// POST — (re)generate formal competency decisions for a cycle from current scores.
export async function POST(_req: Request, { params }: { params: Promise<{ cycleId: string }> }) {
  const { cycleId } = await params;
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden();
  // The cycle must be in the caller's hospital.
  const scopeErr = await assertCycleScope(c, cycleId);
  if (scopeErr) return scopeErr;

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const actorName = me?.full_name ?? null;

  try {
    const result = await generateDecisionsForCycle(c.admin, cycleId, c.userId, actorName);
    await c.admin.from("audit_log").insert({
      actor_id: c.userId,
      actor_name: actorName,
      action: "finalize_decisions",
      entity_type: "cycle",
      entity_id: cycleId,
      new_value: { decisions_created: result.created },
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

// GET — list decisions for a cycle.
export async function GET(_req: Request, { params }: { params: Promise<{ cycleId: string }> }) {
  const { cycleId } = await params;
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden(); // competency decisions are staff-only
  // The cycle must be in the caller's hospital.
  const scopeErr = await assertCycleScope(c, cycleId);
  if (scopeErr) return scopeErr;

  const { data } = await c.admin
    .from("competency_decisions")
    .select("id, competency_id, outcome, maturity, effective_date, expiry_date, critical_failure")
    .eq("cycle_id", cycleId)
    .order("created_at", { ascending: false });
  return NextResponse.json(data ?? []);
}
