import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: hospitals } = await createAdminClient()
    .from("hospitals")
    .select("id, name");

  const map = Object.fromEntries((hospitals ?? []).map(h => [h.id, h.name]));
  return NextResponse.json({ hospitals: map });
}
