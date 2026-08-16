import { createClient, createAdminClient } from "@/lib/supabase/server";
import { estateRolesOf, platformRolesOf, hasPlatformRole, type PlatformRole } from "@/lib/roles";

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
  const appRoles = estateRolesOf(me) as string[];
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

// ⚠ THE TWO BACK-COMPAT ALIASES, CANONICALISED IN ONE PLACE.
// PlatformRole carries thirteen values and two of them are aliases documented in src/lib/roles.ts:
// `platform_super_admin` is PSA-001 spelled the old way (canonically `platform_operations`), and
// `developer` is ENG-001 spelled the old way (canonically `engineer`). Held values and required values
// are both canonicalised below, so a gate naming the canonical role admits a holder of the alias and vice
// versa. Without this, the alias is a value the type accepts, the database (from migration 264) accepts,
// and every gate silently ignores.
const CANONICAL: Partial<Record<PlatformRole, PlatformRole>> = {
  platform_super_admin: "platform_operations",
  developer: "engineer",
};
const canonical = (r: PlatformRole): PlatformRole => CANONICAL[r] ?? r;

// True if the caller may enter a surface requiring one of `required` landlord
// roles. A super admin / owner has full authority and passes everything.
//
// ⚠ AN EMPTY `required` DENIES. It used to return `caller.platformRoles.length > 0`, which meant a route
// that resolved a landlord caller and then forgot to name the roles it wanted was reachable by EVERY
// position holder. No call site hits that branch today, so this was a latent trap rather than a live hole
// — but defaulting to reachable is precisely how a graduated-access programme fails quietly, and the
// branch is the shape a new route reaches for. A caller that genuinely means "any landlord role" now has
// to say so with `caller.platformRoles.length > 0`, in the open, at its own call site.
export function landlordCan(caller: LandlordCaller, ...required: PlatformRole[]): boolean {
  if (caller.isOwner) return true;
  if (required.length === 0) return false;
  const want = new Set(required.map(canonical));
  return caller.platformRoles.some(r => want.has(canonical(r)));
}

// Record a landlord-plane action to the Global Audit Centre (best-effort).
export async function landlordAudit(admin: any, caller: { userId: string; fullName: string | null }, entry: {
  action: string; entity_type?: string; entity_id?: string | null; entity_name?: string | null;
  tenant_id?: string | null; old_value?: any; new_value?: any; reason?: string | null;
}) {
  try {
    await admin.from("plat_audit_events").insert({
      actor_id: caller.userId, actor_name: caller.fullName, actor_plane: "landlord",
      action: entry.action, entity_type: entry.entity_type ?? null, entity_id: entry.entity_id ?? null,
      entity_name: entry.entity_name ?? null, tenant_id: entry.tenant_id ?? null,
      old_value: entry.old_value ?? null, new_value: entry.new_value ?? null, reason: entry.reason ?? null,
    });
  } catch { /* pre-migration / non-fatal */ }
}
