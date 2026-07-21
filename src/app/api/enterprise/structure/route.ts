import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// Structure Builder (ENT-001 §4) — one endpoint for the whole organisational
// hierarchy: divisions, departments, units, teams and services. Super_admin only.
// Every create validates its parent exists; archive uses status/is_active.
/* eslint-disable @typescript-eslint/no-explicit-any */

const ENTITIES = ["division", "department", "unit", "team", "service"] as const;
type Entity = (typeof ENTITIES)[number];
const TABLE: Record<Entity, string> = { division: "ent_divisions", department: "departments", unit: "units", team: "ent_teams", service: "ent_services" };
const clean = (v: any, max = 120) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

async function exists(admin: any, table: string, id: any) {
  if (!id) return false;
  const { data } = await admin.from(table).select("id").eq("id", id).maybeSingle();
  return !!data;
}
// Resolve an optional FK: undefined = leave unset, ""/null = clear, else must exist.
async function fk(admin: any, table: string, id: any, label: string) {
  if (id === undefined) return undefined as any;
  if (id === null || id === "") return null;
  if (!(await exists(admin, table, id))) return badRequest(`${label} not found`);
  return id;
}

async function buildInsert(admin: any, entity: Entity, b: any): Promise<any> {
  const name = clean(b.name);
  if (!name) return badRequest("name required");
  const code = clean(b.code, 40);

  if (entity === "division") {
    if (!(await exists(admin, "hospitals", b.hospital_id))) return badRequest("Facility not found");
    const director = await fk(admin, "profiles", b.director_id, "Director"); if (isResponse(director)) return director;
    return { hospital_id: b.hospital_id, name, code, director_id: director ?? null, is_active: true };
  }
  if (entity === "department") {
    if (!(await exists(admin, "hospitals", b.hospital_id))) return badRequest("Facility not found");
    const head = await fk(admin, "profiles", b.head_id, "Head"); if (isResponse(head)) return head;
    let divisionId: string | null = null;
    if (b.division_id) {
      const { data: div } = await admin.from("ent_divisions").select("hospital_id").eq("id", b.division_id).maybeSingle();
      if (!div) return badRequest("Division not found");
      if (div.hospital_id !== b.hospital_id) return badRequest("Division belongs to another facility");
      divisionId = b.division_id;
    }
    return { hospital_id: b.hospital_id, name, code, division_id: divisionId, dept_type: clean(b.dept_type, 60), specialty: clean(b.specialty, 60), cost_centre: clean(b.cost_centre, 40), head_id: head ?? null, status: "active", is_active: true };
  }
  if (entity === "unit") {
    if (!(await exists(admin, "departments", b.department_id))) return badRequest("Department not found");
    const mgr = await fk(admin, "profiles", b.manager_id, "Manager"); if (isResponse(mgr)) return mgr;
    const beds = parseInt(b.bed_count, 10);
    return { department_id: b.department_id, name, code, unit_type: clean(b.unit_type, 40), specialty: clean(b.specialty, 60), shift_model: clean(b.shift_model, 40), bed_count: Number.isFinite(beds) && beds >= 0 ? beds : null, manager_id: mgr ?? null, status: "active", is_active: true };
  }
  if (entity === "team") {
    if (!(await exists(admin, "units", b.unit_id))) return badRequest("Unit not found");
    const lead = await fk(admin, "profiles", b.lead_id, "Lead"); if (isResponse(lead)) return lead;
    return { unit_id: b.unit_id, name, code, lead_id: lead ?? null, is_active: true };
  }
  // service
  const org = await fk(admin, "organisations", b.organisation_id, "Organisation"); if (isResponse(org)) return org;
  const hosp = await fk(admin, "hospitals", b.hospital_id, "Facility"); if (isResponse(hosp)) return hosp;
  if (org == null && hosp == null) return badRequest("service needs an organisation or facility");
  return { organisation_id: org ?? null, hospital_id: hosp ?? null, name, category: clean(b.category, 60), scope: clean(b.scope, 200), is_active: true };
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden();
  const admin = c.admin as any;
  const b = await req.json().catch(() => ({}));
  if (!ENTITIES.includes(b.entity)) return badRequest("valid entity required");
  const insert = await buildInsert(admin, b.entity, b);
  if (isResponse(insert)) return insert;

  const { data, error } = await admin.from(TABLE[b.entity as Entity]).insert(insert).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("audit_log").insert({ actor_id: c.userId, action: `create_${b.entity}`, entity_type: b.entity, entity_id: data.id, entity_name: data.name });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden();
  const admin = c.admin as any;
  const url = new URL(req.url);
  const entity = url.searchParams.get("entity") as Entity | null;
  const id = url.searchParams.get("id");
  if (!entity || !ENTITIES.includes(entity)) return badRequest("valid entity required");
  if (!id) return badRequest("id required");
  const table = TABLE[entity];
  const { data: row } = await admin.from(table).select("id, name").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const b = await req.json().catch(() => ({}));

  // Archive: department/unit carry a status column; division/team/service use is_active.
  if (b.action === "archive" || b.action === "restore") {
    const on = b.action === "restore";
    const update = (entity === "department" || entity === "unit") ? { status: on ? "active" : "archived", is_active: on } : { is_active: on };
    const { error } = await admin.from(table).update(update).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await admin.from("audit_log").insert({ actor_id: c.userId, action: `${b.action}_${entity}`, entity_type: entity, entity_id: id, entity_name: row.name });
    return NextResponse.json({ ok: true });
  }

  const update: any = {};
  if (b.name !== undefined) { const n = clean(b.name); if (!n) return badRequest("name cannot be empty"); update.name = n; }
  if (b.code !== undefined && entity !== "service") update.code = clean(b.code, 40); // ent_services has no code column
  // Leadership reassignment (the FK differs per entity).
  const leadField: Record<Entity, string | null> = { division: "director_id", department: "head_id", unit: "manager_id", team: "lead_id", service: null };
  const lf = leadField[entity];
  if (lf && b.leader_id !== undefined) { const v = await fk(admin, "profiles", b.leader_id, "Person"); if (isResponse(v)) return v; update[lf] = v; }
  if (entity === "department" && b.dept_type !== undefined) update.dept_type = clean(b.dept_type, 60);
  if (entity === "department" && b.cost_centre !== undefined) update.cost_centre = clean(b.cost_centre, 40);
  if (entity === "unit" && b.bed_count !== undefined) { const beds = parseInt(b.bed_count, 10); update.bed_count = Number.isFinite(beds) && beds >= 0 ? beds : null; }
  if (entity === "unit" && b.shift_model !== undefined) update.shift_model = clean(b.shift_model, 40);
  if (entity === "unit" && b.specialty !== undefined) update.specialty = clean(b.specialty, 60);
  if (entity === "service" && b.category !== undefined) update.category = clean(b.category, 60);
  if (entity === "service" && b.scope !== undefined) update.scope = clean(b.scope, 200);
  if (!Object.keys(update).length) return badRequest("no valid fields");

  const { data, error } = await admin.from(table).update(update).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("audit_log").insert({ actor_id: c.userId, action: `update_${entity}`, entity_type: entity, entity_id: id, entity_name: data.name });
  return NextResponse.json(data);
}
