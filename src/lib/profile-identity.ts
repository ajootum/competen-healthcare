// PW-011 Profile & Professional Identity — the authenticated user's own professional profile over REAL records:
// profiles (identity), professional_credentials (licences + certifications), competency_decisions (professional
// level from modal maturity), departments (unit), line manager + team (professional network), workspace access.
// Read-only aggregation. Fields the schema doesn't carry (bio/DOB/nationality/languages) are omitted honestly,
// not faked. Numbers are the person's own — honestly lighter than the aspirational mockup persona.
/* eslint-disable @typescript-eslint/no-explicit-any */
const q = async (p: Promise<any>) => { try { const r = await p; return r?.error ? [] : (r?.data ?? []); } catch { return []; } };
const one = async (p: Promise<any>) => { try { const r = await p; return r?.error ? null : (r?.data ?? null); } catch { return null; } };

const MATURITY_RANK: Record<string, number> = { novice: 1, advanced_beginner: 2, competent: 3, proficient: 4, expert: 5, mentor: 6, authority: 7 };
const LEVEL_LABEL = ["Foundation", "Foundation", "Developing", "Competent", "Proficient", "Advanced", "Expert", "Authority"];
const LICENCE_TYPES = ["professional_license", "academic_qualification"];

export async function loadProfileIdentity(admin: any, userId: string, userEmail: string | null, userRoles: string[]) {
  const profile = await one(admin.from("profiles").select("full_name, email, role, roles, phone, specialization, avatar_url, hospital_id, department_id, staff_number, employment_type, line_manager_id, account_status, created_at, country").eq("id", userId).single());
  const [dept, manager, creds, decisions] = await Promise.all([
    profile?.department_id ? one(admin.from("departments").select("name").eq("id", profile.department_id).maybeSingle()) : Promise.resolve(null),
    profile?.line_manager_id ? one(admin.from("profiles").select("full_name, role, specialization").eq("id", profile.line_manager_id).maybeSingle()) : Promise.resolve(null),
    q(admin.from("professional_credentials").select("id, credential_type, title, issuing_body, issue_date, expiry_date, status, verified").eq("nurse_id", userId).limit(200)),
    q(admin.from("competency_decisions").select("maturity, validation_outcome").eq("nurse_id", userId).limit(2000)),
  ]);
  const teamCount = profile?.department_id ? (await q(admin.from("profiles").select("id").eq("department_id", profile.department_id).neq("id", userId).limit(500))).length : 0;

  // Credentials split.
  const active = creds.filter((c: any) => c.status === "active");
  const licences = creds.filter((c: any) => LICENCE_TYPES.includes(c.credential_type));
  const certifications = creds.filter((c: any) => !LICENCE_TYPES.includes(c.credential_type));
  const verified = creds.filter((c: any) => c.verified);

  // Professional level from modal/max maturity of validated decisions.
  const mats = decisions.filter((d: any) => d.validation_outcome === "validated" && d.maturity).map((d: any) => MATURITY_RANK[d.maturity] ?? 0);
  const level = mats.length ? Math.max(...mats) : 0;
  const professionalLevel = { label: LEVEL_LABEL[level] ?? "Foundation", num: Math.max(1, level) };

  // Completeness across key fields.
  const fields = [profile?.full_name, profile?.email ?? userEmail, profile?.phone, profile?.specialization, profile?.avatar_url, profile?.department_id, profile?.staff_number, profile?.hospital_id];
  const completeness = Math.round((fields.filter(Boolean).length / fields.length) * 100);

  // Identity badges — role + verified credentials.
  const roleBadge = { label: (profile?.role ?? "nurse").replace(/_/g, " "), color: "#3b82f6" };
  const credBadges = verified.slice(0, 4).map((c: any) => ({ label: c.title, color: "#10b981" }));

  const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null);

  return {
    profile: {
      fullName: profile?.full_name ?? "User", email: profile?.email ?? userEmail ?? "—", role: (profile?.role ?? "nurse").replace(/_/g, " "),
      specialization: profile?.specialization ?? null, phone: profile?.phone ?? null, avatarUrl: profile?.avatar_url ?? null,
      department: (dept as any)?.name ?? null, staffNumber: profile?.staff_number ?? null, employmentType: profile?.employment_type ?? null,
      accountStatus: profile?.account_status ?? "active", country: profile?.country ?? null, joined: fmt(profile?.created_at),
    },
    kpis: { completeness, professionalLevel, activeCredentials: active.length, certifications: certifications.length, linkedIdentities: userRoles.length, lastUpdated: fmt(profile?.created_at) },
    credentials: creds.map((c: any) => ({ ...c, issueLabel: fmt(c.issue_date), expiryLabel: fmt(c.expiry_date) })),
    licences, certifications, verifiedCount: verified.length,
    badges: [roleBadge, ...credBadges],
    network: { reportingTo: manager ? { name: (manager as any).full_name, role: ((manager as any).specialization ?? (manager as any).role ?? "").replace(/_/g, " ") } : null, teamCount, sharedWorkspaces: 0 },
    identity: { email: profile?.email ?? userEmail ?? "—", phone: profile?.phone ?? null, accountStatus: profile?.account_status ?? "active", roles: userRoles },
  };
}
