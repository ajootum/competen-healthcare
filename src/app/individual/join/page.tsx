import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import type { Metadata } from "next";
import { createClient, createAdminClientOrNull } from "@/lib/supabase/server";
import { JOIN_SIGN_IN, JOIN_START, selfRegistrationEnabled } from "@/lib/individual/join";
import { EXPERIENCES } from "@/lib/individual/experiences";
import { gatedMetadata } from "../_components/shell-context";
import { ExperienceMark } from "../_components/chrome";
import { JoinRegister } from "../_components/JoinForms";

// Request-time only: it reads two gates and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// /individual/join -- COMPETEN-SCHOLAR-JOIN-01, "Get Started" and "Create Account".
//
// ⚠ DARK: 404 unless individual_app AND individual_self_registration are on -- the same answer as a page that
// does not exist. Public self-registration is disabled by owner ruling pending legal confirmation.
// ⚠ A SIGNED-IN PERSON NEVER SEES A SIGN-UP FORM. They continue on the account they have (J1).

export async function generateMetadata(): Promise<Metadata> {
  return gatedMetadata({ title: "Join Competen Scholar", robots: { index: false, follow: false } });
}

export default async function JoinPage() {
  await connection();
  const admin = createAdminClientOrNull();
  if (!(await selfRegistrationEnabled(admin))) notFound();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect(JOIN_START);
  const x = EXPERIENCES.scholar;

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8 sm:py-14">
      <div className="mx-auto max-w-md">
        <div className="mb-6"><ExperienceMark wordmark={x.wordmark} accent={x.accent} /></div>
        <h1 className="text-[1.6rem] font-bold tracking-tight text-gray-900 text-balance">Study from your own notes</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-gray-700">{x.micro} Create your account, confirm your email, choose your programme, and upload your first notes.</p>
        <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 sm:p-6" aria-label="Create your account">
          <JoinRegister signInHref={JOIN_SIGN_IN} />
        </section>
        <p className="mt-5 text-[14px] text-gray-700">
          Already have a Competen account? <Link href={JOIN_SIGN_IN} className="font-semibold underline">Sign in</Link> and add Competen Scholar to it. You never need a second account.
        </p>
      </div>
    </main>
  );
}
