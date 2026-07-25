import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { requestBreakGlass, listActiveGrants, revokeGrant } from "@/lib/orchestration/break-glass";

// PW-014 §4, §15 / PW-AC-10 — break-glass emergency access. POST invokes a time-boxed, reasoned, audited grant;
// GET lists the caller's active grants; DELETE ?id= revokes one. Accountability (mandatory reason + hard expiry +
// audit + domain event) is the control — access is never elevated silently. Own-scope: a user manages only their
// own grants.
/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient() as any;
  return NextResponse.json({ grants: await listActiveGrants(admin, user.id) });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient() as any;
  const b = await req.json().catch(() => ({}));

  const r = await requestBreakGlass(admin, user.id, { reason: b.reason, targetType: b.targetType, targetRef: b.targetRef, scope: b.scope, minutes: b.minutes });
  if (r.ok) return NextResponse.json(r.grant, { status: 201 });
  if (r.reason === "invalid_reason") return NextResponse.json({ error: "A clear reason (min 8 chars) is required to invoke break-glass." }, { status: 400 });
  if (r.reason === "not_provisioned") return NextResponse.json({ error: "Break-glass not provisioned — run migration 104." }, { status: 409 });
  return NextResponse.json({ error: r.reason }, { status: 500 });
}

export async function DELETE(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient() as any;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const ok = await revokeGrant(admin, id, user.id);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "No active grant to revoke" }, { status: 404 });
}
