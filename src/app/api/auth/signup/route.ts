import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { grantPlatformMembership } from "@/lib/platform-membership";
import { platformFlag } from "@/lib/practice/provisioning";

// Public self-registration. Privileged roles (hospital_admin, super_admin)
// are assigned by administrators in All Users — never via public signup.
const PUBLIC_ROLES = ["nurse", "assessor", "educator"];

export async function POST(request: Request) {
  // ⚠ THE FLAG GATES THE ENDPOINT AS WELL AS THE PAGE -- Practice's own rule, mirrored: "route
  // protection must exist on the server/API, not only in the client". A page that hides the form while
  // the endpoint still registers anybody who POSTs is a gate painted on the door. platformFlag is
  // fail-closed (absent row = OFF), and estate_public_signup has never been written, which is the truth.
  if (!(await platformFlag(
    createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!),
    "estate_public_signup",
  )))
    return NextResponse.json(
      { error: "Signup is not open yet. Competen accounts are set up with us directly for now." },
      { status: 403 },
    );

  const { email, password, full_name, role } = await request.json();

  // A REGISTRATION ENDPOINT MUST NOT MUTATE THE CALLER'S SESSION.
  //
  // supabase.auth.signUp() runs on the request's cookie-bound client, and when email confirmation is off
  // it returns a session that @supabase/ssr writes straight into those cookies -- silently replacing
  // whoever was signed in. One session cookie exists per origin, so this is not a tab-level surprise: it
  // logs the person out of their real account everywhere and hands them the new one. An administrator who
  // creates an account for a colleague would find themselves signed in AS that colleague.
  //
  // Refused rather than worked around. Creating a user without touching the caller's cookies needs
  // auth.admin.createUser (service role), which is the right primitive for an admin-made account and is
  // a different feature with its own authorisation; self-registration is for people who are not signed in.
  const supabase = await createClient();
  const { data: { user: existingSession } } = await supabase.auth.getUser();
  if (existingSession) {
    return NextResponse.json({
      error: "You are already signed in. Sign out first to create a different account.",
      code: "ALREADY_AUTHENTICATED",
    }, { status: 409 });
  }

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }
  if (String(password).length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }
  const safeRole = PUBLIC_ROLES.includes(role) ? role : "nurse";

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

    // ════════════════════════════════════════════════════════════════════════════════════════════════
    // !! GATE 1 IS NOW EXPLICIT, SO THIS IS WHERE IT IS OPENED. CP-SPLIT-002 stage 3.
    //
    // This route IS the "separate, explicitly initiated Competen Platform workflow" that
    // COMP-ARCH-PSA-001 s11 requires before an identity gets Platform membership -- somebody filling in
    // the estate's own signup form. Migration 279 backfilled every identity that existed on the day it
    // was applied. Without this line, everybody who signs up AFTER it would hold a role and be refused
    // by all eleven estate layouts, which is the lockout direction and the worse of the two failures.
    //
    // TWO WRITES, NOT ONE, AND THEY ARE NOT DERIVED FROM EACH OTHER. The role above is authorization.
    // The membership here is belonging. grantPlatformMembership touches no role column and nothing that
    // sets a role calls it implicitly.
    //
    // !! A FAILURE HERE IS LOUD BUT NOT FATAL, AND THE ORDER OF THOSE TWO WORDS MATTERS.
    // Not fatal, because migration 279 is applied BY HAND and may not be applied yet -- rolling the
    // signup back on a missing table would break estate registration for everybody until the owner runs
    // the SQL, and the estate gate admits on an unreadable store precisely so that window is harmless.
    // Loud, because once the table DOES exist a silently failed grant is an account that can sign in and
    // reach nothing. It is returned to the caller and logged rather than swallowed.
    // ════════════════════════════════════════════════════════════════════════════════════════════════
    const membership = await grantPlatformMembership(admin, data.user.id, {
      source: "platform_signup",
      note: "Competen Platform self-registration",
    });
    if (!membership.ok) {
      console.error(`[platform-membership] GRANT FAILED for ${data.user.id} at estate signup: ${membership.error}`);
      return NextResponse.json({
        success: true, role: safeRole, needsConfirmation: !data.session,
        platformMembershipWarning: membership.error,
      });
    }
  }

  // No session ⇒ Supabase email confirmation is enabled — user must verify first
  return NextResponse.json({ success: true, role: safeRole, needsConfirmation: !data.session });
}
