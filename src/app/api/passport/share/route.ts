import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { randomBytes } from "crypto";

// COMP-023 Passport Verification & Sharing — a worker mints/revokes a consented, time-limited share link to
// their OWN passport. Self-service (auth = the worker); the token is cryptographically random and unguessable.
/* eslint-disable @typescript-eslint/no-explicit-any */

const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migration 122 to enable passport sharing" }, { status: 409 }) : null;

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("hospital_id").eq("id", user.id).single();

  const b = await req.json().catch(() => ({}));
  const scope = ["summary", "full"].includes(b.scope) ? b.scope : "summary";
  const label = typeof b.label === "string" && b.label.trim() ? b.label.trim().slice(0, 120) : null;
  const days = Number.isFinite(+b.expires_in_days) ? Math.min(365, Math.max(1, Math.floor(+b.expires_in_days))) : 30;
  const token = randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + days * 86400000).toISOString();

  const { data, error } = await admin.from("passport_share_tokens").insert({
    token, nurse_id: user.id, hospital_id: profile?.hospital_id ?? null, scope, label, expires_at: expiresAt, consent: true, revoked: false,
  }).select("id, token, scope, expires_at").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("audit_log").insert({ actor_id: user.id, action: "create_passport_share", entity_type: "passport_share_token", entity_id: data.id, hospital_id: profile?.hospital_id ?? null, new_value: { scope, expires_at: expiresAt } }).then((r: any) => r, () => {});
  return NextResponse.json({ id: data.id, token: data.token, path: `/verify/${data.token}`, scope: data.scope, expires_at: data.expires_at }, { status: 201 });
}

export async function PATCH(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient() as any;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  // Self-scoped: the compound match means a row that isn't the caller's own updates 0 rows → 404.
  const { data, error } = await admin.from("passport_share_tokens").update({ revoked: true }).eq("id", id).eq("nurse_id", user.id).select("id").maybeSingle();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await admin.from("audit_log").insert({ actor_id: user.id, action: "revoke_passport_share", entity_type: "passport_share_token", entity_id: id }).then((r: any) => r, () => {});
  return NextResponse.json({ ok: true });
}
