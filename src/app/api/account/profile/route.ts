import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Profile self-editing (Account Management). Only personal fields are
// writable — role, hospital and organisation stay server-controlled.
const EDITABLE = ["full_name", "phone", "country", "specialization"] as const;

export async function PATCH(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const update: Record<string, string | null> = {};
  for (const key of EDITABLE) {
    if (key in body) {
      const v = String(body[key] ?? "").trim();
      update[key] = v || null;
    }
  }
  if (update.full_name === null) {
    return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
  }
  if (!Object.keys(update).length) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin.from("profiles").update(update).eq("id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await admin.from("audit_log").insert({
    actor_id: user.id, actor_name: update.full_name ?? null,
    action: "update_profile", entity_type: "profile", entity_id: user.id,
    entity_name: Object.keys(update).join(", "),
  });
  return NextResponse.json({ ok: true });
}
