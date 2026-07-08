import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { email, password } = await request.json();
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const { data: { user } } = await supabase.auth.getUser();
  // Use admin client to bypass RLS (avoids infinite recursion in profiles policies)
  const admin = createAdminClient();
  const { data: profile } = user
    ? await admin.from("profiles").select("role").eq("id", user.id).single()
    : { data: null };

  return NextResponse.json({ success: true, role: profile?.role ?? "nurse" });
}
