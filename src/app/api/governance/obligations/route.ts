import { NextResponse } from "next/server";
import { getCaller, isResponse, forbidden, badRequest, isAdmin, isStaff, assertRowScope } from "@/lib/api-auth";

// Compliance obligations register (GOV-001.3). POST creates an obligation
// (tenant scope bound to the caller — super admins without a hospital create
// PLATFORM-WIDE obligations); PATCH updates status/ownership/dates with a
// field whitelist; GET lists tenant-scoped. All writes audit-logged.
// Returns 409 "Run migration 059" when the table is absent (fail-soft).
/* eslint-disable @typescript-eslint/no-explicit-any */

const DOMAINS = ["regulatory", "clinical", "workforce", "licence", "training", "competency", "data_privacy", "cybersecurity", "financial", "contractual", "documentation", "ai"];
const FREQUENCIES = ["monthly", "quarterly", "biannual", "annual", "once"];
const STATUSES = ["compliant", "at_risk", "non_compliant", "not_assessed", "waived"];
const RATINGS = ["low", "medium", "high", "critical"];

const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migration 059 to enable the obligations register" }, { status: 409 }) : null;

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden();

  const b = await req.json();
  if (!String(b.title ?? "").trim()) return badRequest("title required");

  const { data, error } = await c.admin.from("gov_obligations").insert({
    title: String(b.title).trim(),
    source_authority: b.source_authority || null,
    framework_id: b.framework_id || null,
    domain: DOMAINS.includes(b.domain) ? b.domain : "regulatory",
    hospital_id: c.hospitalId, // server-bound; null for platform super admins = platform-wide
    review_frequency: FREQUENCIES.includes(b.review_frequency) ? b.review_frequency : "annual",
    evidence_required: b.evidence_required || null,
    effective_date: b.effective_date || null,
    expiry_date: b.expiry_date || null,
    risk_rating: RATINGS.includes(b.risk_rating) ? b.risk_rating : "medium",
    note: b.note || null,
    created_by: c.userId,
  }).select().single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ actor_id: c.userId, action: "obligation_created", entity_type: "obligation", entity_id: data.id, entity_name: data.title });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const scopeErr = await assertRowScope(c, "gov_obligations", id);
  if (scopeErr) return scopeErr;

  const b = await req.json();
  const update: any = { updated_at: new Date().toISOString() };
  if (b.status !== undefined) { if (!STATUSES.includes(b.status)) return badRequest("invalid status"); update.status = b.status; }
  if (b.risk_rating !== undefined) { if (!RATINGS.includes(b.risk_rating)) return badRequest("invalid risk_rating"); update.risk_rating = b.risk_rating; }
  if (b.status === "waived" && !String(b.waiver_note ?? "").trim()) return badRequest("waiver_note required when waiving");
  for (const k of ["owner_id", "owner_name", "expiry_date", "effective_date", "evidence_required", "note", "waiver_note"]) if (b[k] !== undefined) update[k] = b[k] || null;
  if (Object.keys(update).length <= 1) return badRequest("no valid fields");

  const { data, error } = await c.admin.from("gov_obligations").update(update).eq("id", id).select("id, title, status").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ actor_id: c.userId, action: `obligation_${data.status}`, entity_type: "obligation", entity_id: data.id, entity_name: data.title });
  return NextResponse.json(data);
}

export async function GET() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  let q = c.admin.from("gov_obligations").select("*").order("created_at", { ascending: false }).limit(500);
  if (c.hospitalId) q = q.or(`hospital_id.eq.${c.hospitalId},hospital_id.is.null`);
  const { data, error } = await q;
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
