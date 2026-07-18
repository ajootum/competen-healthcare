import { createClient, createAdminClient } from "@/lib/supabase/server";
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

  // Duplicate detection (§G): same activity on the same date is almost always
  // a double entry — reject with a clear message. Checked with the service
  // client: cpd_logs has no RLS select policy, so the user client sees 0 rows.
  const activityDate = body.activity_date || new Date().toISOString().split("T")[0];
  const { data: existing } = await createAdminClient().from("cpd_logs")
    .select("id, title").eq("user_id", user.id).eq("activity_date", activityDate)
    .ilike("title", body.title.trim());
  if ((existing ?? []).length > 0) {
    return NextResponse.json(
      { error: `"${body.title.trim()}" is already logged for ${activityDate} — duplicate entries aren't allowed` },
      { status: 409 },
    );
  }

  const { error } = await supabase.from("cpd_logs").insert({
    user_id: user.id,
    activity_type: body.activity_type.trim(),
    title: body.title.trim(),
    hours,
    cpd_points: parseInt(body.cpd_points) || 1,
    activity_date: activityDate,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}
