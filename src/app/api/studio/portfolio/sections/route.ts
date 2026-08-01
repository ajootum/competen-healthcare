import { NextResponse } from "next/server";
import { getCaller, isResponse, isEducator, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// CST-042 — portfolio-section API. POST adds a required-evidence section to a template; DELETE removes one.
// The parent template is scope-checked. Competency-office tier, audited.
/* eslint-disable @typescript-eslint/no-explicit-any */

const EVIDENCE = ["case_log", "procedure_log", "reflection", "certificate", "assessment", "project", "document", "feedback", "osce", "other"];
const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migration 135 to enable the Portfolio designer" }, { status: 409 }) : null;
const clean = (v: any) => (typeof v === "string" && v.trim() ? v.trim() : null);
const posInt = (v: any, d: number) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : d; };

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden("Editing a portfolio requires competency-office authority");

  const b = await req.json().catch(() => ({}));
  const templateId = clean(b.template_id);
  const name = clean(b.name);
  if (!templateId || !name) return badRequest("template and section name are required");
  const evidence = EVIDENCE.includes(b.evidence_type) ? b.evidence_type : "document";
  const weight = posInt(b.weight, 0);
  if (weight > 100) return badRequest("weight must be 0–100");

  const { data: t } = await c.admin.from("cst_portfolio_templates").select("id, hospital_id").eq("id", templateId).maybeSingle();
  if (!t) return NextResponse.json({ error: "Template not found" }, { status: 404 });
  if (!isSuper(c) && t.hospital_id && t.hospital_id !== c.hospitalId) return forbidden("Out of scope");

  const { count } = await c.admin.from("cst_portfolio_sections").select("id", { count: "exact", head: true }).eq("template_id", templateId);
  const { data, error } = await c.admin.from("cst_portfolio_sections").insert({
    template_id: templateId, name, evidence_type: evidence, required_count: posInt(b.required_count, 1), weight, is_required: b.is_required !== false, sort_order: count ?? 0,
  }).select("id").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("cst_portfolio_templates").update({ updated_at: new Date().toISOString() }).eq("id", templateId);
  await c.admin.from("audit_log").insert({ trace_id: c.traceId, actor_id: c.userId, action: "add_portfolio_section", entity_type: "cst_portfolio_template", entity_id: templateId, hospital_id: t.hospital_id ?? null, new_value: { name, evidence_type: evidence, weight } });
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");

  const { data: sec } = await c.admin.from("cst_portfolio_sections").select("id, template_id").eq("id", id).maybeSingle();
  if (!sec) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data: t } = await c.admin.from("cst_portfolio_templates").select("hospital_id").eq("id", sec.template_id).maybeSingle();
  if (t && !isSuper(c) && t.hospital_id && t.hospital_id !== c.hospitalId) return forbidden("Out of scope");

  const { error } = await c.admin.from("cst_portfolio_sections").delete().eq("id", id);
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
  await c.admin.from("audit_log").insert({ trace_id: c.traceId, actor_id: c.userId, action: "remove_portfolio_section", entity_type: "cst_portfolio_template", entity_id: sec.template_id, hospital_id: t?.hospital_id ?? null });
  return NextResponse.json({ ok: true });
}
