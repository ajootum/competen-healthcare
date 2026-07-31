import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// UMW-TLS-005 saved workspace views. A view is a named route plus its filters — the thing a manager returns
// to every morning. Own-rows only: user_id comes from the session, and DELETE re-checks ownership rather than
// trusting an id from the body.
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = "force-dynamic";

const ROUTE_OK = (r: string) => /^\/[A-Za-z0-9\-_/?=&.%]*$/.test(r) && !r.startsWith("//") && r.length <= 300;

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient() as any;

  const body = await req.json().catch(() => ({}));
  const name = String(body?.name ?? "").trim();
  const route = String(body?.route ?? "").trim();
  const workspace = String(body?.workspace ?? "unit-manager");
  const isDefault = body?.isDefault === true;
  if (!name || name.length > 60) return NextResponse.json({ error: "A view needs a name of 60 characters or fewer." }, { status: 400 });
  // Relative in-app paths only. An absolute URL here would turn a saved view into an open redirect.
  if (!ROUTE_OK(route)) return NextResponse.json({ error: "A view must point at a path inside this application." }, { status: 400 });

  // At most one default per workspace — enforced by a partial unique index, so the old default has to be
  // stood down first or the insert would violate it.
  if (isDefault) await admin.from("user_saved_views").update({ is_default: false }).eq("user_id", user.id).eq("workspace", workspace);

  const { data, error } = await admin.from("user_saved_views").insert([{
    user_id: user.id, workspace, name, route, filters: body?.filters ?? {}, is_default: isDefault,
  }]).select("id, name, route, is_default").single();
  if (error) return NextResponse.json({ error: error.message }, { status: error.message.includes("does not exist") ? 503 : 500 });
  return NextResponse.json({ ok: true, view: data });
}

export async function DELETE(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient() as any;
  const id = String((await req.json().catch(() => ({})))?.id ?? "");
  if (!id) return NextResponse.json({ error: "Missing view id." }, { status: 400 });

  // Scoped by user_id as well as id: an id alone must never be enough to delete someone else's view.
  const { data, error } = await admin.from("user_saved_views").delete().eq("id", id).eq("user_id", user.id).select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "View not found." }, { status: 404 });
  return NextResponse.json({ ok: true, deleted: id });
}
