import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// In-app notifications: list your own + mark read.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const [{ data: rows }, { count }] = await Promise.all([
    admin.from("notifications").select("id, type, title, body, href, read, created_at")
      .eq("user_id", user.id).order("created_at", { ascending: false }).limit(30),
    admin.from("notifications").select("id", { count: "exact", head: true })
      .eq("user_id", user.id).eq("read", false),
  ]);
  return NextResponse.json({ notifications: rows ?? [], unread: count ?? 0 });
}

export async function PATCH(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ids, all } = await req.json().catch(() => ({}));
  const admin = createAdminClient();
  let q = admin.from("notifications").update({ read: true }).eq("user_id", user.id);
  if (!all) {
    if (!Array.isArray(ids) || !ids.length) return NextResponse.json({ error: "Pass ids[] or all:true" }, { status: 400 });
    q = q.in("id", ids);
  }
  const { error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
