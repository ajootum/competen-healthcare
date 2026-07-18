import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ROLE_CONFIG, type AppRole } from "@/lib/roles";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { role } = await req.json() as { role: AppRole };
  if (!role || !ROLE_CONFIG[role]) return NextResponse.json({ error: "Invalid role" }, { status: 400 });

  const { data: profile } = await createAdminClient()
    .from("profiles")
    .select("role, roles")
    .eq("id", user.id)
    .single();

  const userRoles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean) as string[];
  if (!userRoles.includes(role)) {
    return NextResponse.json({ error: "You do not have this role" }, { status: 403 });
  }

  const cookieStore = await cookies();
  cookieStore.set("active_role", role, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });

  return NextResponse.json({ redirect: ROLE_CONFIG[role].portal });
}
