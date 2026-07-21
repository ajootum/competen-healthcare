// Structure Builder (ENT-001 §4) loader — the interactive organisational tree
// for a selected facility: Facility → Division → Department → Unit → Team, plus
// the service catalogue. All live from real tables (ent_divisions, departments,
// units, ent_teams, ent_services). Returns the staff list for head/manager
// assignment. Fail-soft on 052 tables so it degrades before the migration.
/* eslint-disable @typescript-eslint/no-explicit-any */

export async function loadStructure(admin: any, facilityId?: string | null) {
  const { data: facRows } = await admin.from("hospitals").select("id, name, organisation_id, country").order("name").limit(4000);
  const facilities = (facRows ?? []) as any[];
  if (facilities.length === 0) return { facilities: [], selected: null, facility: null, tree: null, services: [], staff: [], counts: { divisions: 0, departments: 0, units: 0, teams: 0, services: 0 }, ready: true };

  const fid = facilityId && facilities.some(f => f.id === facilityId) ? facilityId : facilities[0].id;
  const facility = facilities.find(f => f.id === fid);

  const [divRes, deptRes, svcRes] = await Promise.all([
    admin.from("ent_divisions").select("*").eq("hospital_id", fid).order("name"),
    admin.from("departments").select("*").eq("hospital_id", fid).order("name"),
    admin.from("ent_services").select("id, name, category, scope, is_active").or(`hospital_id.eq.${fid}${facility.organisation_id ? `,organisation_id.eq.${facility.organisation_id}` : ""}`).order("name"),
  ]);
  const ready = !divRes.error;
  const divisions = divRes.error ? [] : ((divRes.data ?? []) as any[]);
  const departments = (deptRes.data ?? []) as any[];
  const services = svcRes.error ? [] : ((svcRes.data ?? []) as any[]);
  const deptIds = departments.map(d => d.id);

  let unitRows: any[] = [], teamRows: any[] = [];
  if (deptIds.length) {
    const uRes = await admin.from("units").select("*").in("department_id", deptIds).order("name");
    unitRows = (uRes.data ?? []) as any[];
    const unitIds = unitRows.map(u => u.id);
    if (unitIds.length) { const tRes = await admin.from("ent_teams").select("*").in("unit_id", unitIds); teamRows = tRes.error ? [] : ((tRes.data ?? []) as any[]); }
  }

  // Staff for head/manager/lead assignment — profiles in this facility or its org.
  const { data: staffRows } = await admin.from("profiles").select("id, full_name, role, roles")
    .or(`hospital_id.eq.${fid}${facility.organisation_id ? `,organisation_id.eq.${facility.organisation_id}` : ""}`).order("full_name").limit(2000);
  const staff = (staffRows ?? []) as any[];
  const nameOf = new Map<string, string>(staff.map(s => [s.id, s.full_name]));

  const teamsByUnit = new Map<string, any[]>();
  for (const t of teamRows) { if (!teamsByUnit.has(t.unit_id)) teamsByUnit.set(t.unit_id, []); teamsByUnit.get(t.unit_id)!.push(t); }
  const unitsByDept = new Map<string, any[]>();
  for (const u of unitRows) { if (!unitsByDept.has(u.department_id)) unitsByDept.set(u.department_id, []); unitsByDept.get(u.department_id)!.push(u); }

  const buildDept = (d: any) => ({
    id: d.id, kind: "department" as const, name: d.name, code: d.code ?? null, type: d.dept_type ?? d.specialty ?? null,
    head: d.head_id ? nameOf.get(d.head_id) ?? null : null, headId: d.head_id ?? null, costCentre: d.cost_centre ?? null,
    status: d.status ?? (d.is_active === false ? "archived" : "active"), divisionId: d.division_id ?? null,
    units: (unitsByDept.get(d.id) ?? []).map((u: any) => ({
      id: u.id, kind: "unit" as const, name: u.name, code: u.code ?? null, type: u.unit_type ?? null, specialty: u.specialty ?? null,
      manager: u.manager_id ? nameOf.get(u.manager_id) ?? null : null, managerId: u.manager_id ?? null,
      beds: u.bed_count ?? null, shiftModel: u.shift_model ?? null, status: u.status ?? (u.is_active === false ? "archived" : "active"),
      teams: (teamsByUnit.get(u.id) ?? []).map((t: any) => ({ id: t.id, kind: "team" as const, name: t.name, code: t.code ?? null, lead: t.lead_id ? nameOf.get(t.lead_id) ?? null : null, leadId: t.lead_id ?? null, status: t.is_active === false ? "archived" : "active" })),
    })),
  });

  const deptByDiv = new Map<string | null, any[]>();
  for (const d of departments) { const k = d.division_id ?? null; if (!deptByDiv.has(k)) deptByDiv.set(k, []); deptByDiv.get(k)!.push(d); }

  const tree = {
    divisions: divisions.map(v => ({
      id: v.id, kind: "division" as const, name: v.name, code: v.code ?? null,
      director: v.director_id ? nameOf.get(v.director_id) ?? null : null, directorId: v.director_id ?? null,
      status: v.is_active === false ? "archived" : "active",
      departments: (deptByDiv.get(v.id) ?? []).map(buildDept),
    })),
    unassignedDepartments: (deptByDiv.get(null) ?? []).map(buildDept),
  };

  return {
    facilities: facilities.map(f => ({ id: f.id, name: f.name })),
    selected: fid, facility: { id: facility.id, name: facility.name },
    tree, services, staff: staff.map(s => ({ id: s.id, name: s.full_name })),
    counts: { divisions: divisions.length, departments: departments.length, units: unitRows.length, teams: teamRows.length, services: services.length },
    ready,
  };
}
