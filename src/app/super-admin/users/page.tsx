import { createAdminClient, createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import UsersWorkspace, { type UserRow, type AuditEntry } from "./UsersWorkspace";

// Landlord Portal — User Management (Design System spec §6).
// Every column is computed from live sources: auth admin metadata gives last
// login / verification / suspension; competency_decisions gives the progress
// and passport rings; audit_log backs the drawer's history. Progress rings are
// null (shown as "—") for users with no assessment decisions rather than 0%.

type ProfileRow = {
  id: string; full_name: string; email: string; phone: string | null;
  role: string; roles: string[] | null; org_role: string | null; org_roles: string[] | null;
  hospital_id: string | null; organisation_id: string | null; platform_role: string | null;
  department_id: string | null; specialization: string | null; created_at: string;
};

const OK_OUTCOMES = new Set(["competent", "competent_with_conditions", "provisionally_competent"]);

export default async function AllUsersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const [
    { data: rawProfiles },
    { data: hospitals },
    { data: organisations },
    { data: rawDepts },
    { data: decisions },
    { data: authz },
    { data: audit },
    authList,
  ] = await Promise.all([
    admin.from("profiles")
      .select("id, full_name, email, phone, role, roles, org_role, org_roles, hospital_id, organisation_id, platform_role, department_id, specialization, created_at")
      .order("created_at", { ascending: false })
      .returns<ProfileRow[]>(),
    admin.from("hospitals").select("id, name, country"),
    admin.from("organisations").select("id, name"),
    admin.from("departments").select("id, name, hospital_id"),
    admin.from("competency_decisions")
      .select("nurse_id, competency_id, cpu_id, outcome, expiry_date, created_at")
      .order("created_at", { ascending: false }),
    admin.from("clinical_authorizations").select("nurse_id, status"),
    admin.from("audit_log")
      .select("id, actor_id, actor_name, action, entity_type, entity_name, created_at")
      .order("created_at", { ascending: false }).limit(200),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  const authById = new Map(
    (authList.data?.users ?? []).map(u => [u.id, {
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
  for (const d of decisions ?? []) {
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
  for (const a of authz ?? []) {
    if (a.status === "active") authzByUser.set(a.nurse_id, (authzByUser.get(a.nurse_id) ?? 0) + 1);
  }

  const hospitalMap = Object.fromEntries((hospitals ?? []).map(h => [h.id, h.name as string]));
  const orgMap = Object.fromEntries((organisations ?? []).map(o => [o.id, o.name as string]));
  const deptMap = Object.fromEntries((rawDepts ?? []).map(d => [d.id, d.name as string]));

  const users: UserRow[] = (rawProfiles ?? []).map(p => {
    const a = authById.get(p.id);
    const m = perUser.get(p.id);
    const suspended = !!a?.bannedUntil && new Date(a.bannedUntil) > new Date();
    const status: UserRow["status"] =
      suspended ? "suspended"
      : !a?.lastSignIn && a?.invitedAt ? "pending"
      : a && !a.emailConfirmed ? "pending"
      : "active";
    return {
      id: p.id, name: p.full_name ?? "—", email: p.email, phone: p.phone ?? null,
      role: p.role, roles: p.roles ?? [p.role],
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
    };
  });

  const auditByActor = new Map<string, AuditEntry[]>();
  for (const e of audit ?? []) {
    if (!e.actor_id) continue;
    const list = auditByActor.get(e.actor_id) ?? [];
    if (list.length < 15) list.push({
      id: e.id, action: e.action, entityType: e.entity_type ?? null,
      entityName: e.entity_name ?? null, at: e.created_at,
    });
    auditByActor.set(e.actor_id, list);
  }

  return (
    <UsersWorkspace
      users={users}
      auditByActor={Object.fromEntries(auditByActor)}
      hospitals={(hospitals ?? []).map(h => ({ id: h.id as string, name: h.name as string, country: (h as Record<string, string>).country ?? "" }))}
      organisations={(organisations ?? []).map(o => ({ id: o.id as string, name: o.name as string }))}
      departments={(rawDepts ?? []).map(d => ({ id: d.id as string, name: d.name as string, hospital_id: (d as Record<string, string>).hospital_id ?? "" }))}
      currentUserId={user.id}
    />
  );
}
