import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolveEntitlements, primaryFunctionalWorkspace } from "@/lib/orchestration/entitlements";

// PW-014 §14.1 — GET /me/workspaces. Returns the signed-in user's entitled functional workspaces + active
// context, resolved server-side from live entitlements (visibility is not authorization — this IS the authorized
// list). First consumer of the P0 Entitlement Service; the launcher/landing will migrate onto it.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const activeRole = (await cookies()).get("active_role")?.value ?? null;
  const ent = await resolveEntitlements(admin, user.id, activeRole);
  const primary = primaryFunctionalWorkspace(ent);

  return NextResponse.json({
    activeRole: ent.activeRole,
    tenantId: ent.tenantId,
    hospitalId: ent.hospitalId,
    scopes: ent.scopes,
    primaryWorkspace: primary ? { key: primary.key, label: primary.label, href: primary.href } : null,
    workspaces: ent.workspaces.map(w => ({ key: w.key, label: w.label, icon: w.icon, href: w.href, kind: w.kind, reason: w.reason })),
  });
}
