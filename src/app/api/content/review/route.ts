import { NextResponse } from "next/server";
import { getCaller, isResponse, forbidden, isEducator, assertFrameworkScope } from "@/lib/api-auth";

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden(); // reviewer role (educator/lead/admin)

  const admin = c.admin;
  // getCaller supplies role/tenant; fetch the display name for audit records.
  const { data: me } = await admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const fullName = (me?.full_name as string) ?? null;

  const { approvalId, decision, comment }: { approvalId: string; decision: "approve" | "reject"; comment?: string } = await req.json();

  const { data: approval } = await admin
    .from("content_approvals")
    .select("*")
    .eq("id", approvalId)
    .single();
  if (!approval) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (approval.status !== "pending") return NextResponse.json({ error: "Already reviewed" }, { status: 400 });

  // Tenant scope: the framework under review must belong to the caller's
  // hospital (super_admin unrestricted). Blocks cross-tenant approvals.
  const scopeErr = await assertFrameworkScope(c, approval.framework_id as string, { write: true });
  if (scopeErr) return scopeErr;

  // Separation of duties (User Account Architecture §27): the person who
  // submitted content for review may not approve it themselves.
  if (approval.submitted_by === c.userId) {
    return NextResponse.json({
      error: "Separation of duties: you submitted this content — a different reviewer must approve or reject it.",
    }, { status: 403 });
  }

  const newApprovalStatus = decision === "approve" ? "approved" : "rejected";
  const newFrameworkStatus = decision === "approve" ? "approved" : "draft";

  await admin.from("content_approvals").update({
    status: newApprovalStatus,
    reviewed_by: c.userId,
    reviewed_by_name: fullName,
    reviewed_at: new Date().toISOString(),
    comment: comment ?? null,
  }).eq("id", approvalId);

  await admin.from("frameworks").update({ pub_status: newFrameworkStatus }).eq("id", approval.framework_id);

  await admin.from("audit_log").insert({
    actor_id: c.userId,
    actor_name: fullName,
    action: decision === "approve" ? "approve_content" : "reject_content",
    entity_type: "framework",
    entity_id: approval.framework_id,
    entity_name: approval.framework_name,
    old_value: { pub_status: "in_review" },
    new_value: { pub_status: newFrameworkStatus },
    notes: comment ?? null,
    hospital_id: c.hospitalId ?? null,
    organisation_id: c.organisationId ?? null,
  });

  return NextResponse.json({ ok: true });
}
