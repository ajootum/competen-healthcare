import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { individualAppEnabled } from "@/lib/individual/gate";
import { gatedMetadata } from "../_components/shell-context";
import type { Metadata } from "next";
import { createClient, createAdminClientOrNull } from "@/lib/supabase/server";
import { readIndividualAccess } from "@/lib/individual/access";
import { StatePanel, IndividualMark, primaryBtn, secondaryBtn } from "../_components/chrome";
import { SignOutButton } from "../_components/ShellNav";
import { EXPERIENCES } from "@/lib/individual/experiences";
import { requestedExperience, signInHref } from "@/lib/individual/entry";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// /individual/access -- WHERE GATE 3 SENDS EVERY REFUSAL (COMPETEN-IND-003 s2(7)).
//
// ⚠ IT WORKS OUT ITS OWN STATE. It takes no ?state= parameter, because a refusal page that renders
// whatever the URL says can be made to tell anybody anything. It asks the same resolver the shell asks.
//
// ⚠ EACH STATE SAYS WHAT IS TRUE. "Not set up here" (migration not applied), "could not check" (a read
// failed) and "not on this account" are three different facts. Run together, they would tell a person
// they were refused when the system simply could not answer.
//
// ⚠ ?for= NAMES THE PRODUCT, NOTHING ELSE (COMPETEN-IND-ACCESS-001 s3). A person who came from the Scholar
// website is told about Competen Scholar, and signing in returns them there. It never chooses a state.
//
// ⚠ NO SIGN-UP. Individual signup is closed by owner decision. Nothing here links to /signup or offers to
// create anything -- the pilot is by invitation.

export async function generateMetadata(): Promise<Metadata> {
  return gatedMetadata({ title: "Competen Individual access", robots: { index: false, follow: false } });
}

export default async function IndividualAccessPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The release gate first: with Individual switched off, this page does not exist either.
  await connection(); // request time only -- see src/lib/individual/guard.ts
  // OrNull: a missing service key is OFF (404), never a throwing constructor (500) -- see guard.ts.
  const admin = createAdminClientOrNull();
  if (!admin || !(await individualAppEnabled(admin))) notFound();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const asked = requestedExperience((await searchParams).for);
  const product = asked ? EXPERIENCES[asked].name : "Competen Individual";

  if (!user) {
    return (
      <Frame>
        <StatePanel title={`Sign in to ${product}`}
          actions={<><a href={signInHref(asked)} className={`${primaryBtn} bg-gray-900`}>Sign in</a><Link href="/individual" className={secondaryBtn}>About Competen Individual</Link></>}>
          <p>{product} is in pilot. If you have been invited, sign in with your Competen account.</p>
        </StatePanel>
      </Frame>
    );
  }

  const access = await readIndividualAccess(admin, user.id);
  if (access.state === "member") redirect("/individual/home");

  const about = <Link href="/individual" className={secondaryBtn}>About Competen Individual</Link>;

  if (access.state === "unavailable") {
    return (
      <Frame>
        <StatePanel tone="warning" title="We could not check your Competen Individual access"
          actions={<><Link href="/individual/home" className={`${primaryBtn} bg-gray-900`}>Try again</Link><SignOutButton /></>}>
          <p>Something went wrong while reading your access. This does not mean you have been refused, and nothing on your account has changed.</p>
        </StatePanel>
      </Frame>
    );
  }

  const copy: Record<typeof access.reason, { title: string; body: string }> = {
    not_provisioned: {
      title: "Competen Individual is not set up here yet",
      body: "This environment does not have Competen Individual switched on, so no account can use it here yet. Nothing about your own account is wrong.",
    },
    no_membership: {
      title: `${product} is not on this account`,
      body: `You are signed in, but this Competen account does not include ${product}. It is in pilot and available by invitation. If you were invited, check that you signed in with the email address the invitation went to.`,
    },
    suspended: {
      title: "Your Competen Individual access is paused",
      body: "Your membership is suspended, so the application is closed to you for now. Your Passport, profile and history are kept. Contact the person who arranged your access.",
    },
    revoked: {
      title: "Your Competen Individual access has ended",
      body: "This account no longer includes Competen Individual. Records issued to you by organisations remain part of your Competen record.",
    },
  };
  const c = copy[access.reason];

  return (
    <Frame>
      <StatePanel title={c.title} actions={<>{about}<SignOutButton /></>}>
        <p>{c.body}</p>
      </StatePanel>
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10 sm:py-16">
      <div className="mx-auto max-w-xl">
        <div className="mb-6"><IndividualMark /></div>
        {children}
      </div>
    </main>
  );
}
