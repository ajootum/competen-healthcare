import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, hospital_id").eq("id", user.id).single();
  if (!profile || !["hospital_admin", "super_admin"].includes(profile.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { framework_id } = await req.json();
  if (!framework_id) return NextResponse.json({ error: "framework_id required" }, { status: 400 });

  const hospitalId = profile.hospital_id;
  if (!hospitalId) return NextResponse.json({ error: "No hospital assigned" }, { status: 400 });

  const { data: master } = await admin
    .from("frameworks")
    .select("id, name, library, description, is_active")
    .eq("id", framework_id)
    .single();
  if (!master) return NextResponse.json({ error: "Framework not found" }, { status: 404 });

  // Prevent duplicate adoptions
  const { data: existing } = await admin
    .from("frameworks")
    .select("id")
    .eq("parent_framework_id", framework_id)
    .eq("owner_id", hospitalId)
    .returns<{ id: string }[]>()
    .maybeSingle();
  if (existing) return NextResponse.json({ error: "Already adopted", existing_id: existing.id }, { status: 409 });

  // Get full content tree
  const { data: domains } = await admin
    .from("framework_domains")
    .select(`
      id, name, sort_order,
      framework_competencies(
        id, name, description, sort_order,
        competency_skills(id, name, sort_order)
      )
    `)
    .eq("framework_id", framework_id)
    .order("sort_order");

  // Create adopted framework copy
  const { data: adopted, error: fwErr } = await admin
    .from("frameworks")
    .insert({
      name: master.name,
      library: master.library,
      description: master.description,
      is_active: master.is_active,
      pub_status: "published",
      scope: "hospital",
      owner_type: "hospital",
      owner_id: hospitalId,
      parent_framework_id: framework_id,
    })
    .select("id")
    .single();
  if (fwErr || !adopted) return NextResponse.json({ error: fwErr?.message ?? "Failed" }, { status: 500 });

  // Deep copy: domains → competencies → skills
  for (const domain of (domains ?? [])) {
    const { data: newDomain } = await admin
      .from("framework_domains")
      .insert({ framework_id: adopted.id, name: domain.name, sort_order: domain.sort_order })
      .select("id")
      .single();
    if (!newDomain) continue;

    type RawComp = { id: string; name: string; description?: string | null; sort_order: number; competency_skills?: { id: string; name: string; sort_order: number }[] };
    for (const comp of ((domain.framework_competencies ?? []) as unknown as RawComp[])) {
      const { data: newComp } = await admin
        .from("framework_competencies")
        .insert({ domain_id: newDomain.id, name: comp.name, description: comp.description ?? null, sort_order: comp.sort_order })
        .select("id")
        .single();
      if (!newComp) continue;

      const skills = comp.competency_skills ?? [];
      if (skills.length) {
        await admin.from("competency_skills").insert(
          skills.map(s => ({ competency_id: newComp.id, name: s.name, sort_order: s.sort_order, is_active: true }))
        );
      }
    }
  }

  return NextResponse.json({ id: adopted.id }, { status: 201 });
}
