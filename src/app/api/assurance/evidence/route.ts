import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// CAPA-004 — evidence verification API. A super-admin verifies / rejects / flags a piece of competency evidence;
// the decision updates its verification state and writes an immutable integrity event (chain-of-custody, mig 149).
/* eslint-disable @typescript-eslint/no-explicit-any */

const isMissing = (e: any) => /does not exist|schema cache|column .* does not exist/i.test(String(e?.message ?? ""));
// action → { status, verified, event_type }
const ACTIONS: Record<string, { status: string; verified: boolean; event: string }> = {
  verify: { status: "verified", verified: true, event: "verified" },
  reject: { status: "rejected", verified: false, event: "rejected" },
  flag: { status: "flagged", verified: false, event: "flagged" },
  unflag: { status: "pending", verified: false, event: "unflagged" },
};

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden("Evidence assurance is super-admin only");
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const b = await req.json().catch(() => ({}));
  const a = ACTIONS[b.action];
  if (!a) return badRequest("action must be verify, reject, flag or unflag");

  const { data: ev, error: readErr } = await c.admin.from("evidence").select("id, hospital_id, status").eq("id", id).maybeSingle();
  if (readErr && isMissing(readErr)) return badRequest("Evidence integrity not provisioned (apply migration 149)");
  if (!ev) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const me = await c.admin.from("profiles").select("full_name").eq("id", c.userId).maybeSingle();
  const patch: Record<string, any> = { status: a.status, verified: a.verified };
  if (a.status === "verified") { patch.verified_by = c.userId; patch.verified_at = new Date().toISOString(); }
  const { error } = await c.admin.from("evidence").update(patch).eq("id", id);
  if (error) return isMissing(error) ? badRequest("Evidence integrity not provisioned (apply migration 149)") : NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("evidence_integrity_events").insert({ evidence_id: id, hospital_id: ev.hospital_id ?? null, event_type: a.event, actor_id: c.userId, actor_name: me.data?.full_name ?? null, note: b.note ? String(b.note).slice(0, 500) : null }).then((r: any) => r, () => {});
  await c.admin.from("audit_log").insert({ actor_id: c.userId, actor_name: me.data?.full_name ?? null, action: `evidence_${a.event}`, entity_type: "evidence", entity_id: id, hospital_id: ev.hospital_id ?? null, new_value: { status: a.status } }).then((r: any) => r, () => {});
  return NextResponse.json({ ok: true, status: a.status });
}
