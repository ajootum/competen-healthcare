import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { platformRolesOf, hasPlatformRole, type PlatformRole } from "@/lib/roles";
import {
  decideHq, activeGrants, capabilityForRoute, isHqOfficeType,
  type HqDecision, type HqMode,
} from "./spaces";

/**
 * requireHqContext(capability) — the one way a /super-admin page establishes who is standing there.
 *
 * ⚠ WHY EVERY PAGE HAS TO CALL THIS RATHER THAN TRUSTING THE LAYOUT. Next 16's own documentation,
 * node_modules/next/dist/docs/01-app/02-guides/authentication.md:
 *
 *   "A common pattern in SPAs is to `return null` in a layout or a top-level component if a user is not
 *    authorized. This pattern is not recommended since Next.js applications have multiple entry points,
 *    which will not prevent nested route segments and Server Actions from being accessed."
 *
 * and, on the same page: "Due to Partial Rendering, be cautious when doing checks in Layouts as these
 * don't re-render on navigation, meaning the user session won't be checked on every route change …
 * Instead, you should do the checks close to your data source or the component that'll be conditionally
 * rendered." The proxy is not the alternative either — .../16-proxy.md: proxy "should not be used as a
 * full session management or authorization solution".
 *
 * Today /super-admin is 204 page patterns behind ONE `roles.includes("super_admin")` test in the layout,
 * and 36 of those pages carry no role test of their own at all. This function is what each of them calls.
 *
 * MODELLED ON requirePracticeContext (src/lib/practice/api-context.ts) — the most complete authorisation
 * model in this codebase — not on a role string. Same guard order: authenticate, resolve the context,
 * establish membership, THEN test the capability the route declares.
 *
 * ⚠ IT IS NOT A RENAME AND IT MOVES NOTHING. The /hq rename comes later, once every page carries this, so
 * that no window exists in which /hq/* is reachable ungated.
 */

export type HqContext = {
  admin: ReturnType<typeof createAdminClient>;
  userId: string;
  fullName: string | null;
  roles: string[];
  platformRoles: PlatformRole[];
  /** super_admin (the RLS anchor, untouched by this programme) or platform_owner. */
  isOwner: boolean;
  /** hq_position codes held through a live ogs_office_appointments row. */
  positions: string[];
  /** the union of what those positions currently grant. */
  capabilities: string[];
  mode: HqMode;
  capability: string | null;
  decision: HqDecision;
};

type ProfileRow = {
  full_name: string | null;
  role: string | null;
  roles: string[] | null;
  platform_role: string | null;
  platform_roles: string[] | null;
};

async function currentRoute(): Promise<string> {
  try {
    const h = await headers();
    return h.get("x-pathname") ?? "/super-admin";
  } catch {
    return "/super-admin";
  }
}

/**
 * The positions a person holds, read from the SAME two tables that already gate CMO, QAW and HEX.
 *
 * ⚠ REUSED, NOT REBUILT — but read directly rather than through holdsOfficeAppointment(), and the reason
 * matters. That helper resolves offices through MATCHERS (a fuzzy name/type map) and filters by
 * hospital_id for anyone who is not a super admin. HQ's five offices are ENTERPRISE-scoped with a null
 * hospital_id and are deliberately typed 'hq_*' so the tenant matchers cannot see them. Routing HQ through
 * that helper would either have required passing isSuper=true unconditionally — which defeats the point —
 * or teaching the tenant matchers about platform spaces, which is how an HQ appointment would have started
 * granting Hospital Executive access.
 *
 * The APPOINTMENT SEMANTICS are copied exactly: a row counts only when its status is not 'removed' or
 * 'expired'. ogs_office_appointments.role carries the hq_position code.
 */
export async function resolveHqPositions(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<{ positions: string[]; capabilities: string[] }> {
  const { data: offices, error: oErr } = await admin
    .from("ogs_offices")
    .select("id, office_type, code, is_active, status")
    .limit(500);
  if (oErr || !offices?.length) return { positions: [], capabilities: [] };

  const hqOfficeIds = (offices as { id: string; office_type: string | null; is_active: boolean | null; status: string | null }[])
    .filter(o => isHqOfficeType(o.office_type) && o.is_active !== false && o.status !== "dissolved" && o.status !== "archived")
    .map(o => o.id);
  if (!hqOfficeIds.length) return { positions: [], capabilities: [] };

  const { data: appts, error: aErr } = await admin
    .from("ogs_office_appointments")
    .select("office_id, person_id, role, status")
    .in("office_id", hqOfficeIds)
    .eq("person_id", userId)
    .limit(200);
  if (aErr || !appts?.length) return { positions: [], capabilities: [] };

  const positions = [...new Set(
    (appts as { role: string | null; status: string | null }[])
      .filter(a => a.status !== "removed" && a.status !== "expired" && !!a.role)
      .map(a => a.role as string),
  )].sort();
  if (!positions.length) return { positions: [], capabilities: [] };

  // Only ACTIVE positions grant anything — deactivating a position must actually withdraw it.
  const { data: posRows } = await admin
    .from("hq_position").select("code, is_active").in("code", positions).limit(200);
  const live = new Set(((posRows ?? []) as { code: string; is_active: boolean | null }[])
    .filter(p => p.is_active !== false).map(p => p.code));
  const activePositions = positions.filter(p => live.has(p));
  if (!activePositions.length) return { positions, capabilities: [] };

  const { data: grants } = await admin
    .from("hq_position_capability")
    .select("position_code, capability_code, effective_from, effective_to")
    .in("position_code", activePositions)
    .limit(2000);
  const capabilities = [...new Set(
    activeGrants((grants ?? []) as { capability_code: string; effective_from: string | null; effective_to: string | null }[])
      .map(g => g.capability_code),
  )].sort();

  return { positions, capabilities };
}

/**
 * ⚠ DEFAULTS TO OBSERVE ON EVERY FAILURE PATH, AND THAT IS DELIBERATE. If hq_config is missing, empty or
 * unreadable, the answer is 'observe' — the mode that records rather than refuses. The alternative default
 * would mean an unapplied migration or a transient read error silently switches a platform-wide refusal on,
 * for the two accounts with no MFA factor and no one above them to let them back in.
 */
export async function readHqMode(admin: ReturnType<typeof createAdminClient>): Promise<HqMode> {
  try {
    const { data, error } = await admin.from("hq_config").select("mode").eq("id", "singleton").limit(1);
    if (error) return "observe";
    const mode = (data?.[0] as { mode?: string } | undefined)?.mode;
    return mode === "enforce" ? "enforce" : "observe";
  } catch {
    return "observe";
  }
}

/** Best-effort ledger write. Never blocks the request — an observation nobody could record is not a refusal. */
async function record(
  admin: ReturnType<typeof createAdminClient>,
  row: { userId: string; route: string; capability: string | null; decision: HqDecision; mode: HqMode; positions: string[]; reason: string },
): Promise<void> {
  try {
    await admin.from("hq_access_observation").insert({
      user_id: row.userId, route: row.route, capability: row.capability,
      decision: row.decision, mode: row.mode, positions: row.positions, reason: row.reason,
    });
  } catch { /* pre-migration / non-fatal */ }
}

export type HqResolution =
  | { ok: true; ctx: HqContext }
  | { ok: false; redirectTo: string; decision: HqDecision; reason: string };

/**
 * The full resolution, without the redirect — so the decision can be tested directly and so an API route
 * can reuse it later without inheriting a page's navigation behaviour.
 */
export async function resolveHqContext(capability: string | null): Promise<HqResolution> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, redirectTo: "/login", decision: "deny", reason: "not authenticated" };

  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles").select("full_name, role, roles, platform_role, platform_roles")
    .eq("id", user.id).single();
  const me = (data ?? null) as ProfileRow | null;

  const roles = ((me?.roles?.length ? me.roles : [me?.role]) as (string | null)[]).filter(Boolean) as string[];
  const platformRoles = platformRolesOf(me);
  // ⚠ super_admin IS UNCHANGED BY THIS PROGRAMME. It is the RLS anchor and it becomes the break-glass
  // owner, held by one or two accounts. It is read here and nowhere altered.
  const isOwner = roles.includes("super_admin") || hasPlatformRole(me, "platform_owner");

  const route = await currentRoute();
  const declared = capability ?? capabilityForRoute(route);

  if (isOwner) {
    return {
      ok: true,
      ctx: {
        admin, userId: user.id, fullName: me?.full_name ?? null, roles, platformRoles, isOwner: true,
        positions: [], capabilities: [], mode: "observe", capability: declared, decision: "allow_owner",
      },
    };
  }

  const [{ positions, capabilities }, mode] = await Promise.all([
    resolveHqPositions(admin, user.id),
    readHqMode(admin),
  ]);
  const verdict = decideHq({ isOwner: false, positions, capabilities, capability: declared, mode });

  if (verdict.decision !== "allow") {
    await record(admin, { userId: user.id, route, capability: declared, decision: verdict.decision, mode, positions, reason: verdict.reason });
  }
  if (!verdict.allowed) {
    // Same destination the existing super-admin guards already use on refusal (aisGuard / ppeGuard),
    // so a refusal here looks like every other refusal in this estate rather than a new dead end.
    return { ok: false, redirectTo: "/dashboard", decision: verdict.decision, reason: verdict.reason };
  }

  return {
    ok: true,
    ctx: {
      admin, userId: user.id, fullName: me?.full_name ?? null, roles, platformRoles, isOwner: false,
      positions, capabilities, mode, capability: declared, decision: verdict.decision,
    },
  };
}

/**
 * The page-level guard. Redirects on refusal, returns the resolved context otherwise.
 *
 * Pass the capability the page needs. Passing null falls back to the route→capability intent map, and an
 * unmapped route then DENIES for every non-owner — a new page that forgets to declare itself is refused,
 * not admitted.
 */
export async function requireHqContext(capability: string | null = null): Promise<HqContext> {
  const res = await resolveHqContext(capability);
  if (!res.ok) redirect(res.redirectTo);
  return res.ctx;
}
