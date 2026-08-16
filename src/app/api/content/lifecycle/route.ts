import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { transitionFramework, type FrameworkAction } from "@/lib/competency/framework-lifecycle";
import { estateRolesOf } from "@/lib/roles";

// Framework lifecycle transitions. The governed state machine lives in framework-lifecycle.ts (shared with
// the CAP-001 asset write-back so both go through the identical path); this route is auth + a thin wrapper.

export async function PATCH(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  // Roles-array aware (matches getCaller/page gates): multi-role super admins pass.
  const { data: profile } = await admin.from("profiles").select("role, roles, full_name").eq("id", user.id).single();
  const roles: string[] = estateRolesOf(profile);
  if (!roles.includes("super_admin")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { frameworkId, action }: { frameworkId: string; action: FrameworkAction } = await req.json();
  const r = await transitionFramework(admin, frameworkId, action, { id: user.id, name: profile?.full_name ?? null });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.code ?? 500 });
  return NextResponse.json({ ok: true, warning: r.warning });
}
