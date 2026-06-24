import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { email, password, full_name, role } = await request.json();
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name, role } },
  });

  if (error) {
    console.error("Supabase signup error:", JSON.stringify(error));
    return NextResponse.json({ error: error.message || error.code || JSON.stringify(error) }, { status: 400 });
  }

  // Explicitly upsert profile — trigger may not always fire with metadata
  if (data.user) {
    await supabase.from("profiles").upsert({
      id: data.user.id,
      full_name: full_name || "New User",
      email,
      role: role || "nurse",
    }, { onConflict: "id" });
  }

  return NextResponse.json({ success: true });
}
