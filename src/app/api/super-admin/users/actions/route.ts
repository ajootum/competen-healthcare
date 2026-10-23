import { NextResponse } from "next/server";
import { hqOwnerApiGate, isHqRefusal } from "@/lib/hq/api-gate";

import { currentTraceId } from "@/lib/trace";
import { SITE_URL } from "@/lib/marketing/site";
// Account-level actions on a user (distinct from role assignment, which is the
// PATCH on ../route.ts). Suspension uses Supabase Auth's ban mechanism so the
// user genuinely cannot sign in — not just a status flag.

// HQ-USERS-B: "send_reset" is no longer here. It moved to POST ./reset (hq.platform.users.reset), the one
// governed path with its rate limit, owner-account rule and neutral answer, so there is no second door.
type Action = "suspend" | "unsuspend" | "resend_invite";

// HQ-USERS-A: still OWNER-ONLY, now decided by the HQ gate (roles[] and platform_owner) instead of the
// single legacy profiles.role column. Viewing users (hq.platform.users.view) does not open these.
export async function POST(req: Request) {
  const ctx = await hqOwnerApiGate(["hq.platform.users.view"]);
  if (isHqRefusal(ctx)) return ctx;
  const admin = ctx.admin;
  const user = { id: ctx.userId };
  const me = { full_name: ctx.fullName };

  const { userId, action }: { userId: string; action: Action } = await req.json();
  if (!userId || !["suspend", "unsuspend", "resend_invite"].includes(action)) {
    return NextResponse.json({ error: "userId and a valid action are required" }, { status: 400 });
  }
  if (userId === user.id && action === "suspend") {
    return NextResponse.json({ error: "You cannot suspend your own account" }, { status: 400 });
  }

  const { data: target } = await admin.from("profiles").select("full_name, email").eq("id", userId).single();
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  if (action === "resend_invite") {
    // A fresh invite fails once the auth user exists, so fall back to a
    // recovery email — it equally lets an invited user set their password.
    // The configured origin, never the request's (HQ-USERS-B): a Host header cannot steer the link.
    const origin = SITE_URL;
    const { error: ierr } = await admin.auth.admin.inviteUserByEmail(target.email, {
      redirectTo: `${origin}/reset-password`,
    });
    if (ierr) {
      const { error } = await admin.auth.resetPasswordForEmail(target.email, {
        redirectTo: `${origin}/reset-password`,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
  } else {
    // "none" lifts the ban; 100 years is the practical "until reactivated"
    const { error } = await admin.auth.admin.updateUserById(userId, {
      ban_duration: action === "suspend" ? "876000h" : "none",
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await admin.from("audit_log").insert({ trace_id: await currentTraceId(),
    actor_id: user.id,
    actor_name: me.full_name,
    action: action === "resend_invite" ? "resend_invitation"
      : action === "suspend" ? "suspend_user" : "reactivate_user",
    entity_type: "user",
    entity_id: userId,
    entity_name: target.full_name,
  });

  return NextResponse.json({ success: true });
}
