"use client";
import { useState } from "react";
import { ROLE_CONFIG, ORG_ROLE_CONFIG, PLATFORM_ROLE_CONFIG, type AppRole, type OrgRole, type PlatformRole } from "@/lib/roles";

const ORG_ROLE_GROUPS: { label: string; portalRole: AppRole; roles: OrgRole[] }[] = [
  { label: "Organisation Leadership",  portalRole: "hospital_admin", roles: ["chief_officer", "org_admin", "governance_committee", "manager", "competency_coordinator"] },
  { label: "Functional Departments",   portalRole: "hospital_admin", roles: ["quality_manager", "hr_manager", "it_admin"] },
  { label: "Clinical Education",       portalRole: "educator",       roles: ["educator"] },
  { label: "Clinical Oversight",       portalRole: "assessor",       roles: ["charge_nurse", "shift_supervisor", "leader"] },
  { label: "Healthcare Worker",        portalRole: "nurse",          roles: ["healthcare_worker"] },
];

function validOrgRoles(raw: string[] | null | undefined): OrgRole[] {
  return (raw ?? []).filter(r => ORG_ROLE_CONFIG[r as OrgRole]) as OrgRole[];
}

function primaryOrgRole(orgRoles: OrgRole[]): OrgRole | null {
  if (!orgRoles.length) return null;
  return [...orgRoles].sort((a, b) => ORG_ROLE_CONFIG[a].tier - ORG_ROLE_CONFIG[b].tier)[0];
}

function derivedPortals(orgRoles: OrgRole[], extras: AppRole[]): AppRole[] {
  return [...new Set([...orgRoles.map(r => ORG_ROLE_CONFIG[r].portalRole), ...extras])];
}

type User = {
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
};

export default function UserRoleEditor({
  user, hospitals, organisations, departments, onSaved,
}: {
  user: User;
  hospitals: { id: string; name: string; country: string }[];
  organisations: { id: string; name: string }[];
  departments: { id: string; name: string; hospital_id: string }[];
  onSaved: (role: AppRole, orgRoles: OrgRole[], extraPortalRoles: AppRole[], hospitalId: string | null, organisationId: string | null, platformRole: string | null, departmentId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(user.role === "super_admin");
  const [platformRole, setPlatformRole] = useState<string>(user.platform_role ?? "platform_super_admin");

  const seedRoles = user.org_roles?.length
    ? validOrgRoles(user.org_roles)
    : validOrgRoles(user.org_role ? [user.org_role] : []);
  const [orgRoles, setOrgRoles] = useState<OrgRole[]>(seedRoles);

  // Direct assessor: true when roles[] has "assessor" but no assessor-tier org role
  const orgRolesGiveAssessor = (roles: OrgRole[]) =>
    roles.some(r => ORG_ROLE_CONFIG[r].portalRole === "assessor");
  const [directAssessor, setDirectAssessor] = useState(
    !!(user.roles?.includes("assessor") && !orgRolesGiveAssessor(seedRoles))
  );

  const [hospitalId, setHospitalId] = useState<string>(user.hospital_id ?? "");
  const [organisationId, setOrganisationId] = useState<string>(user.organisation_id ?? "");
  const [departmentId, setDepartmentId] = useState<string>(user.department_id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const extraPortals: AppRole[] = (directAssessor && !orgRolesGiveAssessor(orgRoles)) ? ["assessor"] : [];
  const primary = primaryOrgRole(orgRoles);
  const portals = derivedPortals(orgRoles, extraPortals);
  const primaryPortal: AppRole = isSuperAdmin
    ? "super_admin"
    : (primary ? ORG_ROLE_CONFIG[primary].portalRole : (extraPortals[0] ?? "nurse"));

  function toggleRole(role: OrgRole) {
    setOrgRoles(prev => prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]);
  }

  const depsForHospital = departments.filter(d => d.hospital_id === hospitalId);

  async function save() {
    if (!isSuperAdmin && orgRoles.length === 0 && !directAssessor) {
      setError("Select at least one organisation role"); return;
    }
    setSaving(true); setError("");
    const res = await fetch("/api/super-admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: user.id,
        isSuperAdmin,
        platform_role: isSuperAdmin ? platformRole : null,
        org_roles: isSuperAdmin ? [] : orgRoles,
        extra_portal_roles: isSuperAdmin ? [] : extraPortals,
        hospital_id: hospitalId || null,
        organisation_id: organisationId || null,
        department_id: departmentId || null,
      }),
    });
    setSaving(false);
    if (res.ok) {
      setOpen(false);
      onSaved(primaryPortal, isSuperAdmin ? [] : orgRoles, isSuperAdmin ? [] : extraPortals, hospitalId || null, organisationId || null, isSuperAdmin ? platformRole : null, departmentId || null);
    } else {
      const d = await res.json();
      setError(d.error ?? "Failed to save");
    }
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-colors font-medium">
        Edit
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="px-6 pt-6 pb-4 border-b border-gray-100 sticky top-0 bg-white z-10">
              <h2 className="font-bold text-gray-900">Edit User</h2>
              <p className="text-sm text-gray-400 mt-0.5">{user.full_name} · {user.email}</p>
            </div>

            <div className="px-6 py-5 flex flex-col gap-5">
              {/* Competen super admin toggle */}
              <div className={`rounded-xl border-2 transition-all ${isSuperAdmin ? "border-violet-500 bg-violet-50" : "border-gray-100 hover:border-gray-200"}`}>
                <div
                  className="flex items-center justify-between p-4 cursor-pointer"
                  onClick={() => { setIsSuperAdmin(!isSuperAdmin); setOrgRoles([]); setDirectAssessor(false); }}>
                  <div className="flex items-center gap-3">
                    <span className="text-xl">🛡️</span>
                    <div>
                      <p className="text-sm font-semibold text-gray-800">Competen Staff</p>
                      <p className="text-xs text-gray-400">Platform-level access — no org restriction</p>
                    </div>
                  </div>
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${isSuperAdmin ? "bg-violet-500 border-violet-500" : "border-gray-300"}`}>
                    {isSuperAdmin && <span className="text-white text-[10px] font-bold">✓</span>}
                  </div>
                </div>

                {isSuperAdmin && (
                  <div className="px-4 pb-4 border-t border-violet-100 pt-3">
                    <label className="text-[10px] font-bold text-violet-500 uppercase tracking-widest mb-2 block">Platform Role</label>
                    <div className="flex flex-col gap-1.5">
                      {(Object.entries(PLATFORM_ROLE_CONFIG) as [PlatformRole, typeof PLATFORM_ROLE_CONFIG[PlatformRole]][]).map(([key, cfg]) => (
                        <button key={key} type="button" onClick={() => setPlatformRole(key)}
                          className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all ${
                            platformRole === key ? "border-violet-400 bg-violet-100" : "border-gray-100 hover:border-gray-200 bg-white"
                          }`}>
                          <span className="text-base">{cfg.icon}</span>
                          <div className="flex-1">
                            <p className={`text-xs font-semibold ${platformRole === key ? "text-violet-800" : "text-gray-700"}`}>{cfg.label}</p>
                            <p className="text-[10px] text-gray-400">{cfg.description}</p>
                          </div>
                          <div className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 ${platformRole === key ? "bg-violet-500 border-violet-500" : "border-gray-300"}`} />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {!isSuperAdmin && (
                <>
                  {/* Tenant assignment */}
                  <div className="flex flex-col gap-3">
                    <div>
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1.5 block">Organisation (Tenant)</label>
                      <select value={organisationId} onChange={e => setOrganisationId(e.target.value)}
                        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white">
                        <option value="">— Not assigned to an organisation —</option>
                        {organisations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1.5 block">Facility</label>
                      <select value={hospitalId} onChange={e => { setHospitalId(e.target.value); setDepartmentId(""); }}
                        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white">
                        <option value="">— Not assigned to a facility —</option>
                        {hospitals.map(h => <option key={h.id} value={h.id}>{h.name} ({h.country})</option>)}
                      </select>
                    </div>
                    {hospitalId && depsForHospital.length > 0 && (
                      <div>
                        <label className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1.5 block">Department</label>
                        <select value={departmentId} onChange={e => setDepartmentId(e.target.value)}
                          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white">
                          <option value="">— Not assigned to a department —</option>
                          {depsForHospital.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                      </div>
                    )}
                  </div>

                  {/* Org role picker */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Organisation Roles</label>
                      {orgRoles.length > 0 && (
                        <button type="button" onClick={() => setOrgRoles([])}
                          className="text-[10px] text-gray-400 hover:text-red-500 transition-colors">
                          Clear all
                        </button>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-400 mb-3">Select one or more roles — the user can switch between the portals they're assigned to.</p>
                    <div className="flex flex-col gap-4">
                      {ORG_ROLE_GROUPS.map(group => {
                        const gc = ROLE_CONFIG[group.portalRole];
                        return (
                          <div key={group.label}>
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-1 mb-1.5">
                              {group.label}
                              <span className="ml-1.5 normal-case font-semibold text-gray-500">→ {gc.icon} {gc.label} portal</span>
                            </p>
                            <div className="flex flex-col gap-1.5">
                              {group.roles.map(role => {
                                const cfg = ORG_ROLE_CONFIG[role];
                                const active = orgRoles.includes(role);
                                return (
                                  <button key={role} type="button" onClick={() => toggleRole(role)}
                                    className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border-2 text-left transition-all ${
                                      active ? "border-teal-500 bg-teal-50" : "border-gray-100 hover:border-gray-200 bg-white"
                                    }`}>
                                    <span className="text-lg">{cfg.icon}</span>
                                    <div className="flex-1">
                                      <p className={`text-sm font-semibold ${active ? "text-teal-800" : "text-gray-700"}`}>{cfg.label}</p>
                                      <p className="text-[10px] text-gray-400">{cfg.description}</p>
                                    </div>
                                    <div className={`w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center ${active ? "bg-teal-500 border-teal-500" : "border-gray-300"}`}>
                                      {active && <span className="text-white text-[9px] font-bold leading-none">✓</span>}
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Direct assessor grant — shown only when org roles don't already give assessor */}
                  {!orgRolesGiveAssessor(orgRoles) && (
                    <div>
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 block">Additional Access</label>
                      <button type="button" onClick={() => setDirectAssessor(v => !v)}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 text-left transition-all ${
                          directAssessor ? "border-indigo-500 bg-indigo-50" : "border-gray-100 hover:border-gray-200 bg-white"
                        }`}>
                        <span className="text-lg">📋</span>
                        <div className="flex-1">
                          <p className={`text-sm font-semibold ${directAssessor ? "text-indigo-800" : "text-gray-700"}`}>
                            Assessor Portal Access
                          </p>
                          <p className="text-[10px] text-gray-400">
                            Grant assessor portal access regardless of org role — for senior staff who conduct peer assessments
                          </p>
                        </div>
                        <div className={`w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center ${directAssessor ? "bg-indigo-500 border-indigo-500" : "border-gray-300"}`}>
                          {directAssessor && <span className="text-white text-[9px] font-bold leading-none">✓</span>}
                        </div>
                      </button>
                    </div>
                  )}
                </>
              )}

              {/* Portal access summary */}
              {!isSuperAdmin && (
                <div className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-3">
                  <p className="text-xs font-semibold text-gray-500 mb-2">Portal access granted</p>
                  {portals.length === 0 ? (
                    <p className="text-xs text-gray-400">No roles selected</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {portals.map(p => {
                        const pc = ROLE_CONFIG[p];
                        return (
                          <span key={p} className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-lg px-2.5 py-1 text-xs font-medium text-gray-700">
                            {pc.icon} {pc.label}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {portals.length > 1 && (
                    <p className="text-[10px] text-gray-400 mt-2">Primary portal (highest role): {ROLE_CONFIG[primaryPortal]?.label}</p>
                  )}
                </div>
              )}

              {isSuperAdmin && (
                <div className="bg-violet-50 border border-violet-100 rounded-xl px-4 py-3 flex items-center gap-3">
                  <span className="text-lg">{ROLE_CONFIG["super_admin"].icon}</span>
                  <p className="text-xs font-semibold text-violet-700">Full platform access — {ROLE_CONFIG["super_admin"].label}</p>
                </div>
              )}

              {error && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
            </div>

            <div className="px-6 pb-6 flex gap-3 sticky bottom-0 bg-white pt-2 border-t border-gray-50">
              <button onClick={() => setOpen(false)}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 font-medium">
                Cancel
              </button>
              <button onClick={save} disabled={saving}
                className="flex-1 py-2.5 rounded-xl bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 disabled:opacity-50">
                {saving ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
