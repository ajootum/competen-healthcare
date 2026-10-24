import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import type { Metadata } from "next";
import { createClient, createAdminClientOrNull } from "@/lib/supabase/server";
import { JOIN_SIGN_IN, SCHOLAR_ELIGIBILITY, selfRegistrationEnabled } from "@/lib/individual/join";
import { readIndividualAccess } from "@/lib/individual/access";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { loadJoinOptions } from "@/lib/individual/scholar/context";
import { EXPERIENCES } from "@/lib/individual/experiences";
import { gatedMetadata } from "../../_components/shell-context";
import { ExperienceMark, StatePanel, secondaryBtn } from "../../_components/chrome";
import { SignOutButton } from "../../_components/ShellNav";
import { JoinActivate } from "../../_components/JoinForms";

// Request-time only: it reads two gates and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// /individual/join/start -- COMPETEN-SCHOLAR-JOIN-01, "Educational Context" and "Activate Scholar", for a
// verified, signed-in person: a new account returning from its confirmation email (J2), or an existing
// Competen or Individual account adding Scholar to itself (J1). Writes happen in /api/individual/join/activate.
//
// ⚠ DARK: 404 unless individual_app AND individual_self_registration are on.
// ⚠ EACH STATE SAYS WHAT IS TRUE: not signed in, email not confirmed, Scholar already active, membership
// paused or ended, programmes not readable, and none offered are different facts and read differently.

export async function generateMetadata(): Promise<Metadata> {
  return gatedMetadata({ title: "Activate Competen Scholar", robots: { index: false, follow: false } });
}

export default async function JoinStartPage() {
  await connection();
  const admin = createAdminClientOrNull();
  if (!admin || !(await selfRegistrationEnabled(admin))) notFound();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(JOIN_SIGN_IN);

  if (!user.email_confirmed_at) {
    return <Frame><StatePanel title="Confirm your email first" actions={<SignOutButton />}>
      <p>Open the link we sent to {user.email ?? "your email address"} to confirm it, then come back here.</p>
    </StatePanel></Frame>;
  }

  const access = await readIndividualAccess(admin, user.id);
  if (access.state === "member" && access.live.includes("scholar")) redirect("/individual/scholar/study");
  if (access.state === "unavailable") {
    return <Frame><StatePanel tone="warning" title="We could not check your account just now" actions={<Link href="/individual/join/start" className={secondaryBtn}>Try again</Link>}>
      <p>This does not mean anything is wrong with your account, and nothing has changed.</p>
    </StatePanel></Frame>;
  }
  if (access.state === "none" && (access.reason === "suspended" || access.reason === "revoked")) {
    return <Frame><StatePanel title={access.reason === "suspended" ? "Your Competen Individual access is paused" : "Your Competen Individual access has ended"} actions={<SignOutButton />}>
      <p>Competen Scholar cannot be added while your membership is {access.reason}. Contact the person who arranged your access.</p>
    </StatePanel></Frame>;
  }

  const opts = await loadJoinOptions(admin, await loadIndividualPolicy(admin));
  if (!opts.ok) {
    return <Frame><StatePanel tone="warning" title={opts.notProvisioned ? "Competen Scholar is not set up here yet" : "We could not load the programmes just now"}
      actions={<Link href="/individual/join/start" className={secondaryBtn}>Try again</Link>}>
      <p>{opts.notProvisioned ? "This environment has no Scholar programmes yet. Nothing about your account is wrong." : "Nothing has changed on your account. Try again shortly."}</p>
    </StatePanel></Frame>;
  }
  if (opts.options.programmes.length === 0) {
    return <Frame><StatePanel title="No programme is open to join yet" actions={<SignOutButton />}>
      <p>Competen has not opened any study programme for joining yet. Your account is ready, and you can come back when one is.</p>
    </StatePanel></Frame>;
  }

  const { data: current } = await admin.from("individual_scholar_learner")
    .select("programme_code, level_code, institution_code").eq("user_id", user.id).maybeSingle();

  return (
    <Frame>
      <section className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
        <JoinActivate programmes={opts.options.programmes} institutions={opts.options.institutions}
          initial={{ programme: current?.programme_code ?? null, level: current?.level_code ?? null, institution: current?.institution_code ?? null }}
          policyVersion={SCHOLAR_ELIGIBILITY.policyVersion} statement={SCHOLAR_ELIGIBILITY.statement} />
      </section>
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  const x = EXPERIENCES.scholar;
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8 sm:py-14">
      <div className="mx-auto max-w-md">
        <div className="mb-6"><ExperienceMark wordmark={x.wordmark} accent={x.accent} /></div>
        {children}
      </div>
    </main>
  );
}
