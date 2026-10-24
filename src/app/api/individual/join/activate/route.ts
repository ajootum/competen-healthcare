import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireIndividualSession, isSessionRefusal } from "@/lib/individual/guard";
import { readIndividualAccess } from "@/lib/individual/access";
import { activateScholar, isJoinRefusal, selfRegistrationEnabled, validateDeclaration } from "@/lib/individual/join";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { loadJoinOptions, validateContextChoice } from "@/lib/individual/scholar/context";

// Request-time only: it reads two gates and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// POST /api/individual/join/activate -- COMPETEN-SCHOLAR-JOIN-01 J1-J3, "Educational Context" and "Activate
// Scholar". Body: { programme, level?, institution?, adultDeclaration: true, policyVersion }.
//
// ⚠ ORDER: release gate, session (requireIndividualSession, because a person joining holds no membership
// yet), then individual_self_registration -- 404 while it is off, before the body is read. Then a confirmed
// email, then the person's current access: an active Scholar is not activated twice, and a suspended or
// revoked membership is refused. Only then the declaration and the context are checked and written.

const refuse = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status });

export async function POST(req: Request) {
  const s = await requireIndividualSession();
  if (isSessionRefusal(s)) return s;
  if (!(await selfRegistrationEnabled(s.admin))) return refuse(404, "NOT_FOUND", "Not found");
  if (!s.emailConfirmedAt) return refuse(403, "EMAIL_UNCONFIRMED", "Confirm your email address first. Open the link we sent you.");

  const access = await readIndividualAccess(s.admin, s.userId);
  if (access.state === "unavailable") return refuse(503, "UNAVAILABLE", "Your access could not be checked just now. Try again shortly.");
  if (access.state === "none" && (access.reason === "suspended" || access.reason === "revoked"))
    return refuse(409, "MEMBERSHIP_NOT_ACTIVE", `Your Competen Individual membership is ${access.reason}.`);
  if (access.state === "member" && access.live.includes("scholar"))
    return NextResponse.json({ ok: true, alreadyLive: true, next: "/individual/scholar/study" });

  const body = await req.json().catch(() => ({}));
  const declared = validateDeclaration(body);
  if (isJoinRefusal(declared)) return refuse(declared.status, declared.code, declared.message);

  const opts = await loadJoinOptions(s.admin, await loadIndividualPolicy(s.admin));
  if (!opts.ok) return refuse(503, "UNAVAILABLE", "The programmes could not be read just now. Try again shortly.");
  const choice = validateContextChoice(opts.options, body);
  if (!choice.ok) return refuse(422, "CONTEXT_REQUIRED", choice.error);

  // Which way the person came in, for the declaration source: the join registration marks its own identities.
  const { data: { user } } = await (await createClient()).auth.getUser();
  const out = await activateScholar(s.admin, {
    userId: s.userId, choice: choice.choice,
    viaRegistration: user?.user_metadata?.competen_join === "scholar",
    onboarded: access.state === "member" && !!access.membership.onboardedAt,
  });
  if (!out.ok) return refuse(out.status, out.code, out.message);
  return NextResponse.json({ ok: true, alreadyLive: out.alreadyLive, membership: out.membership, next: out.next });
}
