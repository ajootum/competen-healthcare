import { NextResponse } from "next/server";
import { getCaller, isResponse, forbidden, isAdmin, assertRowScope } from "@/lib/api-auth";

// EQOS write API — Quality Objects (Ch.41-42), Indicators & measurements
// (Ch.44), Improvement Objects (Ch.43). Reads happen in server components.

const shortCode = (prefix: string) =>
  `${prefix}-${Date.now().toString(36).toUpperCase().slice(-6)}`;

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden();

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const actorName = me?.full_name ?? null;

  const body = await req.json();
  const kind = body.kind as string;

  // ── Create a Quality Object, optionally with framework standards ──
  if (kind === "quality_object") {
    const { title, description, purpose, domain_id, standards } = body;
    if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });

    const { data: qo, error } = await c.admin.from("quality_objects").insert({
      code: shortCode("QO"),
      title, description: description ?? null, purpose: purpose ?? null,
      domain_id: domain_id || null,
      hospital_id: c.hospitalId,
      owner_id: c.userId, status: "active", created_by: c.userId,
    }).select("id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const stds = (standards ?? []) as { framework_id: string; reference_code: string; title?: string }[];
    const valid = stds.filter(s => s.framework_id && s.reference_code?.trim());
    if (valid.length) {
      await c.admin.from("quality_standards").insert(valid.map(s => ({
        quality_object_id: qo.id, framework_id: s.framework_id,
        reference_code: s.reference_code.trim(), title: s.title?.trim() || null,
      })));
    }
    await c.admin.from("audit_log").insert({
      actor_id: c.userId, actor_name: actorName,
      action: "create_quality_object", entity_type: "quality_object", entity_id: qo.id,
      new_value: { title, standards: valid.length },
    });
    return NextResponse.json(qo, { status: 201 });
  }

  // ── Create an indicator on a Quality Object ──
  if (kind === "indicator") {
    const { quality_object_id, name, unit, direction, target_value, escalation_value } = body;
    if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
    // A referenced quality object must be in the caller's hospital.
    if (quality_object_id) {
      const scopeErr = await assertRowScope(c, "quality_objects", quality_object_id);
      if (scopeErr) return scopeErr;
    }
    const { data, error } = await c.admin.from("quality_indicators").insert({
      quality_object_id: quality_object_id || null,
      code: shortCode("QI"), name,
      unit: unit ?? "percent", direction: direction ?? "higher_is_better",
      target_value: target_value ?? null, escalation_value: escalation_value ?? null,
    }).select("id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data, { status: 201 });
  }

  // ── Record a measurement ──
  if (kind === "measurement") {
    const { indicator_id, value, period, numerator, denominator, notes } = body;
    if (!indicator_id || value == null) return NextResponse.json({ error: "indicator_id and value required" }, { status: 400 });
    const { data, error } = await c.admin.from("indicator_measurements").insert({
      indicator_id, value,
      period: period || undefined,
      numerator: numerator ?? null, denominator: denominator ?? null, notes: notes ?? null,
      hospital_id: c.hospitalId, recorded_by: c.userId,
    }).select("id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data, { status: 201 });
  }

  // ── Create an Improvement Object ──
  if (kind === "improvement") {
    const { title, quality_object_id, problem_statement, aim_statement, methodology, target_date } = body;
    if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
    // A referenced quality object must be in the caller's hospital.
    if (quality_object_id) {
      const scopeErr = await assertRowScope(c, "quality_objects", quality_object_id);
      if (scopeErr) return scopeErr;
    }
    const { data, error } = await c.admin.from("improvement_objects").insert({
      code: shortCode("IO"), title,
      quality_object_id: quality_object_id || null,
      hospital_id: c.hospitalId,
      problem_statement: problem_statement ?? null, aim_statement: aim_statement ?? null,
      methodology: methodology ?? "pdsa", status: "proposed",
      owner_id: c.userId, start_date: new Date().toISOString().slice(0, 10),
      target_date: target_date || null, created_by: c.userId,
    }).select("id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await c.admin.from("audit_log").insert({
      actor_id: c.userId, actor_name: actorName,
      action: "create_improvement", entity_type: "improvement_object", entity_id: data.id,
      new_value: { title, methodology },
    });
    return NextResponse.json(data, { status: 201 });
  }

  return NextResponse.json({ error: "unknown kind" }, { status: 400 });
}

// PATCH — advance an improvement's lifecycle status
export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden();

  const { improvement_id, status, outcome_summary, lessons_learned } = await req.json();
  if (!improvement_id || !status) return NextResponse.json({ error: "improvement_id and status required" }, { status: 400 });
  // The target improvement object must belong to the caller's hospital.
  const scopeErr = await assertRowScope(c, "improvement_objects", improvement_id);
  if (scopeErr) return scopeErr;

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();

  const update: Record<string, unknown> = { status };
  if (outcome_summary !== undefined) update.outcome_summary = outcome_summary;
  if (lessons_learned !== undefined) update.lessons_learned = lessons_learned;
  if (["sustained", "closed"].includes(status)) update.completed_date = new Date().toISOString().slice(0, 10);

  const { error } = await c.admin.from("improvement_objects").update(update).eq("id", improvement_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({
    actor_id: c.userId, actor_name: me?.full_name ?? null,
    action: "update_improvement_status", entity_type: "improvement_object", entity_id: improvement_id,
    new_value: { status },
  });
  return NextResponse.json({ ok: true });
}
