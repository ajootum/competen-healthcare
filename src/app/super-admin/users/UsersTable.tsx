"use client";
import { useState } from "react";
import { ROLE_CONFIG, ORG_ROLE_CONFIG, PLATFORM_ROLE_CONFIG, type AppRole, type OrgRole, type PlatformRole } from "@/lib/roles";
import UserRoleEditor from "./UserRoleEditor";

type Profile = {
  id: string;
  full_name: string;
  email: string;
  role: string;
  roles: string[] | null;
  org_role: string | null;
  org_roles: string[] | null;
  hospital_id: string | null;
  organisation_id: string | null;
  platform_role: string | null;
  department_id: string | null;
  specialization: string | null;
  created_at: string;
};

const ROLE_BADGE: Record<string, string> = {
  nurse:          "bg-teal-100 text-teal-700",
  assessor:       "bg-indigo-100 text-indigo-700",
  educator:       "bg-purple-100 text-purple-700",
  hospital_admin: "bg-amber-100 text-amber-700",
  super_admin:    "bg-rose-100 text-rose-700",
};

export default function UsersTable({
  profiles: initial, hospitalMap, orgMap, hospitals, organisations, departments,
}: {
  profiles: Profile[];
  hospitalMap: Record<string, string>;
  orgMap: Record<string, string>;
  hospitals: { id: string; name: string; country: string }[];
  organisations: { id: string; name: string }[];
  departments: { id: string; name: string; hospital_id: string }[];
}) {
  const [profiles, setProfiles] = useState<Profile[]>(initial);
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState<string>("all");

  const filtered = profiles.filter(p => {
    const q = search.toLowerCase();
    const matchSearch = !q || p.full_name?.toLowerCase().includes(q) || p.email?.toLowerCase().includes(q);
    const matchRole = filterRole === "all" || p.role === filterRole;
    return matchSearch && matchRole;
  });

  const roleCounts = profiles.reduce((acc, p) => {
    acc[p.role] = (acc[p.role] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  function handleSaved(userId: string, role: AppRole, orgRoles: OrgRole[], extraPortalRoles: AppRole[], hospitalId: string | null, organisationId: string | null, platformRole: string | null, departmentId: string | null) {
    setProfiles(prev => prev.map(p =>
      p.id === userId
        ? {
            ...p,
            role,
            roles: [...new Set([...orgRoles.map(r => ORG_ROLE_CONFIG[r].portalRole), ...extraPortalRoles])],
            org_roles: orgRoles,
            org_role: orgRoles[0] ?? null,
            hospital_id: hospitalId,
            organisation_id: organisationId,
            platform_role: platformRole,
            department_id: departmentId,
          }
        : p
    ));
  }

  return (
    <div className="max-w-6xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">All Users</h1>
        <p className="text-gray-400 text-sm mt-0.5">{profiles.length} users registered on the platform</p>
      </div>

      {/* Role filter tabs */}
      <div className="flex flex-wrap gap-2 mb-5">
        <button onClick={() => setFilterRole("all")}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${filterRole === "all" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
          All ({profiles.length})
        </button>
        {Object.entries(ROLE_CONFIG).map(([role, cfg]) => (
          <button key={role} onClick={() => setFilterRole(role === filterRole ? "all" : role)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${filterRole === role ? "bg-gray-900 text-white" : `${ROLE_BADGE[role]} hover:opacity-80`}`}>
            {cfg.icon} {cfg.label} ({roleCounts[role] ?? 0})
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="mb-4">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or email…"
          className="w-full max-w-sm text-sm border border-gray-200 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
      </div>

      {!filtered.length ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <p className="text-3xl mb-3">👥</p>
          <p className="text-gray-500 text-sm">No users found.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-5 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">User</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Org Roles</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Portals</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Organisation</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Facility</th>
                <th className="text-right px-5 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(p => {
                // Use org_roles[] if available, fall back to singular org_role
                const activeOrgRoles: OrgRole[] = (
                  p.org_roles?.length
                    ? p.org_roles
                    : p.org_role ? [p.org_role] : []
                ).filter(r => ORG_ROLE_CONFIG[r as OrgRole]) as OrgRole[];

                const activePortals = [...new Set(activeOrgRoles.map(r => ORG_ROLE_CONFIG[r].portalRole))];
                const portalCfg = ROLE_CONFIG[p.role as AppRole];

                return (
                  <tr key={p.id} className="hover:bg-gray-50/40">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 text-xs font-bold shrink-0">
                          {p.full_name?.[0] ?? "?"}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{p.full_name}</p>
                          <p className="text-[10px] text-gray-400">{p.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      {p.role === "super_admin" ? (
                        <div>
                          {p.platform_role && PLATFORM_ROLE_CONFIG[p.platform_role as PlatformRole] ? (
                            <div className="flex items-center gap-1">
                              <span className="text-sm">{PLATFORM_ROLE_CONFIG[p.platform_role as PlatformRole].icon}</span>
                              <span className="text-xs font-semibold text-violet-700">{PLATFORM_ROLE_CONFIG[p.platform_role as PlatformRole].label}</span>
                            </div>
                          ) : (
                            <span className="text-xs text-violet-600 font-semibold">🛡️ Competen Staff</span>
                          )}
                        </div>
                      ) : activeOrgRoles.length > 0 ? (
                        <div className="flex flex-col gap-1">
                          {activeOrgRoles.map(r => {
                            const cfg = ORG_ROLE_CONFIG[r];
                            return (
                              <div key={r} className="flex items-center gap-1">
                                <span className="text-xs">{cfg.icon}</span>
                                <span className="text-[11px] font-medium text-gray-700">{cfg.label}</span>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <span className="text-[10px] text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      {activePortals.length > 0 ? (
                        <div className="flex flex-col gap-1">
                          {activePortals.map(portal => (
                            <span key={portal} className={`text-[10px] font-bold px-2 py-0.5 rounded w-fit ${ROLE_BADGE[portal] ?? "bg-gray-100 text-gray-600"}`}>
                              {ROLE_CONFIG[portal]?.icon} {ROLE_CONFIG[portal]?.label ?? portal}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${ROLE_BADGE[p.role] ?? "bg-gray-100 text-gray-600"}`}>
                          {portalCfg?.icon} {portalCfg?.label ?? p.role}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-xs text-gray-500">
                      {p.organisation_id ? (orgMap[p.organisation_id] ?? "Linked") : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3.5 text-xs text-gray-500">
                      {p.hospital_id ? (hospitalMap[p.hospital_id] ?? "Linked") : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <UserRoleEditor
                        user={p}
                        hospitals={hospitals}
                        organisations={organisations}
                        departments={departments}
                        onSaved={(role, orgRoles, extraPortalRoles, hospitalId, organisationId, platformRole, departmentId) =>
                          handleSaved(p.id, role, orgRoles, extraPortalRoles, hospitalId, organisationId, platformRole, departmentId)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
