import { notFound, redirect } from "next/navigation";
import { EXPERIENCES } from "@/lib/individual/experiences";
import { effectivePrimary } from "@/lib/individual/access";
import { individualShell, gatedMetadata } from "../../_components/shell-context";
import type { Metadata } from "next";
import { IndividualMark, ExperienceMark } from "../../_components/chrome";
import PrimaryChoice from "../../_components/PrimaryChoice";
import { requestedExperience } from "@/lib/individual/entry";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// /individual/welcome -- ONBOARDING (COMPETEN-IND-003 s2(7)). Shown once, before any experience, to a
// member who has not finished it. It states what the account holds and asks the one question that has
// an answer only the person can give: which experience opens first. Direct entry into Professional is
// this page with Professional alone -- there is no Scholar step to skip, because nothing requires one.
//
// ⚠ ?for= IS THE EXPERIENCE THE PERSON ASKED FOR (COMPETEN-IND-ACCESS-001 s3) -- a Scholar website sign-in,
// a bookmark. When it is live for them it is preselected and the welcome continues THERE, whatever they
// choose to open first next time: an explicit request outranks the primary. When it is not live it is
// ignored, and the experience layout shows the governed not-active state if they go back to it.
//
// ⚠ IT CREATES NOTHING BUT A PREFERENCE. No identity, no Passport, no entitlement. The account the
// person signed in with IS their Competen Individual account (COMPETEN-IND-001 D4).

export async function generateMetadata(): Promise<Metadata> { return gatedMetadata({ title: "Welcome" }); }

export default async function Welcome({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const shell = await individualShell();
  if (shell.state === "DISABLED") notFound();
  if (shell.state !== "READY") redirect("/individual/access");
  const { membership, live, profile } = shell.ctx;
  if (live.length === 0) redirect("/individual/home");
  const asked = requestedExperience((await searchParams).for);
  const requested = asked && live.includes(asked) ? asked : null;
  if (membership.onboardedAt) redirect(requested ? `/individual/${requested}` : "/individual/home");
  const initial = requested ?? effectivePrimary(membership.primaryExperience, live) ?? live[0];
  // COMPETEN-SCHOLAR-JOIN-01: when the welcome continues into Scholar, its primary action is the first thing a
  // student does there -- upload their notes. The path is fixed here, never taken from the URL.
  const toScholar = requested === "scholar" || (live.length === 1 && live[0] === "scholar");
  const uploadPath = toScholar ? "/individual/scholar/study#upload" : null;
  const firstName = profile.fullName?.split(" ")[0] ?? null;

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10 sm:py-16">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8"><IndividualMark /></div>
        <h1 className="text-[1.75rem] sm:text-[2rem] font-bold tracking-tight text-gray-900 text-balance">
          {firstName ? `Welcome, ${firstName}.` : "Welcome."}
        </h1>
        <p className="mt-2 text-[15.5px] leading-relaxed text-gray-600">
          This is your Competen Individual account. It is the same Competen account you signed in with. There is nothing new to create and nothing to move.
        </p>

        <section aria-labelledby="active-h" className="mt-8">
          <h2 id="active-h" className="text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">Active on your account</h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {live.map(key => {
              const x = EXPERIENCES[key];
              return (
                <li key={key} className="rounded-2xl border border-gray-200 bg-white p-5">
                  <ExperienceMark wordmark={x.wordmark} accent={x.accent} size="sm" />
                  <p className="mt-3 text-[14px] text-gray-700">{x.micro}</p>
                  <p className="mt-1 text-[12.5px] font-semibold" style={{ color: x.accent }}>{x.tagline}</p>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 text-[13.5px] leading-relaxed text-gray-600">
            Both experiences share one Competen Passport, one profile and history, and one personal AI.
            {live.length === 1 ? " If another experience is added to your account later, it joins this same account." : ""}
          </p>
        </section>

        <section className="mt-8 rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
          <PrimaryChoice live={live} initial={initial} completeOnboarding continueTo={requested} continuePath={uploadPath}
            submitLabel={uploadPath ? "Upload my notes" : requested ? `Continue to ${EXPERIENCES[requested].name}` : live.length > 1 ? "Continue" : `Continue to ${EXPERIENCES[live[0]].name}`} />
        </section>
      </div>
    </main>
  );
}
