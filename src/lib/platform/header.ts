// Global header context resolver (PUI-002 / HWW-UI-002).
//
// PUI-002's acceptance criterion is that "all workspaces implement the same header and navigation
// framework". A shared COMPONENT is only half of that: if each of the seventeen layouts assembled its own
// props, the counts, the workspace list and the user identity would drift apart workspace by workspace —
// which is exactly the drift the spec exists to stop. So every layout calls this one function, and the
// header is built from one query set with one set of rules.
//
// RBAC: the workspace list is the user's REAL entitlements (portals they hold plus dedicated org-role
// workspaces they may enter), computed server-side. The header cannot offer a destination the user's own
// layout gate would then refuse.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { cookies } from "next/headers";
import { ROLE_CONFIG, ORG_ROLE_CONFIG, type AppRole } from "@/lib/roles";
import { workspaceLinksForUser } from "@/lib/workspace-links";
import type { HeaderUser, HeaderWorkspace, HeaderUnit } from "@/components/platform/GlobalHeader";

export type HeaderContext = {
  user: HeaderUser;
  workspaces: HeaderWorkspace[];
  units: HeaderUnit[];
  activeUnitId: string | null;
  notifications: number;
  messages: number;
};

// Notification types that belong behind the ENVELOPE rather than the bell. Anything not listed here is a
// system/clinical notification and goes to the bell, so the two badges partition the same store exactly.
const MESSAGE_TYPES = ["message", "direct_message", "broadcast", "announcement"];

// The portal each AppRole lands in, labelled as the spec's workspace names.
const PORTAL_LABEL: Partial<Record<AppRole, string>> = {
  super_admin: "Platform Admin",
  hospital_admin: "Admin Workspace",
  educator: "Educator Workspace",
  assessor: "Assessor Workspace",
  nurse: "Personal Workspace",
};

export async function loadHeaderContext(
  admin: any,
  userId: string,
  opts: { currentHref?: string } = {},
): Promise<HeaderContext> {
  const soft = (p: any) => p.then((r: any) => r, () => ({ data: null, count: 0, error: true }));

  const { data: profile } = await soft(
    admin.from("profiles")
      .select("full_name, role, roles, org_role, org_roles, hospital_id, organisation_id")
      .eq("id", userId).single(),
  );

  const userRoles: AppRole[] = ((profile?.roles?.length ? profile.roles : [profile?.role]) as (AppRole | null)[])
    .filter(Boolean) as AppRole[];
  const orgRole: string | null = profile?.org_roles?.[0] ?? profile?.org_role ?? null;

  const [wsLinks, orgRes, unitRes, notifRes, msgRes] = await Promise.all([
    workspaceLinksForUser(admin, userId, userRoles).catch(() => []),
    profile?.organisation_id
      ? soft(admin.from("organisations").select("name").eq("id", profile.organisation_id).maybeSingle())
      : Promise.resolve({ data: null }),
    // Units belong to DEPARTMENTS, and departments to hospitals — `units` has no hospital_id. Filtering
    // units directly on hospital_id silently returned nothing (the error was swallowed by soft()), so the
    // unit selector never rendered at all. Found by scripts/schema-drift-audit.ts.
    profile?.hospital_id
      ? soft(admin.from("units")
          .select("id, name, departments!department_id(hospital_id)")
          .eq("departments.hospital_id", profile.hospital_id)
          .order("name").limit(100))
      : Promise.resolve({ data: [] }),
    // Both badges come from `notifications`, the only PER-USER read/unread store there is. Message-type
    // notifications go to the envelope, everything else to the bell, so the two never double-count the
    // same row. op_messages is deliberately NOT used: it is a channel store with no recipient or read
    // column, so any per-user count from it would be invented.
    soft(admin.from("notifications").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("read", false).not("type", "in", `(${MESSAGE_TYPES.join(",")})`)),
    soft(admin.from("notifications").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("read", false).in("type", MESSAGE_TYPES)),
  ]);

  // Portals the user holds, plus the dedicated org-role workspaces they may enter. Deduped by href so a
  // user who is both (say) assessor and charge nurse doesn't see the same destination twice.
  const seen = new Set<string>();
  const workspaces: HeaderWorkspace[] = [];
  const push = (w: HeaderWorkspace) => { if (!seen.has(w.href)) { seen.add(w.href); workspaces.push(w); } };

  for (const r of userRoles) {
    const cfg = ROLE_CONFIG[r];
    if (!cfg?.portal) continue;
    push({ label: PORTAL_LABEL[r] ?? cfg.label ?? r, href: cfg.portal, icon: (cfg as any).icon ?? "▸" });
  }
  for (const w of (wsLinks ?? []) as any[]) {
    push({ label: w.label, href: w.href, icon: w.icon ?? "▸" });
  }
  // Personal Workspace is always reachable — it is every user's own space, not a role.
  push({ label: "Personal Workspace", href: "/dashboard", icon: "⊞" });

  // Mark the one we are in: the longest href that prefixes the current path, so /supervisor/mdt matches
  // /supervisor rather than falling through to /dashboard.
  const here = opts.currentHref ?? "";
  const match = workspaces
    .filter(w => here === w.href || here.startsWith(`${w.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
  if (match) match.current = true;

  const cookieStore = await cookies();
  const activeUnitId = cookieStore.get("active_unit")?.value ?? null;
  const units = ((unitRes as any)?.data ?? []) as HeaderUnit[];

  const roleLabel = (orgRole && (ORG_ROLE_CONFIG as any)[orgRole]?.label)
    ?? (userRoles[0] ? ROLE_CONFIG[userRoles[0]]?.label : null)
    ?? "User";

  return {
    user: {
      name: profile?.full_name ?? "User",
      roleLabel,
      org: (orgRes as any)?.data?.name ?? null,
    },
    workspaces,
    units,
    // A selection that no longer resolves (unit deleted, or the user moved hospital) must not be shown as
    // active — otherwise the header claims a location the user is not in.
    activeUnitId: units.some(u => u.id === activeUnitId) ? activeUnitId : null,
    notifications: (notifRes as any)?.count ?? 0,
    messages: (msgRes as any)?.count ?? 0,
  };
}
