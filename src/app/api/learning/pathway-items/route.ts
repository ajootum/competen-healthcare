import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// PATCH — a nurse marks their own pathway item complete/incomplete.
export async function PATCH(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, status } = await req.json();
  if (!id || !["pending", "in_progress", "completed"].includes(status)) {
    return NextResponse.json({ error: "id and valid status required" }, { status: 400 });
  }

  const admin = createAdminClient();
  // Verify ownership: item's pathway must belong to this user
  const { data: item } = await admin
    .from("pathway_items")
    .select("id, pathway_id, learning_pathways(nurse_id)")
    .eq("id", id)
    .single();
  const owner = (item?.learning_pathways as unknown as { nurse_id: string } | null)?.nurse_id;
  if (!item || owner !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await admin.from("pathway_items").update({ status }).eq("id", id);
  return NextResponse.json({ ok: true });
}
