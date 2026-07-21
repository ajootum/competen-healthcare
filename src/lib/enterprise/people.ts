// People, Positions & Roles module (ENT-001 §5) loaders. Separates Person
// (profiles) / Position (positions) / Role (profiles.roles[]) / Workspace access
// (derived from roles). Live data; select("*") is drift-proof.
/* eslint-disable @typescript-eslint/no-explicit-any */

// Roles assignable from this module (super_admin deliberately excluded — no
// privilege escalation through the people UI).
export const ASSIGNABLE_ROLES = ["nurse", "assessor", "educator", "senior_educator", "clinical_educator", "hospital_admin", "quality_reviewer", "program_director"];
export const ACCOUNT_STATUSES = ["active", "invited", "suspended", "deactivated", "left"] as const;
export const EMPLOYMENT_TYPES = ["permanent", "contract", "locum", "intern", "volunteer"];

const WORKSPACE: Record<string, string> = {
  nurse: "Healthcare Worker", assessor: "Assessor", educator: "Educator", senior_educator: "Educator",
  clinical_educator: "Educator", curriculum_lead: "Educator", assessment_lead: "Assessor",
  hospital_admin: "Organisation Admin", quality_reviewer: "Quality & Safety", program_director: "Executive",
  education_administrator: "Education Admin", super_admin: "Platform Control",
};
export const rolesOf = (p: any): string[] => (p.roles?.length ? p.roles : [p.role]).filter(Boolean);
export const workspacesFor = (roles: string[]): string[] => [...new Set(roles.map(r => WORKSPACE[r]).filter(Boolean))];

export async function loadPeopleDirectory(admin: any) {
  const [profRes, posRes, orgRes, hospRes] = await Promise.all([
    admin.from("profiles").select("*").order("full_name").limit(50000),
    admin.from("positions").select("id, title, code, department_id, hospital_id, status, grade, profession, can_supervise").limit(8000),
    admin.from("organisations").select("id, name").limit(2000),
    admin.from("hospitals").select("id, name").limit(4000),
  ]);
  const profiles = (profRes.data ?? []) as any[];
  const positions = (posRes.data ?? []) as any[];
  const posName = new Map<string, string>(positions.map(p => [p.id, p.title]));
  const orgName = new Map<string, string>(((orgRes.data ?? []) as any[]).map(o => [o.id, o.name]));
  const hospName = new Map<string, string>(((hospRes.data ?? []) as any[]).map(h => [h.id, h.name]));

  const peopleByPos = new Map<string, number>();
  for (const p of profiles) if (p.position_id) peopleByPos.set(p.position_id, (peopleByPos.get(p.position_id) ?? 0) + 1);

  const rows = profiles.map(p => {
    const roles = rolesOf(p);
    return {
      id: p.id, name: p.full_name, email: p.email, staffNumber: p.staff_number ?? null,
      position: p.position_id ? posName.get(p.position_id) ?? null : null,
      primaryRole: roles[0] ?? null, roleCount: roles.length,
      facility: p.hospital_id ? hospName.get(p.hospital_id) ?? null : null,
      org: p.organisation_id ? orgName.get(p.organisation_id) ?? null : null,
      status: p.account_status ?? "active", employment: p.employment_type ?? null,
    };
  });

  const by = (s: string) => rows.filter(r => r.status === s).length;
  const summary = {
    // 'Suspended' counts only genuinely-suspended accounts — deactivated is a
    // distinct status (shown via the directory badge/filter), not folded in here.
    total: rows.length, active: by("active"), suspended: by("suspended"), leavers: by("left"),
    noPosition: rows.filter(r => !r.position).length, positions: positions.length,
  };
  const positionCatalogue = positions.map(p => ({
    id: p.id, title: p.title, code: p.code ?? null, grade: p.grade ?? null, profession: p.profession ?? null,
    facility: p.hospital_id ? hospName.get(p.hospital_id) ?? null : null, canSupervise: !!p.can_supervise,
    status: p.status ?? "active", holders: peopleByPos.get(p.id) ?? 0,
  }));
  return { rows, summary, positions: positionCatalogue, facilities: (hospRes.data ?? []) as any[], departments: [] as any[] };
}

export async function loadPersonProfile(admin: any, id: string) {
  const { data: p } = await admin.from("profiles").select("*").eq("id", id).maybeSingle();
  if (!p) return null;

  const [posRes, mgrRes, orgRes, hospRes, deptRes, unitRes, allPosRes, auditRes] = await Promise.all([
    p.position_id ? admin.from("positions").select("id, title, code, grade, profession").eq("id", p.position_id).maybeSingle() : Promise.resolve({ data: null }),
    p.line_manager_id ? admin.from("profiles").select("id, full_name").eq("id", p.line_manager_id).maybeSingle() : Promise.resolve({ data: null }),
    p.organisation_id ? admin.from("organisations").select("id, name").eq("id", p.organisation_id).maybeSingle() : Promise.resolve({ data: null }),
    p.hospital_id ? admin.from("hospitals").select("id, name").eq("id", p.hospital_id).maybeSingle() : Promise.resolve({ data: null }),
    p.department_id ? admin.from("departments").select("id, name").eq("id", p.department_id).maybeSingle() : Promise.resolve({ data: null }),
    p.unit_id ? admin.from("units").select("id, name").eq("id", p.unit_id).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("positions").select("id, title, code").order("title").limit(2000),
    admin.from("audit_log").select("actor_name, action, entity_name, created_at").eq("entity_type", "profile").eq("entity_id", id).order("created_at", { ascending: false }).limit(25),
  ]);
  const roles = rolesOf(p);
  const audit = auditRes.error ? [] : ((auditRes.data ?? []) as any[]);

  return {
    person: {
      id: p.id, name: p.full_name, email: p.email, staffNumber: p.staff_number ?? null, phone: p.phone ?? null,
      profession: p.specialization ?? null, employment: p.employment_type ?? null, status: p.account_status ?? "active",
      position: (posRes as any).data ?? null, lineManager: (mgrRes as any).data ?? null,
      org: (orgRes as any).data ?? null, facility: (hospRes as any).data ?? null, department: (deptRes as any).data ?? null, unit: (unitRes as any).data ?? null,
      roles, primaryRole: roles[0] ?? null, workspaces: workspacesFor(roles),
    },
    positions: ((allPosRes.data ?? []) as any[]).map(x => ({ id: x.id, title: x.title, code: x.code })),
    audit, auditReady: !auditRes.error,
  };
}
