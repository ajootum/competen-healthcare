import { createClient, createAdminClient } from "@/lib/supabase/server";
import { platformRolesOf, hasPlatformRole, type PlatformRole } from "@/lib/roles";

// Landlord-plane access resolution. The landlord axis is: the AppRole
// `super_admin` (a permanent, full-authority platform super admin) PLUS the finer
// PlatformRole tier that specializes internal staff (owner, operations, customer
// success, finance, …). A super_admin has full landlord authority with no
// PlatformRole assigned; to scope someone narrowly, give them a PlatformRole and
// NOT super_admin. The tenant plane (AppRole hospital_admin/OrgRole) is separate.
/* eslint-disable @typescript-eslint/no-explicit-any */

export type LandlordCaller = {
  admin: ReturnType<typeof createAdminClient>;
  userId: string;
  fullName: string | null;
  appRoles: string[];
  platformRoles: PlatformRole[];
  isSuperAdmin: boolean; // AppRole super_admin — a full-authority landlord super admin
  isOwner: boolean;      // full landlord authority (super_admin or platform_owner)
};

export async function getLandlordCaller(): Promise<LandlordCaller | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles").select("full_name, role, roles, platform_role, platform_roles").eq("id", user.id).single() as any;
  const appRoles = ((me?.roles?.length ? me.roles : [me?.role]) as (string | null)[]).filter(Boolean) as string[];
  const platformRoles = platformRolesOf(me);
  const isSuperAdmin = appRoles.includes("super_admin");
  // Landlord access = a platform super admin, or anyone holding a PlatformRole.
  if (!isSuperAdmin && platformRoles.length === 0) return null;
  return {
    admin, userId: user.id, fullName: (me?.full_name as string) ?? null,
    appRoles, platformRoles, isSuperAdmin,
    isOwner: isSuperAdmin || hasPlatformRole(me, "platform_owner"),
  };
}

// True if the caller may enter a surface requiring one of `required` landlord
// roles. A super admin / owner has full authority and passes everything.
export function landlordCan(caller: LandlordCaller, ...required: PlatformRole[]): boolean {
  if (caller.isOwner) return true;
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
