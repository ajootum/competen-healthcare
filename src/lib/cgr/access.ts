/* eslint-disable @typescript-eslint/no-explicit-any */
// CGR-014 — Competency Governance Security, Privacy & Access Control.
// "Who can access governance information, what can they do, and how is it controlled?" The genuinely-new, real
// computation is the SEPARATION-OF-DUTIES check (§6: "creators cannot approve their own submissions"), which no
// surface performs today. Over real stores:
//   • content_responsibilities (mig 023) — the governance RBAC: who holds which responsibility_type
//     (author / reviewer / owner / governance_approver / publisher) on which content object + review_due.
//   • assessor_authorizations (mig 023) — the Assessor role: independence level (independent/supervised/
//     countersigned) + status + validity.
// From them: the governance access map (§5 RBAC), SoD violations (same user is author AND approver of the same
// object), assessor independence posture, and permission-review due-list (§13). Identity/RLS/encryption are the
// platform's (§8/§11) — noted as posture and cross-linked to System. No migration.

type Admin = any;
const AUTHOR_ROLES = new Set(["primary_author", "contributing_author"]);
const APPROVAL_ROLES = new Set(["governance_approver", "publisher"]);
const roleLabel = (t: string) => (t || "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const todayISO = () => new Date().toISOString().slice(0, 10);
const horizonISO = (days: number) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);

export async function loadGovernanceAccess(admin: Admin) {
  const [respRes, authRes] = await Promise.all([
    admin.from("content_responsibilities").select("user_id, content_type, content_id, content_name, responsibility_type, review_due").eq("status", "active").limit(6000),
    admin.from("assessor_authorizations").select("user_id, independence, status, valid_until").limit(4000),
  ]);

  const resp = (respRes.error ? [] : respRes.data ?? []) as any[];
  const auth = (authRes.error ? [] : authRes.data ?? []) as any[];

  const nameById = new Map<string, string>();
  const userIds = [...new Set(resp.map((r) => r.user_id).filter(Boolean))];
  if (userIds.length) {
    const { data: profs } = await admin.from("profiles").select("id, full_name").in("id", userIds);
    for (const p of profs ?? []) nameById.set(p.id, p.full_name ?? "—");
  }

  // Governance RBAC distribution.
  const byRole = new Map<string, number>();
  const holders = new Set<string>();
  for (const r of resp) {
    byRole.set(r.responsibility_type, (byRole.get(r.responsibility_type) ?? 0) + 1);
    holders.add(r.user_id);
  }
  const roles = [...byRole.entries()].map(([role, count]) => ({ role, label: roleLabel(role), count, isApproval: APPROVAL_ROLES.has(role), isAuthor: AUTHOR_ROLES.has(role) })).sort((a, b) => b.count - a.count);

  // Separation-of-duties: same user holds an author AND an approval role on the same object.
  const byObject = new Map<string, { name: string; type: string; users: Map<string, Set<string>> }>();
  for (const r of resp) {
    const key = `${r.content_type}|${r.content_id}`;
    let obj = byObject.get(key);
    if (!obj) { obj = { name: r.content_name ?? r.content_type, type: r.content_type, users: new Map() }; byObject.set(key, obj); }
    let rs = obj.users.get(r.user_id);
    if (!rs) { rs = new Set(); obj.users.set(r.user_id, rs); }
    rs.add(r.responsibility_type);
  }
  const violations: any[] = [];
  for (const obj of byObject.values()) {
    for (const [uid, rs] of obj.users) {
      const roleArr = [...rs];
      const hasAuthor = roleArr.some((x) => AUTHOR_ROLES.has(x));
      const hasApproval = roleArr.some((x) => APPROVAL_ROLES.has(x));
      if (hasAuthor && hasApproval) {
        violations.push({ content: obj.name, type: obj.type, user: nameById.get(uid) ?? "—", roles: roleArr.filter((x) => AUTHOR_ROLES.has(x) || APPROVAL_ROLES.has(x)).map(roleLabel) });
      }
    }
  }

  // Assessor authorization posture.
  const byIndep: Record<string, number> = { independent: 0, supervised: 0, countersigned: 0 };
  const byAuthStatus: Record<string, number> = { active: 0, suspended: 0, expired: 0, revoked: 0 };
  const soon = horizonISO(30);
  let expiringAuth = 0;
  for (const a of auth) {
    if (a.independence in byIndep) byIndep[a.independence]++;
    if (a.status in byAuthStatus) byAuthStatus[a.status]++;
    if (a.status === "active" && a.valid_until && a.valid_until <= soon) expiringAuth++;
  }

  const today = todayISO();
  const dueReview = resp.filter((r) => r.review_due && r.review_due < today).length;

  return {
    provisioned: resp.length > 0 || auth.length > 0,
    kpis: {
      holders: holders.size,
      governanceRoles: resp.length,
      approvers: resp.filter((r) => r.responsibility_type === "governance_approver").length,
      publishers: resp.filter((r) => r.responsibility_type === "publisher").length,
      sodViolations: violations.length,
      independentAssessors: byIndep.independent,
      dueReview,
    },
    roles,
    violations: violations.slice(0, 14),
    assessor: { total: auth.length, byIndep, byStatus: byAuthStatus, expiring: expiringAuth },
  };
}
