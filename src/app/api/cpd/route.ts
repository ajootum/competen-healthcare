import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = await request.json();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { error } = await supabase.from("cpd_logs").insert({
    user_id: user.id,
    activity_type: body.activity_type,
    title: body.title,
    hours: parseFloat(body.hours),
    cpd_points: parseInt(body.cpd_points) || 1,
    activity_date: body.activity_date || new Date().toISOString().split("T")[0],
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}
