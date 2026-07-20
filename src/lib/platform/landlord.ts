import { createClient, createAdminClient } from "@/lib/supabase/server";
import { platformRolesOf, hasPlatformRole, type PlatformRole } from "@/lib/roles";

// Landlord-plane access resolution. The landlord axis (PlatformRole) is separate
// from the tenant AppRole/OrgRole: it means the user operates the platform ACROSS
// tenants. During the transition (before platform roles are provisioned) a tenant
// super_admin is BRIDGED to landlord access so the platform is never locked out;
// once any landlord role is assigned to a user, the platform axis governs them.
/* eslint-disable @typescript-eslint/no-explicit-any */

export type LandlordCaller = {
  admin: ReturnType<typeof createAdminClient>;
  userId: string;
  fullName: string | null;
  appRoles: string[];
  platformRoles: PlatformRole[];
  isOwner: boolean;
  bridgedFromSuperAdmin: boolean;
};

export async function getLandlordCaller(): Promise<LandlordCaller | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles").select("full_name, role, roles, platform_role, platform_roles").eq("id", user.id).single() as any;
  const appRoles = ((me?.roles?.length ? me.roles : [me?.role]) as (string | null)[]).filter(Boolean) as string[];
  const platformRoles = platformRolesOf(me);
  const isSuper = appRoles.includes("super_admin");
  const hasLandlord = platformRoles.length > 0;
  if (!hasLandlord && !isSuper) return null;
  const bridged = !hasLandlord && isSuper;
  return {
    admin, userId: user.id, fullName: (me?.full_name as string) ?? null,
    appRoles, platformRoles,
    isOwner: hasPlatformRole(me, "platform_owner") || bridged,
    bridgedFromSuperAdmin: bridged,
  };
}

// True if the caller may enter a surface requiring one of `required` landlord
// roles. Owner passes everything; a bridged super_admin passes (transitional).
export function landlordCan(caller: LandlordCaller, ...required: PlatformRole[]): boolean {
  if (caller.isOwner || caller.bridgedFromSuperAdmin) return true;
  if (required.length === 0) return caller.platformRoles.length > 0;
  return caller.platformRoles.some(r => required.includes(r));
}

// Record a landlord-plane action to the Global Audit Centre (best-effort).
export async function landlordAudit(admin: any, caller: { userId: string; fullName: string | null }, entry: {
  action: string; entity_type?: string; entity_id?: string | null; entity_name?: string | null;
  tenant_id?: string | null; new_value?: any; reason?: string | null;
}) {
  try {
    await admin.from("plat_audit_events").insert({
      actor_id: caller.userId, actor_name: caller.fullName, actor_plane: "landlord",
      action: entry.action, entity_type: entry.entity_type ?? null, entity_id: entry.entity_id ?? null,
      entity_name: entry.entity_name ?? null, tenant_id: entry.tenant_id ?? null,
      new_value: entry.new_value ?? null, reason: entry.reason ?? null,
    });
  } catch { /* pre-migration / non-fatal */ }
}
