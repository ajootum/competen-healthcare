import { NextResponse } from "next/server";
import { getCaller, isResponse, isStaff, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { BROADCAST_PRIORITIES } from "@/lib/operations/communication-centre";

// Broadcast Centre (SSW-COM-001 §Broadcast Centre). GET lists broadcasts; POST
// creates a ward/hospital broadcast (priority, audience, expiry, emergency);
// PATCH acknowledges one (recorded per recipient for ack-rate tracking).
// Supervisor tier, tenant-scoped, audit-logged; 409 hint until 072 runs.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migration 072 to enable broadcasts" }, { status: 409 }) : null;

export async function GET() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  let q = c.admin.from("op_broadcasts").select("*").order("created_at", { ascending: false }).limit(50);
  if (!isSuper(c)) q = q.eq("hospital_id", c.hospitalId ?? NONE);
  const { data, error } = await q;
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  const b = await req.json().catch(() => ({}));
  if (!String(b.title ?? "").trim()) return badRequest("title required");
  const priority = BROADCAST_PRIORITIES.includes(b.priority) ? b.priority : "medium";

  // Intended recipients (for ack-rate): explicit count or the hospital's staff.
  let target = Number(b.target_count);
  if (!Number.isFinite(target) || target <= 0) {
    const cnt = await c.admin.from("profiles").select("id", { count: "exact", head: true }).eq("hospital_id", c.hospitalId ?? NONE);
    target = cnt.error ? 0 : (cnt.count ?? 0);
  }
  const expires = b.expires_hours ? new Date(Date.now() + Number(b.expires_hours) * 3600e3).toISOString() : null;

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const { data, error } = await c.admin.from("op_broadcasts").insert({
    hospital_id: c.hospitalId ?? (isSuper(c) ? null : NONE), shift_id: b.shift_id ?? null,
    title: String(b.title).trim(), body: b.body?.trim() || null, priority,
    audience: String(b.audience ?? "All Staff").trim() || "All Staff", target_count: Math.round(target),
    emergency: !!b.emergency, expires_at: expires, author_id: c.userId, author_name: me?.full_name ?? null,
  }).select("id, title").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ actor_id: c.userId, actor_name: me?.full_name ?? null, action: b.emergency ? "emergency_broadcast" : "create_broadcast", entity_type: "op_broadcast", entity_id: data.id, entity_name: data.title, hospital_id: c.hospitalId ?? null });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const { data: bc } = await c.admin.from("op_broadcasts").select("hospital_id, title").eq("id", id).maybeSingle();
  if (!bc) return NextResponse.json({ error: "Broadcast not found" }, { status: 404 });
  if (!isSuper(c) && bc.hospital_id && bc.hospital_id !== c.hospitalId) return forbidden("Out of scope");

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const { error } = await c.admin.from("op_broadcast_acks").upsert({ broadcast_id: id, user_id: c.userId, user_name: me?.full_name ?? null }, { onConflict: "broadcast_id,user_id" });
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
