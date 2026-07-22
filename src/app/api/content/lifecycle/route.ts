import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type Action = "submit_review" | "publish" | "archive" | "revert";

const ACTION_STATUS: Record<Action, string> = {
  submit_review: "in_review",
  publish:       "published",
  archive:       "archived",
  revert:        "draft",
};

export async function PATCH(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  // Roles-array aware (matches getCaller/page gates): multi-role super admins pass.
  const { data: profile } = await admin.from("profiles").select("role, roles, full_name").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { frameworkId, action }: { frameworkId: string; action: Action } = await req.json();
  const newStatus = ACTION_STATUS[action];
  if (!newStatus) return NextResponse.json({ error: "Invalid action" }, { status: 400 });

  const { data: framework } = await admin
    .from("frameworks")
    .select("id, name, pub_status, version_num")
    .eq("id", frameworkId)
    .returns<{ id: string; name: string; pub_status?: string | null; version_num?: number | null }[]>()
    .single();
  if (!framework) return NextResponse.json({ error: "Framework not found" }, { status: 404 });

  const oldStatus = framework.pub_status ?? "published";

  const { error: updateErr } = await admin.from("frameworks").update({ pub_status: newStatus }).eq("id", frameworkId);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  // On publish, snapshot full framework content into version history. A failed
  // snapshot no longer passes silently — the response carries a warning so the
  // caller can tell the admin the governance artifact is missing.
  let warning: string | undefined;
  if (action === "publish") {
    const { data: fullFw, error: snapErr } = await admin
      .from("frameworks")
      .select(`
        name, library, description,
        framework_domains(
          name, sort_order,
          framework_competencies(
            name, description, sort_order,
            competency_skills(name, sort_order)
          )
        )
      `)
      .eq("id", frameworkId)
      .single();

    if (fullFw) {
      const nextVersion = (framework.version_num ?? 0) + 1;
      const { error: insErr } = await admin.from("framework_versions").insert({
        framework_id: frameworkId,
        version_num: nextVersion,
        snapshot: fullFw,
        published_by_name: profile?.full_name ?? null,
      });
      if (insErr) warning = "Published, but the version snapshot failed — republish to retry it.";
      else await admin.from("frameworks").update({ version_num: nextVersion }).eq("id", frameworkId);
    } else {
      warning = `Published, but the version snapshot failed${snapErr ? ` (${snapErr.message})` : ""} — republish to retry it.`;
    }
  }

  if (action === "submit_review") {
    // Supersede any previous pending approval for this framework
    await admin.from("content_approvals")
      .update({ status: "superseded" })
      .eq("framework_id", frameworkId)
      .eq("status", "pending");

    await admin.from("content_approvals").insert({
      framework_id: frameworkId,
      framework_name: framework.name,
      submitted_by: user.id,
      submitted_by_name: profile?.full_name ?? null,
      status: "pending",
    });
  }

  await admin.from("audit_log").insert({
    actor_id: user.id,
    actor_name: profile?.full_name ?? null,
    action,
    entity_type: "framework",
    entity_id: frameworkId,
    entity_name: framework.name,
    old_value: { pub_status: oldStatus },
    new_value: { pub_status: newStatus },
  });

  return NextResponse.json({ ok: true, warning });
}
