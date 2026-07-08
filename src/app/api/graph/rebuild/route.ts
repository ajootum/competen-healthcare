import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { rebuildKnowledgeGraph, graphStats } from "@/lib/engines/graph";

async function requireSuperAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized", status: 401 as const };
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, full_name").eq("id", user.id).single();
  if (profile?.role !== "super_admin") return { error: "Forbidden", status: 403 as const };
  return { user, admin, profile };
}

export async function POST() {
  const auth = await requireSuperAdmin();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const result = await rebuildKnowledgeGraph(auth.admin);
  await auth.admin.from("audit_log").insert({
    actor_id: auth.user.id, actor_name: auth.profile?.full_name ?? null,
    action: "rebuild_knowledge_graph", entity_type: "graph", entity_id: null,
    new_value: { edges: result.edges },
  });
  return NextResponse.json(result);
}

export async function GET() {
  const auth = await requireSuperAdmin();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json(await graphStats(auth.admin));
}
