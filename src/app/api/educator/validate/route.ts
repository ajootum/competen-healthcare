import { NextRequest, NextResponse } from "next/server";
import { getCaller, isResponse, isEducator, forbidden, badRequest, assertCycleScope } from "@/lib/api-auth";

export async function POST(req: NextRequest) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden();

  const body = await req.json();
  const { competency_score_id, action, notes } = body as {
    competency_score_id: string;
    action: "validate" | "return";
    notes?: string;
  };
  if (!competency_score_id) return badRequest("competency_score_id required");

  // Scope check: resolve the score's cycle and confirm it belongs to the
  // caller's hospital before the admin client mutates it (admin bypasses RLS).
  const { data: score } = await c.admin
    .from("competency_scores")
    .select("cycle_id")
    .eq("id", competency_score_id)
    .maybeSingle();
  if (!score) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const scopeErr = await assertCycleScope(c, score.cycle_id as string);
  if (scopeErr) return scopeErr;

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();

  if (action === "validate") {
    const { error } = await c.admin
      .from("competency_scores")
      .update({
        educator_validated: true,
        educator_id: c.userId,
        educator_notes: notes || null,
        validated_at: new Date().toISOString(),
      })
      .eq("id", competency_score_id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await c.admin.from("audit_log").insert({
      actor_id: c.userId, actor_name: me?.full_name ?? null,
      action: "educator_validate", entity_type: "competency_score", entity_id: competency_score_id,
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "return") {
    // Mark as returned — educator rejects, assessor must re-assess
    const { error } = await c.admin
      .from("competency_scores")
      .update({
        educator_validated: false,
        educator_notes: notes || null,
        educator_id: c.userId,
      })
      .eq("id", competency_score_id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await c.admin.from("audit_log").insert({
      actor_id: c.userId, actor_name: me?.full_name ?? null,
      action: "educator_return", entity_type: "competency_score", entity_id: competency_score_id,
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
