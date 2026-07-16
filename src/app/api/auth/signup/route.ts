import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

// Public self-registration. Privileged roles (hospital_admin, super_admin)
// are assigned by administrators in All Users — never via public signup.
const PUBLIC_ROLES = ["nurse", "assessor", "educator"];

export async function POST(request: Request) {
  const { email, password, full_name, role } = await request.json();

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }
  if (String(password).length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }
  const safeRole = PUBLIC_ROLES.includes(role) ? role : "nurse";

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name, role: safeRole } },
  });

  if (error) {
    return NextResponse.json({ error: error.message || "Sign up failed" }, { status: 400 });
  }

  // Service role bypasses RLS to write the profile with the validated role
  if (data.user) {
    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    await admin.from("profiles").upsert({
      id: data.user.id,
      full_name: full_name || "New User",
      email,
      role: safeRole,
    }, { onConflict: "id" });
  }

  // No session ⇒ Supabase email confirmation is enabled — user must verify first
  return NextResponse.json({ success: true, role: safeRole, needsConfirmation: !data.session });
}
