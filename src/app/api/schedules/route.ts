import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await createAdminClient().from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "super_admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { name, cycle_type, frequency_months, grace_period_days, framework_id, trigger_on_fail, trigger_on_expiry, trigger_on_role_change, auto_create_cycle } = body;
  if (!name || !frequency_months) return NextResponse.json({ error: "name and frequency_months required" }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin.from("reassessment_schedules").insert({
    name, cycle_type, frequency_months, grace_period_days: grace_period_days ?? 30,
    framework_id: framework_id ?? null,
    trigger_on_fail: Boolean(trigger_on_fail),
    trigger_on_expiry: Boolean(trigger_on_expiry),
    trigger_on_role_change: Boolean(trigger_on_role_change),
    auto_create_cycle: Boolean(auto_create_cycle),
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin.from("reassessment_schedules").select("*, frameworks(name)").order("cycle_type");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
