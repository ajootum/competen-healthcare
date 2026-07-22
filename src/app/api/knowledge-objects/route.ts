import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Clinical Knowledge Objects — create, publish and retire governed knowledge.

const TYPES = ["anatomy", "physiology", "pathophysiology", "pharmacology", "classification",
  "assessment_tool", "clinical_reasoning", "procedure", "evidence", "other"];

async function requireAuthor() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized", status: 401 as const };
  const admin = createAdminClient();
  // Roles-array aware (matches getCaller): multi-role authors pass.
  const { data: profile } = await admin.from("profiles").select("role, roles, full_name").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["super_admin", "hospital_admin", "educator"].includes(r))) {
    return { error: "Forbidden", status: 403 as const };
  }
  return { user, admin, profile };
}

export async function POST(req: Request) {
  const auth = await requireAuthor();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { title, knowledge_type, cpu_id, summary, content, source_ref } = await req.json();
  if (!title?.trim()) return NextResponse.json({ error: "A title is required" }, { status: 400 });
  const type = TYPES.includes(knowledge_type) ? knowledge_type : "other";

  const { data, error } = await auth.admin.from("knowledge_objects").insert({
    title: title.trim(),
    knowledge_type: type,
    cpu_id: cpu_id || null,
    summary: summary?.trim() || null,
    content: content?.trim() || null,
    source_ref: source_ref?.trim() || null,
    status: "draft",
    created_by: auth.user.id,
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (cpu_id) {
    await auth.admin.from("knowledge_links").insert({
      knowledge_object_id: data.id, target_type: "cpu", target_id: cpu_id,
    });
  }
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  const auth = await requireAuthor();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const body = await req.json();

  const update: Record<string, unknown> = {};
  if (body.status && ["draft", "active", "retired"].includes(body.status)) update.status = body.status;
  if (body.title?.trim()) update.title = body.title.trim();
  if (body.summary !== undefined) update.summary = body.summary?.trim() || null;
  if (body.content !== undefined) update.content = body.content?.trim() || null;
  if (body.knowledge_type && TYPES.includes(body.knowledge_type)) update.knowledge_type = body.knowledge_type;
  if (!Object.keys(update).length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const { error } = await auth.admin.from("knowledge_objects").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (update.status) {
    await auth.admin.from("audit_log").insert({
      actor_id: auth.user.id, actor_name: auth.profile?.full_name ?? null,
      action: `knowledge_${update.status}`, entity_type: "knowledge_object", entity_id: id,
      new_value: { status: update.status },
    });
  }
  return NextResponse.json({ ok: true });
}
