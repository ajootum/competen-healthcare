import { NextResponse } from "next/server";
import { getCaller, isResponse, isStaff, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { CONTEXT_TYPES } from "@/lib/operations/communication-centre";

// Team Communications (SSW-COM-001 §Team Communications). GET lists recent messages
// for a channel; POST sends a context-aware message (team/patient/task/direct).
// Supervisor tier, tenant-scoped, audit-logged; 409 migration hint until 072 runs.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migration 072 to enable messaging" }, { status: 409 }) : null;

export async function GET(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  const channel = new URL(req.url).searchParams.get("channel");
  let q = c.admin.from("op_messages").select("id, channel, context_type, body, author_name, created_at").order("created_at", { ascending: false }).limit(100);
  if (!isSuper(c)) q = q.eq("hospital_id", c.hospitalId ?? NONE);
  if (channel) q = q.eq("channel", channel);
  const { data, error } = await q;
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  const b = await req.json().catch(() => ({}));
  if (!String(b.body ?? "").trim()) return badRequest("body required");
  const context = CONTEXT_TYPES.includes(b.context_type) ? b.context_type : "team";

  if (b.patient_id) {
    const { data: p } = await c.admin.from("op_patients").select("hospital_id").eq("id", b.patient_id).maybeSingle();
    if (!p) return NextResponse.json({ error: "Patient not found" }, { status: 404 });
    if (!isSuper(c) && p.hospital_id !== c.hospitalId) return forbidden("Patient out of scope");
  }

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const { data, error } = await c.admin.from("op_messages").insert({
    hospital_id: c.hospitalId ?? (isSuper(c) ? null : NONE), shift_id: b.shift_id ?? null,
    channel: String(b.channel ?? "General").trim() || "General", context_type: context,
    patient_id: b.patient_id ?? null, body: String(b.body).trim(),
    author_id: c.userId, author_name: me?.full_name ?? null,
  }).select("id, channel").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ actor_id: c.userId, actor_name: me?.full_name ?? null, action: "send_message", entity_type: "op_message", entity_id: data.id, entity_name: data.channel, hospital_id: c.hospitalId ?? null });
  return NextResponse.json(data, { status: 201 });
}
