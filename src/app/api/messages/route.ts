import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { notify } from "@/lib/notify";

// One-way messaging over the notifications system (Conduct Assessment
// "Communication" panel). Delivers a message notification to a specific user
// in your hospital, or to all hospital educators. Full two-way threads are a
// separate future module — this is deliberately notification-backed.
// Body: { recipient_id?, to_educators?, text }
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles").select("full_name, role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = me?.roles?.length ? me.roles : [me?.role].filter(Boolean) as string[];

  const { recipient_id, to_educators, text } = await req.json().catch(() => ({}));
  const body = typeof text === "string" ? text.trim() : "";
  if (!body || body.length > 1000) {
    return NextResponse.json({ error: "text is required (max 1000 characters)" }, { status: 400 });
  }

  let recipients: string[] = [];
  if (to_educators === true) {
    if (!me?.hospital_id) return NextResponse.json({ error: "No facility assigned" }, { status: 400 });
    const { data: educators } = await admin.from("profiles")
      .select("id").eq("hospital_id", me.hospital_id).eq("role", "educator").neq("id", user.id).limit(50);
    recipients = (educators ?? []).map(e => e.id);
    if (!recipients.length) return NextResponse.json({ error: "No educators found in your hospital" }, { status: 404 });
  } else if (typeof recipient_id === "string" && recipient_id) {
    if (recipient_id === user.id) return NextResponse.json({ error: "You cannot message yourself" }, { status: 400 });
    const { data: target } = await admin.from("profiles").select("id, hospital_id").eq("id", recipient_id).single();
    if (!target) return NextResponse.json({ error: "Recipient not found" }, { status: 404 });
    if (target.hospital_id !== me?.hospital_id && !roles.includes("super_admin")) {
      return NextResponse.json({ error: "You can only message people in your hospital" }, { status: 403 });
    }
    recipients = [target.id];
  } else {
    return NextResponse.json({ error: "recipient_id or to_educators is required" }, { status: 400 });
  }

  await notify(recipients, {
    type: "message",
    title: `Message from ${me?.full_name ?? "a colleague"}`,
    body,
  });
  await admin.from("audit_log").insert({
    actor_id: user.id, actor_name: me?.full_name ?? null,
    action: "send_message", entity_type: "profile",
    entity_id: recipients.length === 1 ? recipients[0] : null,
    new_value: { recipients: recipients.length, chars: body.length },
  });

  return NextResponse.json({ ok: true, recipients: recipients.length });
}
