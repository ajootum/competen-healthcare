// Identity & Access Management (SYS-001.2) loader — the live identity
// directory. Merges the Supabase Auth admin directory (REAL last_sign_in_at,
// banned_until, created_at — auth is the source of truth, nothing stored
// locally) with profiles (portal roles, account_status, tenant scope) and the
// per-tenant IdP/SSO configs. MFA enforcement, session inventory and risky
// sign-in scoring have no store → honest states (SYS-002 AC-02). Fail-soft.
/* eslint-disable @typescript-eslint/no-explicit-any */

const DAY = 86400000;

export async function loadIam(admin: any) {
  const [profRows, idpRows, tenantRows] = await Promise.all([
    admin.from("profiles").select("id, full_name, email, role, roles, account_status, hospital_id, organisation_id, created_at").limit(20000),
    admin.from("plat_idp_configs").select("tenant_id, protocol, provider, mfa_required, scim_enabled, is_active, updated_at").limit(500),
    admin.from("tenants").select("id, name").limit(2000),
  ]);

  // ── Live auth directory ─────────────────────────────────────────────────────
  let authUsers: any[] = [];
  let authReady = false;
  try {
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (!error && data?.users) { authUsers = data.users; authReady = true; }
  } catch { /* honest nulls below */ }

  const now = Date.now();
  const profiles = (profRows.error ? [] : profRows.data ?? []) as any[];
  const profById = new Map(profiles.map(p => [p.id, p]));
  const isBanned = (u: any) => !!(u.banned_until && new Date(u.banned_until).getTime() > now);

  const directory = authUsers.map(u => {
    const p = profById.get(u.id);
    return {
      id: u.id,
      name: p?.full_name ?? (u.user_metadata?.full_name as string | undefined) ?? null,
      email: u.email ?? p?.email ?? null,
      role: p?.role ?? null,
      roles: (p?.roles?.length ? p.roles : [p?.role]).filter(Boolean),
      accountStatus: p?.account_status ?? "active",
      banned: isBanned(u),
      lastSignIn: u.last_sign_in_at ?? null,
      createdAt: u.created_at ?? p?.created_at ?? null,
      neverSignedIn: !u.last_sign_in_at,
    };
  });

  const active24h = authReady ? directory.filter(d => d.lastSignIn && now - new Date(d.lastSignIn).getTime() <= DAY).length : null;
  const active7d = authReady ? directory.filter(d => d.lastSignIn && now - new Date(d.lastSignIn).getTime() <= 7 * DAY).length : null;
  const suspended = authReady ? directory.filter(d => d.banned).length : null;
  const pendingInvites = authReady ? directory.filter(d => d.neverSignedIn && !d.banned).length : null;

  // Portal-role composition (from profiles — includes multi-role users).
  const roleCounts: Record<string, number> = {};
  for (const p of profiles) for (const r of ((p.roles?.length ? p.roles : [p.role]) as string[]).filter(Boolean)) roleCounts[r] = (roleCounts[r] ?? 0) + 1;
  const statusCounts: Record<string, number> = {};
  for (const p of profiles) { const s = p.account_status ?? "active"; statusCounts[s] = (statusCounts[s] ?? 0) + 1; }

  const recentLogins = directory
    .filter(d => d.lastSignIn)
    .sort((a, b) => new Date(b.lastSignIn!).getTime() - new Date(a.lastSignIn!).getTime())
    .slice(0, 8);

  const recentUsers = directory
    .slice().sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
    .slice(0, 8);

  // ── SSO / IdP configs (per-tenant CONFIG records — enforcement pending) ─────
  const tenantName = new Map((tenantRows.error ? [] : tenantRows.data ?? []).map((t: any) => [t.id, t.name]));
  const idp = (idpRows.error ? [] : idpRows.data ?? []).map((c: any) => ({
    tenant: tenantName.get(c.tenant_id) ?? "—", protocol: c.protocol, provider: c.provider,
    mfaRequired: c.mfa_required, scim: c.scim_enabled, active: c.is_active,
  }));

  return {
    authReady,
    kpis: {
      total: authReady ? directory.length : null,
      active24h, active7d,
      pendingInvites, suspended,
      ssoActive: idpRows.error ? null : idp.filter((c: any) => c.active).length,
    },
    roleCounts, statusCounts,
    recentLogins, recentUsers,
    idp,
    idpTotal: idpRows.error ? null : idp.length,
    pickers: {
      users: directory
        .slice().sort((a, b) => String(a.email ?? "").localeCompare(String(b.email ?? "")))
        .slice(0, 500)
        .map(d => ({ id: d.id, label: `${d.name ?? d.email ?? d.id}${d.email && d.name ? ` (${d.email})` : ""}${d.banned ? " · suspended" : d.neverSignedIn ? " · invited" : ""}` })),
    },
    generatedAt: new Date().toISOString(),
  };
}
