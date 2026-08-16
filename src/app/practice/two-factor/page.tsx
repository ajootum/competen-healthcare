import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import TwoFactorConsole from "./TwoFactorConsole";

// /practice/two-factor -- COMP-AUTH-001, the MFA ENROLMENT AND STEP-UP SCREEN (survey s6.3 / s7
// item 9, the STRICT-ORDER precondition: this page exists BEFORE any fail-closed behaviour, because
// a requirement nobody can satisfy is a lockout, not a control).
//
// ⚠ DELIBERATELY OUTSIDE THE (shell) GROUP. The person who needs this page is exactly the person the
// shell is refusing (MFA_REQUIRED), so a guard that demands a READY workspace would lock the door
// and point at it. The only requirement here is a signed-in Competen account -- two-factor lives on
// the ACCOUNT, which is also why this page never reads a workspace.
//
// Until today, access-status told the truth the hard way: "this product has no screen that sets one
// up." This is that screen, and those sentences now route here.

export const dynamic = "force-dynamic";

export default async function TwoFactorPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/practice/sign-in?return_to=/practice/two-factor");

  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <h1 className="text-xl font-bold text-gray-900">Two-factor authentication</h1>
      <p className="mt-1 text-[13px] leading-relaxed text-gray-500">
        A second factor lives on your Competen account and covers every practice you work in. An
        authenticator app (any TOTP app) generates the codes; this product never sees the secret
        after setup and cannot recover it for you.
      </p>
      <div className="mt-5">
        <TwoFactorConsole />
      </div>
    </div>
  );
}
