import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// PW-005 Messaging — nurse-accessible channel send/list over op_messages (the /api/operations/messages route is
// supervisor-tier only; /api/messages is the separate notification-backed one-way messaging). Any authenticated
// user may read + post within THEIR OWN hospital. hospital_id and author come from the caller's profile, never
// the client. Two-way channel messaging; read-state, reactions, threads and scheduled sends aren't backed yet.
/* eslint-disable @typescript-eslint/no-explicit-any */
const CONTEXTS = ["team", "patient", "task", "direct", "general"];

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient() as any;
  const { data: me } = await admin.from("profiles").select("hospital_id").eq("id", user.id).single();
  if (!me?.hospital_id) return NextResponse.json({ messages: [] });
  const channel = new URL(req.url).searchParams.get("channel");
  let q = admin.from("op_messages").select("id, channel, context_type, body, author_id, author_name, created_at").eq("hospital_id", me.hospital_id).order("created_at", { ascending: false }).limit(100);
  if (channel) q = q.eq("channel", channel);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ messages: data ?? [] });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient() as any;
  const { data: me } = await admin.from("profiles").select("full_name, hospital_id").eq("id", user.id).single();
  if (!me?.hospital_id) return NextResponse.json({ error: "No facility assigned" }, { status: 400 });

  const b = await req.json().catch(() => ({}));
  const body = String(b.body ?? "").trim();
  if (!body) return NextResponse.json({ error: "Message body is required" }, { status: 400 });
  if (body.length > 2000) return NextResponse.json({ error: "Message too long (max 2000 characters)" }, { status: 400 });
  const channel = String(b.channel ?? "General").trim().slice(0, 80) || "General";
  const context_type = CONTEXTS.includes(b.context_type) ? b.context_type : "team";

  const { data, error } = await admin.from("op_messages").insert({
    hospital_id: me.hospital_id, channel, context_type, body, author_id: user.id, author_name: me.full_name ?? null,
  }).select("id, channel").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
