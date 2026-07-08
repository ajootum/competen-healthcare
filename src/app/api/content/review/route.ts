import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function PATCH(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role, full_name, hospital_id, organisation_id")
    .eq("id", user.id)
    .single();

  if (!profile || !["hospital_admin", "super_admin"].includes(profile.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { approvalId, decision, comment }: { approvalId: string; decision: "approve" | "reject"; comment?: string } = await req.json();

  const { data: approval } = await admin
    .from("content_approvals")
    .select("*")
    .eq("id", approvalId)
    .single();
  if (!approval) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (approval.status !== "pending") return NextResponse.json({ error: "Already reviewed" }, { status: 400 });

  const newApprovalStatus = decision === "approve" ? "approved" : "rejected";
  const newFrameworkStatus = decision === "approve" ? "approved" : "draft";

  await admin.from("content_approvals").update({
    status: newApprovalStatus,
    reviewed_by: user.id,
    reviewed_by_name: profile.full_name,
    reviewed_at: new Date().toISOString(),
    comment: comment ?? null,
  }).eq("id", approvalId);

  await admin.from("frameworks").update({ pub_status: newFrameworkStatus }).eq("id", approval.framework_id);

  await admin.from("audit_log").insert({
    actor_id: user.id,
    actor_name: profile.full_name,
    action: decision === "approve" ? "approve_content" : "reject_content",
    entity_type: "framework",
    entity_id: approval.framework_id,
    entity_name: approval.framework_name,
    old_value: { pub_status: "in_review" },
    new_value: { pub_status: newFrameworkStatus },
    notes: comment ?? null,
    hospital_id: profile.hospital_id ?? null,
    organisation_id: profile.organisation_id ?? null,
  });

  return NextResponse.json({ ok: true });
}
