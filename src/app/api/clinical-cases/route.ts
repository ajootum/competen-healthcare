import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Clinical case studies — publish / retire / adjust difficulty.

async function requireAuthor() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized", status: 401 as const };
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, full_name").eq("id", user.id).single();
  if (!["super_admin", "hospital_admin", "educator"].includes(profile?.role ?? "")) {
    return { error: "Forbidden", status: 403 as const };
  }
  return { user, admin, profile };
}

export async function PATCH(req: Request) {
  const auth = await requireAuthor();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const body = await req.json();

  const update: Record<string, unknown> = {};
  if (body.status && ["draft", "active", "retired"].includes(body.status)) update.status = body.status;
  if (body.difficulty && ["foundation", "intermediate", "advanced"].includes(body.difficulty)) update.difficulty = body.difficulty;
  if (!Object.keys(update).length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const { error } = await auth.admin.from("clinical_cases").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (update.status) {
    await auth.admin.from("audit_log").insert({
      actor_id: auth.user.id, actor_name: auth.profile?.full_name ?? null,
      action: `case_${update.status}`, entity_type: "clinical_case", entity_id: id,
      new_value: { status: update.status },
    });
  }
  return NextResponse.json({ ok: true });
}
