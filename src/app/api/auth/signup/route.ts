import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
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

  // Use service role key to bypass RLS and write the profile with correct role
  if (data.user) {
    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    await admin.from("profiles").upsert({
      id: data.user.id,
      full_name: full_name || "New User",
      email,
      role: role || "nurse",
    }, { onConflict: "id" });
  }

  return NextResponse.json({ success: true });
}
