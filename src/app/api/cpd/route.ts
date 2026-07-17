import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = await request.json();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Validate before insert — NaN hours would otherwise serialise to null and
  // store a silent bad row.
  const hours = Number(body.hours);
  if (!body.title?.trim() || !body.activity_type?.trim()) {
    return NextResponse.json({ error: "title and activity_type are required" }, { status: 400 });
  }
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
    return NextResponse.json({ error: "hours must be a number between 0 and 24" }, { status: 400 });
  }

  const { error } = await supabase.from("cpd_logs").insert({
    user_id: user.id,
    activity_type: body.activity_type.trim(),
    title: body.title.trim(),
    hours,
    cpd_points: parseInt(body.cpd_points) || 1,
    activity_date: body.activity_date || new Date().toISOString().split("T")[0],
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}
