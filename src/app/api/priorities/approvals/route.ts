import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { missing } from "@/lib/priorities/engine";

// PPE-008 approval decisions — the governance side of the write layer. A super-admin approves / rejects / requests
// changes on a pending ppe_approvals request; the decision transitions the linked entity for the draft→pending→
// published lifecycle types (objective / priority) and is recorded in the immutable ppe_audit trail. No migration.
/* eslint-disable @typescript-eslint/no-explicit-any */

const DECISIONS: Record<string, string> = { approve: "approved", reject: "rejected", request_changes: "changes_requested" };

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden("Priority governance is super-admin only");
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const b = await req.json().catch(() => ({}));
  const state = DECISIONS[b.action];
  if (!state) return badRequest("action must be approve, reject or request_changes");

  const { data: appr, error: readErr } = await c.admin.from("ppe_approvals").select("*").eq("id", id).maybeSingle();
  if (readErr && missing(readErr)) return badRequest("Priority framework not provisioned (apply migration 107)");
  if (!appr) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (appr.state !== "pending") return badRequest(`This request was already ${String(appr.state).replace(/_/g, " ")}`);

  const reason = b.reason ? String(b.reason).slice(0, 500) : null;
  const { error } = await c.admin.from("ppe_approvals").update({ state, decided_by: c.userId, decided_at: new Date().toISOString(), decision_reason: reason }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Transition the linked entity for the draft→pending→published lifecycle types (objective / priority).
  // Only move a still-pending entity, so a manual change isn't clobbered. Themes/campaigns have their own
  // lifecycles → decision recorded without forcing a status change (honest).
  let entityNote = "";
  if (["objective", "priority"].includes(appr.entity_type) && appr.entity_id) {
    const table = appr.entity_type === "objective" ? "ppe_objectives" : "ppe_priorities";
    const nextStatus = b.action === "approve" ? "published" : "draft";
    await c.admin.from(table).update({ status: nextStatus }).eq("id", appr.entity_id).eq("status", "pending").then((r: any) => r, () => {});
    entityNote = b.action === "approve" ? " → published" : " → returned to draft";
  }

  await c.admin.from("ppe_audit").insert({
    entity_type: appr.entity_type, entity_id: appr.entity_id, action: state, actor_id: c.userId,
    detail: `${appr.entity_type} “${appr.entity_title}” ${state.replace(/_/g, " ")}${reason ? ` — “${reason}”` : ""}${entityNote}`,
    scope_type: appr.scope_type ?? "platform", scope_ref: appr.scope_ref ?? null,
  }).then((r: any) => r, () => {});
  return NextResponse.json({ ok: true, state });
}
