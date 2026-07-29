import { NextResponse } from "next/server";
import { getCaller, isResponse, isEducator, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// CST-105 — Competency Dependency Manager write API. POST defines a competency↔competency dependency
// (prerequisite / co-requisite / recommended / inherited); DELETE removes one. Competency-office tier
// (educator/admin/super), tenant-scoped, audit-logged. Prerequisite/inherited edges are cycle-checked
// on write via reachability so the progression graph can never be made impossible to satisfy.
/* eslint-disable @typescript-eslint/no-explicit-any */

const TYPES = ["prerequisite", "co_requisite", "recommended", "inherited"];
const ORDERING = new Set(["prerequisite", "inherited"]); // types that imply "must come before" → cycle-checked
const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migration 128 to enable the Dependency Manager" }, { status: 409 }) : null;
const clean = (v: any) => (typeof v === "string" && v.trim() ? v.trim() : null);

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden("Defining a dependency requires competency-office authority");

  const b = await req.json().catch(() => ({}));
  const source = clean(b.source_competency_id);
  const target = clean(b.target_competency_id);
  const type = TYPES.includes(b.dependency_type) ? b.dependency_type : "prerequisite";
  if (!source || !target) return badRequest("source and target competencies are required");
  if (source === target) return badRequest("a competency cannot depend on itself");

  // Cycle prevention for ordering edges: reject if `target` can already reach `source` via
  // prerequisite/inherited edges — adding source→target would close a cycle.
  if (ORDERING.has(type)) {
    const { data: edges } = await c.admin.from("competency_dependencies")
      .select("source_competency_id, target_competency_id").in("dependency_type", ["prerequisite", "inherited"]).limit(20000);
    const adj = new Map<string, string[]>();
    for (const e of (edges ?? []) as any[]) { const a = adj.get(e.source_competency_id) ?? []; a.push(e.target_competency_id); adj.set(e.source_competency_id, a); }
    const seen = new Set<string>([target]); const queue = [target];
    while (queue.length) {
      const u = queue.shift()!;
      for (const v of adj.get(u) ?? []) {
        if (v === source) return badRequest("that would create a prerequisite cycle");
        if (!seen.has(v)) { seen.add(v); queue.push(v); }
      }
    }
  }

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const { data, error } = await c.admin.from("competency_dependencies").insert({
    hospital_id: c.hospitalId ?? null,
    source_competency_id: source, target_competency_id: target,
    dependency_type: type, notes: clean(b.notes),
    created_by: c.userId, created_by_name: me?.full_name ?? null,
  }).select("id").single();
  if (error) {
    if (/duplicate key|unique/i.test(error.message)) return badRequest("that dependency already exists");
    return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
  }

  await c.admin.from("audit_log").insert({ actor_id: c.userId, actor_name: me?.full_name ?? null, action: "create_competency_dependency", entity_type: "competency_dependency", entity_id: data.id, hospital_id: c.hospitalId ?? null, new_value: { source, target, dependency_type: type } });
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");

  const { data: row } = await c.admin.from("competency_dependencies").select("id, hospital_id").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && row.hospital_id && row.hospital_id !== c.hospitalId) return forbidden("Out of scope");

  const { error } = await c.admin.from("competency_dependencies").delete().eq("id", id);
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ actor_id: c.userId, action: "delete_competency_dependency", entity_type: "competency_dependency", entity_id: id, hospital_id: row.hospital_id ?? null });
  return NextResponse.json({ ok: true });
}
