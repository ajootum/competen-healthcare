import { NextResponse } from "next/server";
import { getCaller, isResponse, badRequest } from "@/lib/api-auth";
import { emitLearningCompleted } from "@/lib/orchestration/producers";

// Worker self-service learning API — closes Loop 2 (worker learning → learning_enrolments → UMW mandatory
// compliance). A logged-in user may update the status/progress of THEIR OWN enrolment only: the write is
// scoped to user_id = caller, which IS the security boundary (a worker cannot touch anyone else's row).
// Manager assignment/oversight stays in /api/operations/learning-assign. Every completion is audited.
//   PATCH ?id=<enrolment_id>  { action: "complete" | "in_progress" | "not_started", progress_pct? }
/* eslint-disable @typescript-eslint/no-explicit-any */

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const admin = (c as any).admin, userId = (c as any).userId;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const b = await req.json().catch(() => ({}));
  const action = b.action;
  if (!["complete", "in_progress", "not_started"].includes(action)) return badRequest("valid action required");

  const probe = await admin.from("learning_enrolments").select("id").limit(1);
  if (probe.error && /does not exist|schema cache/i.test(probe.error.message ?? "")) return NextResponse.json({ error: "Learning store not provisioned — run migration 089" }, { status: 409 });

  const now = new Date().toISOString();
  const patch = action === "complete"
    ? { status: "completed", progress_pct: 100, completed_at: now, updated_at: now }
    : action === "in_progress"
      ? { status: "in_progress", progress_pct: b.progress_pct != null ? Math.max(0, Math.min(100, b.progress_pct)) : 50, updated_at: now }
      : { status: "not_started", progress_pct: 0, completed_at: null, updated_at: now };

  // Self-scoped: the compound match means a row that isn't the caller's own updates 0 rows → 403.
  const { data, error } = await admin.from("learning_enrolments").update(patch).eq("id", id).eq("user_id", userId).select("id, status, progress_pct, hospital_id, course_id, user_id").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not your enrolment" }, { status: 403 });
  await admin.from("audit_log").insert({ actor_id: userId, action: "self_update_learning_enrolment", entity_type: "learning_enrolment", entity_id: id, hospital_id: data.hospital_id ?? null, new_value: { status: patch.status } });
  // PW-014 WS4/P2 — publish a domain event on course completion (fail-soft).
  if (data.status === "completed") await emitLearningCompleted(admin, data, userId);
  return NextResponse.json({ id: data.id, status: data.status, progress_pct: data.progress_pct });
}
