import { createClient, createAdminClient } from "@/lib/supabase/server";
import { createClient as createBareClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

// Password change. Supabase's updateUser doesn't check the old password, so we
// verify it first with a throwaway sign-in (never persisted) — wrong current
// password is rejected instead of silently allowing a takeover from a stolen
// session.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { current_password, new_password } = await req.json().catch(() => ({}));
  if (!current_password || !new_password) {
    return NextResponse.json({ error: "current_password and new_password are required" }, { status: 400 });
  }
  if (String(new_password).length < 8) {
    return NextResponse.json({ error: "New password must be at least 8 characters" }, { status: 400 });
  }
  if (new_password === current_password) {
    return NextResponse.json({ error: "New password must be different from the current one" }, { status: 400 });
  }

  const probe = createBareClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error: verifyErr } = await probe.auth.signInWithPassword({ email: user.email, password: current_password });
  if (verifyErr) return NextResponse.json({ error: "Current password is incorrect" }, { status: 403 });

  const { error } = await supabase.auth.updateUser({ password: new_password });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await createAdminClient().from("audit_log").insert({
    actor_id: user.id, actor_name: null,
    action: "change_password", entity_type: "account", entity_id: user.id, entity_name: user.email,
  });
  return NextResponse.json({ ok: true });
}
