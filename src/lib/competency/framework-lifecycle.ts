import { currentTraceId } from "@/lib/trace";
/* eslint-disable @typescript-eslint/no-explicit-any */
// Governed framework lifecycle transition — the single source of truth for moving a framework through its
// pub_status lifecycle. Sets pub_status, snapshots full content into framework_versions on publish (with a
// version bump), opens a content_approvals record on submit-for-review, and audits every move. Shared by the
// framework lifecycle route (api/content/lifecycle) and the CAP-001 asset write-back (W3) so both go through
// exactly the same governed path — no raw pub_status pokes, no divergent copies.

export type FrameworkAction = "submit_review" | "publish" | "archive" | "revert";

export const FRAMEWORK_ACTION_STATUS: Record<FrameworkAction, string> = {
  submit_review: "in_review",
  publish: "published",
  archive: "archived",
  revert: "draft",
};

export async function transitionFramework(
  admin: any,
  frameworkId: string,
  action: FrameworkAction,
  actor: { id: string; name: string | null }
): Promise<{ ok: boolean; status?: string; warning?: string; error?: string; code?: number }> {
  const newStatus = FRAMEWORK_ACTION_STATUS[action];
  if (!newStatus) return { ok: false, error: "Invalid action", code: 400 };

  const { data: framework } = await admin
    .from("frameworks").select("id, name, pub_status, version_num").eq("id", frameworkId).maybeSingle();
  if (!framework) return { ok: false, error: "Framework not found", code: 404 };

  const oldStatus = framework.pub_status ?? "published";
  const { error: updateErr } = await admin.from("frameworks").update({ pub_status: newStatus }).eq("id", frameworkId);
  if (updateErr) return { ok: false, error: updateErr.message, code: 500 };

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
        framework_id: frameworkId, version_num: nextVersion, snapshot: fullFw, published_by_name: actor.name,
      });
      if (insErr) warning = "Published, but the version snapshot failed — republish to retry it.";
      else await admin.from("frameworks").update({ version_num: nextVersion }).eq("id", frameworkId);
    } else {
      warning = `Published, but the version snapshot failed${snapErr ? ` (${snapErr.message})` : ""} — republish to retry it.`;
    }
  }

  if (action === "submit_review") {
    await admin.from("content_approvals").update({ status: "superseded" }).eq("framework_id", frameworkId).eq("status", "pending");
    await admin.from("content_approvals").insert({
      framework_id: frameworkId, framework_name: framework.name,
      submitted_by: actor.id, submitted_by_name: actor.name, status: "pending",
    });
  }

  await admin.from("audit_log").insert({ trace_id: await currentTraceId(),
    actor_id: actor.id, actor_name: actor.name, action,
    entity_type: "framework", entity_id: frameworkId, entity_name: framework.name,
    old_value: { pub_status: oldStatus }, new_value: { pub_status: newStatus },
  });

  return { ok: true, status: newStatus, warning };
}
