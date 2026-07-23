import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, hospital_id").eq("id", user.id).single();
  if (!profile || !["hospital_admin", "super_admin"].includes(profile.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const hospitalId = profile.hospital_id;

  const [{ data: hospital }, { data: rules }] = await Promise.all([
    admin.from("hospitals").select("id, name, logo_url, accent_color").eq("id", hospitalId ?? "").single(),
    admin.from("framework_rules").select("id, framework_id, min_passing_score, min_passing_pct")
      .eq("hospital_id", hospitalId ?? ""),
  ]);

  return NextResponse.json({ hospital, rules: rules ?? [] });
}

export async function PATCH(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, hospital_id").eq("id", user.id).single();
  if (!profile || !["hospital_admin", "super_admin"].includes(profile.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const hospitalId = profile.hospital_id;
  const body = await req.json();

  if (body.type === "branding") {
    const { logo_url, accent_color } = body;
    const update: Record<string, string | null> = {};
    if (logo_url !== undefined)    update.logo_url    = logo_url || null;
    if (accent_color !== undefined) update.accent_color = accent_color || "#0d9488";
    await admin.from("hospitals").update(update).eq("id", hospitalId ?? "");
    return NextResponse.json({ ok: true });
  }

  if (body.type === "rules") {
    const { framework_id, min_passing_score, min_passing_pct } = body;
    if (!framework_id) return NextResponse.json({ error: "framework_id required" }, { status: 400 });
    await admin.from("framework_rules").upsert({
      framework_id,
      hospital_id: hospitalId,
      min_passing_score: min_passing_score ?? 4,
      min_passing_pct:   min_passing_pct   ?? 80,
    }, { onConflict: "framework_id,hospital_id" });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown type" }, { status: 400 });
}
