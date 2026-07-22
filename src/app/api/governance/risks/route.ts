import { NextResponse } from "next/server";
import { getCaller, isResponse, forbidden, badRequest, isAdmin, isStaff, assertRowScope } from "@/lib/api-auth";

// Risk & Internal Controls API (GOV-001.4). One kind-discriminated route for
// the two register entities:
//   POST  { kind: "risk", ... } | { kind: "control", ... }   → create
//   PATCH ?kind=risk|control&id=…                            → whitelisted update
//   GET   ?kind=risk|control                                 → tenant-scoped list
// Tenant scope is server-bound (platform super admins write platform-wide
// rows); all writes audit-logged; 409 migration hint until 060 runs.
/* eslint-disable @typescript-eslint/no-explicit-any */

const CATEGORIES = ["strategic", "operational", "clinical", "workforce", "financial", "technology", "cybersecurity", "legal", "regulatory", "data_protection", "ai", "reputation", "business_continuity", "third_party"];
const TREATMENTS = ["avoid", "reduce", "transfer", "accept", "monitor", "escalate"];
const RISK_STATUSES = ["open", "mitigating", "accepted", "escalated", "closed"];
const CONTROL_TYPES = ["preventive", "detective", "corrective"];
const FREQUENCIES = ["continuous", "daily", "weekly", "monthly", "quarterly", "annual"];
const EFFECTIVENESS = ["effective", "partially_effective", "ineffective", "not_tested"];

const scale = (v: any, fallback: number | null = null) => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 5 ? n : fallback; };
const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migration 060 to enable the risk register" }, { status: 409 }) : null;

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden();
  const b = await req.json();

  if (b.kind === "risk") {
    if (!String(b.title ?? "").trim()) return badRequest("title required");
    const { data, error } = await c.admin.from("gov_risks").insert({
      title: String(b.title).trim(), description: b.description || null,
      category: CATEGORIES.includes(b.category) ? b.category : "operational",
      hospital_id: c.hospitalId,
      likelihood: scale(b.likelihood, 3), impact: scale(b.impact, 3),
      treatment: TREATMENTS.includes(b.treatment) ? b.treatment : "reduce",
      mitigation: b.mitigation || null, review_date: b.review_date || null,
      owner_name: b.owner_name || null, created_by: c.userId,
    }).select().single();
    if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
    await c.admin.from("audit_log").insert({ actor_id: c.userId, action: "risk_registered", entity_type: "risk", entity_id: data.id, entity_name: data.title });
    return NextResponse.json(data, { status: 201 });
  }

  if (b.kind === "control") {
    if (!String(b.name ?? "").trim()) return badRequest("name required");
    const { data, error } = await c.admin.from("gov_controls").insert({
      name: String(b.name).trim(), objective: b.objective || null,
      control_type: CONTROL_TYPES.includes(b.control_type) ? b.control_type : "preventive",
      frequency: FREQUENCIES.includes(b.frequency) ? b.frequency : "continuous",
      hospital_id: c.hospitalId, risk_id: b.risk_id || null,
      testing_method: b.testing_method || null, evidence_required: b.evidence_required || null,
      owner_name: b.owner_name || null, created_by: c.userId,
    }).select().single();
    if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
    await c.admin.from("audit_log").insert({ actor_id: c.userId, action: "control_added", entity_type: "control", entity_id: data.id, entity_name: data.name });
    return NextResponse.json(data, { status: 201 });
  }

  return badRequest("kind must be 'risk' or 'control'");
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden();
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const kind = url.searchParams.get("kind");
  if (!id || !kind) return badRequest("kind and id required");
  const b = await req.json();
  const update: any = { updated_at: new Date().toISOString() };

  if (kind === "risk") {
    const scopeErr = await assertRowScope(c, "gov_risks", id);
    if (scopeErr) return scopeErr;
    if (b.status !== undefined) { if (!RISK_STATUSES.includes(b.status)) return badRequest("invalid status"); update.status = b.status; }
    if (b.treatment !== undefined) { if (!TREATMENTS.includes(b.treatment)) return badRequest("invalid treatment"); update.treatment = b.treatment; }
    if (b.residual_likelihood !== undefined) update.residual_likelihood = scale(b.residual_likelihood);
    if (b.residual_impact !== undefined) update.residual_impact = scale(b.residual_impact);
    for (const k of ["mitigation", "review_date", "owner_name", "description"]) if (b[k] !== undefined) update[k] = b[k] || null;
    if (Object.keys(update).length <= 1) return badRequest("no valid fields");
    const { data, error } = await c.admin.from("gov_risks").update(update).eq("id", id).select("id, title, status").single();
    if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
    await c.admin.from("audit_log").insert({ actor_id: c.userId, action: `risk_${data.status}`, entity_type: "risk", entity_id: data.id, entity_name: data.title });
    return NextResponse.json(data);
  }

  if (kind === "control") {
    const scopeErr = await assertRowScope(c, "gov_controls", id);
    if (scopeErr) return scopeErr;
    if (b.effectiveness !== undefined) { if (!EFFECTIVENESS.includes(b.effectiveness)) return badRequest("invalid effectiveness"); update.effectiveness = b.effectiveness; }
    for (const k of ["last_tested", "testing_method", "evidence_required", "objective", "owner_name"]) if (b[k] !== undefined) update[k] = b[k] || null;
    if (Object.keys(update).length <= 1) return badRequest("no valid fields");
    const { data, error } = await c.admin.from("gov_controls").update(update).eq("id", id).select("id, name, effectiveness").single();
    if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
    await c.admin.from("audit_log").insert({ actor_id: c.userId, action: `control_${data.effectiveness}`, entity_type: "control", entity_id: data.id, entity_name: data.name });
    return NextResponse.json(data);
  }

  return badRequest("kind must be 'risk' or 'control'");
}

export async function GET(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  const kind = new URL(req.url).searchParams.get("kind") ?? "risk";
  const table = kind === "control" ? "gov_controls" : "gov_risks";
  let q = c.admin.from(table).select("*").order("created_at", { ascending: false }).limit(500);
  if (c.hospitalId) q = q.or(`hospital_id.eq.${c.hospitalId},hospital_id.is.null`);
  const { data, error } = await q;
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
