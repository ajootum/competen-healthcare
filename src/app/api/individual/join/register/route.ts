import { NextResponse, connection } from "next/server";
import { createClient, createAdminClientOrNull } from "@/lib/supabase/server";
import { JOIN_START, isJoinRefusal, registerForScholar, selfRegistrationEnabled, validateRegistration } from "@/lib/individual/join";

// Request-time only: it reads two gates and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// POST /api/individual/join/register -- COMPETEN-SCHOLAR-JOIN-01 J2, "Create Account". Body: { fullName, email,
// password }. Creates the identity through Supabase auth sign-up with email confirmation, and nothing else:
// no membership, no entitlement, no context. Those are made after the person returns verified (activate).
//
// ⚠ DARK: 404 before the body is read unless individual_app AND individual_self_registration are on.
// ⚠ ONE IDENTITY: a signed-in caller is sent to activate on the account they have; an existing email is
// offered sign-in. A second account is never made.

const refuse = (status: number, code: string, message: string, nextUrl?: string) =>
  NextResponse.json({ error: { code, message }, ...(nextUrl ? { nextUrl } : {}) }, { status });

export async function POST(req: Request) {
  await connection();
  const admin = createAdminClientOrNull();
  if (!(await selfRegistrationEnabled(admin))) return refuse(404, "NOT_FOUND", "Not found");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) return refuse(409, "ALREADY_AUTHENTICATED", "You are already signed in. Add Competen Scholar to this account.", JOIN_START);

  const input = validateRegistration(await req.json().catch(() => ({})));
  if (isJoinRefusal(input)) return refuse(input.status, input.code, input.message);

  const out = await registerForScholar(supabase, admin, input, process.env.NEXT_PUBLIC_SITE_URL ?? null);
  if (!out.ok) return refuse(out.status, out.code, out.message, out.nextUrl);

  await admin!.from("audit_log").insert({
    actor_id: out.userId, action: "individual_join_registered", entity_type: "profiles", entity_id: out.userId,
    new_value: { verified: out.verified },
  }).then((r: unknown) => r, () => {});

  return NextResponse.json(out.verified
    ? { status: "REGISTERED", nextUrl: JOIN_START }
    : { status: "VERIFY_EMAIL", message: "Check your email and open the link to confirm your address. Then sign in to continue." }, { status: 202 });
}
