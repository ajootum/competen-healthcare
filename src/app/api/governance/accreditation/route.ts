import { NextResponse } from "next/server";
import { getCaller, isResponse, forbidden, badRequest, isAdmin, isStaff } from "@/lib/api-auth";

// Standard self-assessments (GOV-001.6). POST records an assessment of one
// framework standard (INSERT-ONLY history — each re-assessment is a new row;
// readers take the latest per framework+reference). GET lists tenant-scoped.
// Audit-logged; 409 migration hint until 061 runs.
/* eslint-disable @typescript-eslint/no-explicit-any */

const STATUSES = ["met", "partially_met", "not_met", "not_assessed"];

const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migration 061 to enable standard self-assessments" }, { status: 409 }) : null;

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden();

  const b = await req.json();
  if (!b.framework_id) return badRequest("framework_id required");
  if (!String(b.reference_code ?? "").trim()) return badRequest("reference_code required");
  if (!STATUSES.includes(b.status)) return badRequest("status must be met, partially_met, not_met or not_assessed");
  if ((b.status === "not_met" || b.status === "partially_met") && !String(b.gap_note ?? "").trim()) {
    return badRequest("gap_note required when a standard is not fully met");
  }

  // The framework must exist (reference codes may be new — standards can be
  // assessed before they are mapped to a quality object).
  const { data: fw } = await c.admin.from("quality_frameworks").select("id, code").eq("id", b.framework_id).maybeSingle();
  if (!fw) return NextResponse.json({ error: "Framework not found" }, { status: 404 });

  const { data, error } = await c.admin.from("gov_standard_assessments").insert({
    framework_id: b.framework_id,
    reference_code: String(b.reference_code).trim().toUpperCase(),
    title: b.title || null,
    status: b.status,
    gap_note: b.gap_note || null,
    evidence_note: b.evidence_note || null,
    owner_name: b.owner_name || null,
    hospital_id: c.hospitalId, // null for platform super admins = platform-level assessment
    assessed_by: c.userId,
  }).select().single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ actor_id: c.userId, action: `standard_${data.status}`, entity_type: "accreditation", entity_id: data.id, entity_name: `${fw.code} ${data.reference_code}` });
  return NextResponse.json(data, { status: 201 });
}

export async function GET() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  let q = c.admin.from("gov_standard_assessments").select("*").order("assessed_at", { ascending: false }).limit(1000);
  if (c.hospitalId) q = q.or(`hospital_id.eq.${c.hospitalId},hospital_id.is.null`);
  const { data, error } = await q;
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
