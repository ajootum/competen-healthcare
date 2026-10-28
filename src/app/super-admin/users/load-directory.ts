import { estateRolesOf } from "@/lib/roles";
import { EMPTY_ACCESS, activeProducts, holdsHqPosition, listAllAuthUsers, loadDirectoryAccess, type Readable } from "@/lib/hq/user-directory";
import { loadClassifications, loadDefaultView, typeOf, type UserView } from "@/lib/hq/account-classification";
import type { UserRow } from "./UsersWorkspace";

// Landlord Portal -- User Management (Design System spec s6). Moved here from page.tsx by HQ-USERS-CLASSIFY-01 so the
// page and the CSV export (/api/super-admin/users/export) build the same rows from the same reads.
// Every column is computed from live sources: auth admin metadata gives last login / verification / suspension;
// competency_decisions gives the progress and passport rings. Progress rings are null (shown as "--") for users
// with no assessment decisions rather than 0%. The account type comes from hq_account_classification (650) and
// is display-only: it decides nothing.

type ProfileRow = {
  id: string; full_name: string; email: string; phone: string | null;
  role: string; roles: string[] | null; org_role: string | null; org_roles: string[] | null;
  hospital_id: string | null; organisation_id: string | null; platform_role: string | null;
  department_id: string | null; specialization: string | null; created_at: string;
};

const OK_OUTCOMES = new Set(["competent", "competent_with_conditions", "provisionally_competent"]);

export type Directory = {
  users: UserRow[];
  hospitals: { id: string; name: string; country: string }[];
  organisations: { id: string; name: string }[];
  departments: { id: string; name: string; hospital_id: string }[];
  readable: Readable;
  authComplete: boolean;
  classificationAvailable: boolean;
  defaultView: UserView;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadDirectory(admin: any): Promise<Directory> {
  const [
    { data: rawProfiles },
    { data: hospitals },
    { data: organisations },
    { data: rawDepts },
    { data: decisions },
    { data: authz },
    authList,
    directory,
    classes,
  ] = await Promise.all([
    admin.from("profiles")
      .select("id, full_name, email, phone, role, roles, org_role, org_roles, hospital_id, organisation_id, platform_role, department_id, specialization, created_at")
      .order("created_at", { ascending: false }),
    admin.from("hospitals").select("id, name, country"),
    admin.from("organisations").select("id, name"),
    admin.from("departments").select("id, name, hospital_id"),
    admin.from("competency_decisions")
      .select("nurse_id, competency_id, cpu_id, outcome, expiry_date, created_at")
      .order("created_at", { ascending: false }),
    admin.from("clinical_authorizations").select("nurse_id, status"),
    // HQ-USERS-C: every Auth page, not only the first 1000, and the access each person holds.
    listAllAuthUsers(admin),
    loadDirectoryAccess(admin),
    loadClassifications(admin),
  ]);
  const defaultView = await loadDefaultView(admin, classes.available);

  const authById = new Map(
    authList.users.map((u: { id: string; last_sign_in_at?: string | null; email_confirmed_at?: string | null; invited_at?: string | null }) => [u.id, {
      lastSignIn: u.last_sign_in_at ?? null,
      emailConfirmed: !!u.email_confirmed_at,
      invitedAt: u.invited_at ?? null,
      bannedUntil: (u as { banned_until?: string | null }).banned_until ?? null,
    }])
  );

  // Latest decision per (nurse, competency-or-cpu); rows are newest-first.
  const seen = new Set<string>();
  const perUser = new Map<string, { total: number; ok: number; current: number }>();
  const today = new Date().toISOString().slice(0, 10);
  for (const d of (decisions ?? []) as { nurse_id: string; competency_id: string | null; cpu_id: string | null; outcome: string; expiry_date: string | null }[]) {
    const key = `${d.nurse_id}:${d.competency_id ?? d.cpu_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const m = perUser.get(d.nurse_id) ?? { total: 0, ok: 0, current: 0 };
    m.total++;
    if (OK_OUTCOMES.has(d.outcome)) {
      m.ok++;
      if (!d.expiry_date || d.expiry_date >= today) m.current++;
    }
    perUser.set(d.nurse_id, m);
  }

  const authzByUser = new Map<string, number>();
  for (const a of (authz ?? []) as { nurse_id: string; status: string }[]) {
    if (a.status === "active") authzByUser.set(a.nurse_id, (authzByUser.get(a.nurse_id) ?? 0) + 1);
  }

  const hospitalList = ((hospitals ?? []) as Record<string, string>[]).map(h => ({ id: h.id, name: h.name, country: h.country ?? "" }));
  const orgList = ((organisations ?? []) as Record<string, string>[]).map(o => ({ id: o.id, name: o.name }));
  const deptList = ((rawDepts ?? []) as Record<string, string>[]).map(d => ({ id: d.id, name: d.name, hospital_id: d.hospital_id ?? "" }));
  const hospitalMap = Object.fromEntries(hospitalList.map(h => [h.id, h.name]));
  const orgMap = Object.fromEntries(orgList.map(o => [o.id, o.name]));
  const deptMap = Object.fromEntries(deptList.map(d => [d.id, d.name]));

  const users: UserRow[] = ((rawProfiles ?? []) as ProfileRow[]).map(p => {
    const a = authById.get(p.id);
    const m = perUser.get(p.id);
    const suspended = !!a?.bannedUntil && new Date(a.bannedUntil) > new Date();
    const status: UserRow["status"] =
      suspended ? "suspended"
      : !a?.lastSignIn && a?.invitedAt ? "pending"
      : a && !a.emailConfirmed ? "pending"
      : "active";
    const access = directory.byUser.get(p.id) ?? EMPTY_ACCESS();
    return {
      id: p.id, name: p.full_name ?? "—", email: p.email, phone: p.phone ?? null,
      // ⚠ THE DRIFTED FOLD THIS LINE USED TO CARRY: `p.roles ?? [p.role]`, which answers [] for a
      // profile holding roles: [] beside a real role -- and 35 of 47 live profiles are exactly that
      // shape (identity-resolver-harness measurement, 2026-08-16). Those people rendered with no
      // role chips, matched no role filter, joined no portal group and exported blank, while every
      // GATE in the product admitted them by the canonical fold. Repointing to estateRolesOf is a
      // deliberate behaviour change AT THIS SITE: the screen now answers what the gates answer.
      role: p.role, roles: estateRolesOf(p),
      orgRole: p.org_role ?? null, orgRoles: p.org_roles ?? null,
      platformRole: p.platform_role ?? null,
      organisationId: p.organisation_id ?? null,
      organisation: p.organisation_id ? orgMap[p.organisation_id] ?? null : null,
      hospitalId: p.hospital_id ?? null,
      facility: p.hospital_id ? hospitalMap[p.hospital_id] ?? null : null,
      department: p.department_id ? deptMap[p.department_id] ?? null : null,
      departmentId: p.department_id ?? null,
      specialization: p.specialization ?? null,
      status,
      statusDetail: suspended ? "Access suspended"
        : status === "pending" ? (!a?.emailConfirmed && a?.lastSignIn ? "Email unverified" : "Invitation sent")
        : "Email verified",
      lastSignIn: a?.lastSignIn ?? null,
      joinedAt: p.created_at,
      // null = never assessed; the UI renders "—", not a misleading 0%
      competencyPct: m ? Math.round((m.ok / m.total) * 100) : null,
      passportPct: m ? Math.round((m.current / m.total) * 100) : null,
      decisionsTotal: m?.total ?? 0,
      decisionsOk: m?.ok ?? 0,
      decisionsCurrent: m?.current ?? 0,
      activeAuthorizations: authzByUser.get(p.id) ?? 0,
      access,
      products: activeProducts(access),
      hqActive: holdsHqPosition(access),
      accountType: typeOf(classes, p.id),
    };
  });

  return {
    users, hospitals: hospitalList, organisations: orgList, departments: deptList,
    readable: directory.readable, authComplete: authList.complete,
    classificationAvailable: classes.available, defaultView,
  };
}
