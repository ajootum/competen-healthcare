import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function PATCH(request: Request) {
  const { course_id, progress } = await request.json();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const update: Record<string, unknown> = { progress };
  if (progress === 100) update.completed_at = new Date().toISOString();

  const { error } = await supabase
    .from("course_enrollments")
    .update(update)
    .eq("user_id", user.id)
    .eq("course_id", course_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}
