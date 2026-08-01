import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { emitTaskCompleted } from "@/lib/orchestration/producers";

import { currentTraceId } from "@/lib/trace";
// PW-014 §14.1 / §7.1 / PW-AC-08 — POST /me/actions/{id}/execute. Direct-completes a low-risk universal action
// after RE-AUTHORIZING and RE-VALIDATING the source record at execution time (visibility is not authorization,
// §10). High-risk / clinical (patient-linked) work is refused for direct execution and returned as deep-link-only
// (§7.1) so it is completed in the source workspace with its own confirmation. action_id = '<sourceType>:<uuid>'.
/* eslint-disable @typescript-eslint/no-explicit-any */

const DEEP_LINK: Record<string, string> = {
  op_task: "/dashboard/shift",
  learning_enrolment: "/dashboard/learning",
  competency_decision: "/dashboard/passport",
  op_quality_action: "/dashboard/tasks",
};

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const raw = decodeURIComponent((await params).id ?? "");
  const sep = raw.indexOf(":");
  if (sep < 1) return NextResponse.json({ error: "Malformed action id (expected '<type>:<id>')" }, { status: 400 });
  const sourceType = raw.slice(0, sep), sourceId = raw.slice(sep + 1);
  const admin = createAdminClient() as any;

  // Only op_task supports direct completion in this slice; everything else is deep-link execution in the source.
  if (sourceType !== "op_task") {
    return NextResponse.json({ ok: false, requiresDeepLink: true, deepLink: DEEP_LINK[sourceType] ?? "/dashboard/tasks", reason: "This action is completed in its source workspace." }, { status: 409 });
  }

  const { data: task } = await admin.from("op_tasks").select("id, hospital_id, assigned_to, status, patient_id, priority, description").eq("id", sourceId).maybeSingle();
  if (!task) return NextResponse.json({ error: "Action not found" }, { status: 404 });

  // Re-authorize: the action must actually belong to this user, right now — not merely have been visible.
  if (task.assigned_to !== user.id) return NextResponse.json({ error: "Not your action" }, { status: 403 });

  // Clinical / high-risk → deep-link only (never direct-complete patient-linked work here).
  if (task.patient_id) {
    return NextResponse.json({ ok: false, requiresDeepLink: true, deepLink: "/dashboard/shift", reason: "Patient-linked task — complete it in the shift workspace." }, { status: 409 });
  }

  // Re-validate source state (optimistic concurrency): only an in-flight task can be completed.
  if (!["created", "assigned", "accepted", "in_progress"].includes(task.status)) {
    return NextResponse.json({ ok: false, stale: true, status: task.status, reason: `Task is already '${task.status}'.` }, { status: 409 });
  }

  const now = new Date().toISOString();
  const { data: updated, error } = await admin.from("op_tasks").update({ status: "completed", completed_at: now, completed_by: user.id }).eq("id", sourceId).eq("assigned_to", user.id).in("status", ["created", "assigned", "accepted", "in_progress"]).select().maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!updated) return NextResponse.json({ ok: false, stale: true, reason: "Task changed before completion — refresh." }, { status: 409 });

  const { data: me } = await admin.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  await admin.from("audit_log").insert({ trace_id: await currentTraceId(), actor_id: user.id, actor_name: me?.full_name ?? null, action: "complete_action", entity_type: "op_task", entity_id: sourceId, hospital_id: updated.hospital_id ?? null, new_value: { via: "personal_workspace", status: "completed" } });
  await emitTaskCompleted(admin, updated, user.id, me?.full_name ?? null);

  return NextResponse.json({ ok: true, action_id: raw, status: "completed" });
}
