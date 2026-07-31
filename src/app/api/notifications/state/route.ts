import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { canTransition, escalationDue, type NotifState } from "@/lib/notifications/framework";

// Notification state transitions (PUI-006 s7) — migration 161.
//
// A user acts only on their OWN notifications. That is enforced by matching user_id on every update, not by
// trusting an id from the request body, so one user can never acknowledge an alert addressed to another —
// which for a critical clinical alert would be a clinical safety issue, not just an access-control one.
//
// READING IS NOT ACKNOWLEDGING. Marking read never satisfies an acknowledgement requirement; the two are
// separate transitions and a critical alert stays outstanding until explicitly acknowledged.
/* eslint-disable @typescript-eslint/no-explicit-any */

const missing = (e: any) => /column|does not exist|schema cache/i.test(String(e?.message ?? ""));

export async function PATCH(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const b = await req.json().catch(() => ({}));
  const to = String(b?.state ?? "") as NotifState;
  const ids: string[] = Array.isArray(b?.ids) ? b.ids.filter(Boolean) : b?.id ? [b.id] : [];
  if (!ids.length) return NextResponse.json({ error: "id or ids required" }, { status: 400 });
  if (!["read", "acknowledged", "resolved"].includes(to)) {
    return NextResponse.json({ error: "state must be one of: read, acknowledged, resolved" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: rows, error } = await admin.from("notifications")
    .select("id, user_id, state, requires_ack, priority")
    .in("id", ids).eq("user_id", user.id);
  if (error) {
    return NextResponse.json(
      { error: missing(error) ? "Apply migration 161 to enable the notification framework." : error.message },
      { status: missing(error) ? 503 : 500 },
    );
  }
  if (!rows?.length) return NextResponse.json({ error: "No matching notifications" }, { status: 404 });

  const now = new Date().toISOString();
  const applied: string[] = [];
  const rejected: { id: string; reason: string }[] = [];

  for (const r of rows as any[]) {
    const from = (r.state ?? "unread") as NotifState;
    if (from === to) { applied.push(r.id); continue; }
    if (!canTransition(from, to)) { rejected.push({ id: r.id, reason: `cannot go from ${from} to ${to}` }); continue; }

    const patch: any = { state: to };
    // `read` is kept consistent with the state machine by this write path, not by a trigger — every state
    // past unread has been seen.
    if (to !== "unread") patch.read = true;
    if (to === "acknowledged") { patch.acknowledged_at = now; patch.acknowledged_by = user.id; }
    if (to === "resolved") patch.resolved_at = now;

    const { error: upErr } = await admin.from("notifications").update(patch).eq("id", r.id).eq("user_id", user.id);
    if (upErr) rejected.push({ id: r.id, reason: upErr.message });
    else applied.push(r.id);
  }

  return NextResponse.json({ applied, rejected });
}

// Outstanding acknowledgements + anything now past its escalation window. The banner and the notification
// centre both read this, so "what still needs me" has one answer.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin.from("notifications")
    .select("id, type, title, body, href, category, priority, state, requires_ack, escalate_after_min, created_at")
    .eq("user_id", user.id).eq("requires_ack", true)
    .not("state", "in", "(acknowledged,resolved)")
    .order("created_at", { ascending: true }).limit(50);

  if (error) {
    return NextResponse.json(
      missing(error) ? { outstanding: [], overdue: [], provisioned: false } : { error: error.message },
      { status: missing(error) ? 200 : 500 },
    );
  }

  const rows = (data ?? []) as any[];
  return NextResponse.json({
    provisioned: true,
    outstanding: rows,
    overdue: rows.filter(r => escalationDue(r)),
  });
}
