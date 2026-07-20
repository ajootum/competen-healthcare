import { NextResponse } from "next/server";
import { getCaller, isResponse, forbidden, isStaff, isSuper } from "@/lib/api-auth";

// GET — full config for a CPU: blueprint + methods + evidence matrix + critical failures
export async function GET(_req: Request, { params }: { params: Promise<{ cpuId: string }> }) {
  const { cpuId } = await params;
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();

  const admin = c.admin;
  const [{ data: blueprint }, { data: methods }, { data: matrix }, { data: critical }] = await Promise.all([
    admin.from("assessment_blueprints").select("*").eq("cpu_id", cpuId).maybeSingle(),
    admin.from("blueprint_methods").select("*").order("method"),
    admin.from("evidence_matrix").select("*").eq("cpu_id", cpuId).order("evidence_type"),
    admin.from("critical_failure_rules").select("*").eq("cpu_id", cpuId).order("created_at"),
  ]);

  const blueprintMethods = blueprint
    ? (methods ?? []).filter(m => m.blueprint_id === blueprint.id)
    : [];

  return NextResponse.json({ blueprint, methods: blueprintMethods, matrix: matrix ?? [], critical: critical ?? [] });
}

// PATCH — update blueprint header, or upsert a method / evidence-matrix row / critical failure
export async function PATCH(req: Request, { params }: { params: Promise<{ cpuId: string }> }) {
  const { cpuId } = await params;
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden(); // blueprint authoring is super_admin only

  const admin = c.admin;
  const body = await req.json();

  // Ensure a blueprint exists
  let { data: blueprint } = await admin.from("assessment_blueprints").select("id").eq("cpu_id", cpuId).maybeSingle();
  if (!blueprint) {
    const { data: created } = await admin.from("assessment_blueprints").insert({ cpu_id: cpuId }).select("id").single();
    blueprint = created;
  }

  if (body.type === "blueprint") {
    const allowed = ["min_score", "min_assessors", "consensus_rule", "reassessment_months"];
    const update = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));
    await admin.from("assessment_blueprints").update(update).eq("cpu_id", cpuId);
    return NextResponse.json({ ok: true });
  }

  if (body.type === "method") {
    const { method, weight, is_required, min_evidence } = body;
    if (!method) return NextResponse.json({ error: "method required" }, { status: 400 });
    await admin.from("blueprint_methods").upsert({
      blueprint_id: blueprint!.id, method,
      weight: weight ?? 0, is_required: is_required ?? true, min_evidence: min_evidence ?? 1,
    }, { onConflict: "blueprint_id,method" });
    return NextResponse.json({ ok: true });
  }

  if (body.type === "evidence") {
    const { evidence_type, min_quantity, weight, validity_months, is_critical, min_assessors } = body;
    if (!evidence_type) return NextResponse.json({ error: "evidence_type required" }, { status: 400 });
    await admin.from("evidence_matrix").upsert({
      cpu_id: cpuId, evidence_type,
      min_quantity: min_quantity ?? 1, weight: weight ?? 0,
      validity_months: validity_months ?? 12, is_critical: is_critical ?? false,
      min_assessors: min_assessors ?? 1,
    }, { onConflict: "cpu_id,evidence_type" });
    return NextResponse.json({ ok: true });
  }

  if (body.type === "critical") {
    const { description } = body;
    if (!description) return NextResponse.json({ error: "description required" }, { status: 400 });
    await admin.from("critical_failure_rules").insert({ cpu_id: cpuId, description });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown config type" }, { status: 400 });
}

// DELETE — remove a method / evidence row / critical failure
export async function DELETE(req: Request, { params }: { params: Promise<{ cpuId: string }> }) {
  const { cpuId } = await params;
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden(); // blueprint authoring is super_admin only

  const { searchParams } = new URL(req.url);
  const kind = searchParams.get("kind");
  const value = searchParams.get("value");
  const admin = c.admin;

  if (kind === "method" && value) {
    const { data: blueprint } = await admin.from("assessment_blueprints").select("id").eq("cpu_id", cpuId).maybeSingle();
    if (blueprint) await admin.from("blueprint_methods").delete().eq("blueprint_id", blueprint.id).eq("method", value);
    return NextResponse.json({ ok: true });
  }
  if (kind === "evidence" && value) {
    await admin.from("evidence_matrix").delete().eq("cpu_id", cpuId).eq("evidence_type", value);
    return NextResponse.json({ ok: true });
  }
  if (kind === "critical" && value) {
    await admin.from("critical_failure_rules").delete().eq("id", value);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "kind and value required" }, { status: 400 });
}
