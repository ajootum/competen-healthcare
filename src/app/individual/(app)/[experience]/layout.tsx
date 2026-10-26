import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { EXPERIENCES, experienceHref, isExperienceKey } from "@/lib/individual/experiences";
import { individualShell, gatedMetadata } from "../../_components/shell-context";
import { ExperienceMark, ExperienceSwitcher, StatePanel, focusRing, secondaryBtn } from "../../_components/chrome";
import { SidebarNav, BottomNav, AccountMenu, SignOutButton } from "../../_components/ShellNav";
// HFE-01 D1: AccountMenu is the one account menu on phone and desktop (every destination the bottom bar cannot hold).
import TermsAcceptance, { type ShownDoc } from "../../_components/TermsAcceptance";
import { contextTermsGate } from "@/lib/individual/guard";
import { publishedVersions } from "@/lib/individual/legal";
import { experienceOfPath, forQuery, isIndividualNext, signInHref } from "@/lib/individual/entry";
import { headers } from "next/headers";
import { JOIN_START, selfRegistrationEnabled } from "@/lib/individual/join";
import { learningEnabled } from "@/lib/learning/policy";
import { ShellActionProvider } from "../../_components/Dialog";
import { AiHelpSwitch, JourneyButton } from "./(scholar)/study/_components/shell-pieces";
import { getAiStanding } from "@/lib/ai/allowance";
import { AiAvailabilityProvider } from "../../_components/ai/AiAvailabilityContext";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// ── AN EXPERIENCE SHELL: /individual/scholar/** or /individual/professional/** ── COMPETEN-IND-003 s3 ──
//
// One layout for both experiences, configured by the registry: the mark, accent and navigation come from
// EXPERIENCES[experience], so the two shells cannot drift. Adding an experience is a registry entry and a
// migration-370 check value, not a second route tree (provisional ruling D7).
//
// ⚠ AN EXPERIENCE THE PERSON DOES NOT HOLD RENDERS A GOVERNED STATE, NOT ITS SHELL. No navigation, no
// modules -- just what is true, and a switch to the experience they DO hold. The pages below ask the same
// question themselves (shell-context.ts experiencePage) and render nothing in this case.

export async function generateMetadata({ params }: { params: Promise<{ experience: string }> }): Promise<Metadata> {
  const { experience } = await params;
  if (!isExperienceKey(experience)) return {};
  const name = EXPERIENCES[experience].name;
  return gatedMetadata({ title: { default: name, template: `%s · ${name}` } });
}

export default async function ExperienceLayout({ children, params }: {
  children: React.ReactNode; params: Promise<{ experience: string }>;
}) {
  const { experience } = await params;
  if (!isExperienceKey(experience)) notFound();
  const shell = await individualShell();
  if (shell.state === "DISABLED") notFound();
  // Layouts and pages render in parallel, so this layout answers a signed-out visitor itself rather than
  // relying on the group layout's redirect landing first: same destination, the experience preserved.
  if (shell.state === "AUTH_REQUIRED") {
    const asked = (await headers()).get("x-pathname") ?? "";
    redirect(isIndividualNext(asked) && experienceOfPath(asked) === experience
      ? `/login?next=${encodeURIComponent(asked)}` : signInHref(experience));
  }
  if (shell.state !== "READY") redirect(`/individual/access${forQuery(experience)}`);
  const { live, profile } = shell.ctx;
  const x = EXPERIENCES[experience];

  if (!live.includes(experience)) {
    const other = live[0] ? EXPERIENCES[live[0]] : null;
    // COMPETEN-SCHOLAR-JOIN-01 J1: a member may add Scholar themselves, only while individual_self_registration is on.
    const canJoin = experience === "scholar" && (await selfRegistrationEnabled(shell.ctx.admin));
    if (canJoin) {
      return (
        <main className="min-h-screen bg-gray-50 px-4 py-10 sm:py-16">
          <div className="mx-auto max-w-xl">
            <div className="mb-6"><ExperienceMark wordmark={x.wordmark} accent={x.accent} /></div>
            <StatePanel title={`Add ${x.name} to your account`}
              actions={<>
                <Link href={JOIN_START} className={`inline-flex min-h-[44px] items-center justify-center rounded-xl px-5 py-2.5 text-[14.5px] font-semibold text-white ${focusRing}`} style={{ background: x.accent }}>Add {x.name}</Link>
                {other && <Link href={experienceHref(other.key)} className={secondaryBtn}>Back to {other.name}</Link>}
              </>}>
              <p>{x.micro} It joins the account you already have, with the same Passport and profile.</p>
            </StatePanel>
          </div>
        </main>
      );
    }
    return (
      <main className="min-h-screen bg-gray-50 px-4 py-10 sm:py-16">
        <div className="mx-auto max-w-xl">
          <div className="mb-6"><ExperienceMark wordmark={x.wordmark} accent={x.accent} /></div>
          <StatePanel title={`${x.name} is not active on your account`}
            actions={<>
              {other && <Link href={experienceHref(other.key)} className={`inline-flex min-h-[44px] items-center justify-center rounded-xl px-5 py-2.5 text-[14.5px] font-semibold text-white ${focusRing}`} style={{ background: other.accent }}>Go to {other.name}</Link>}
              <Link href="/individual" className={secondaryBtn}>About Competen Individual</Link>
            </>}>
            <p>{x.micro} It is part of Competen Individual, and it is added to the account you already have. There is no separate sign-up.</p>
            <p>Competen Individual is in pilot, so access is arranged by Competen.</p>
          </StatePanel>
        </div>
      </main>
    );
  }

  // ── THE WELCOME COMES FIRST, ONCE (COMPETEN-IND-003 s2(7), COMPETEN-IND-ACCESS-001 s3) ─────────────
  // A direct entry -- a Scholar website sign-in, a bookmark -- used to step past the onboarding, which is
  // shown "before any experience". It now goes through the welcome with the experience it asked for
  // preselected, and the welcome continues to that experience. Presentation order only: the experience
  // is already live for this person, and nothing here grants or withholds it.
  if (!shell.ctx.membership.onboardedAt) redirect(`/individual/welcome${forQuery(experience)}`);

  // ── OWNER RULING D2: TERMS BEFORE USE ───────────────────────────────────────────────────────────
  // Live is not yet usable. The person accepts the shared foundation's and this experience operator's
  // currently published terms first; until those are published, the experience stays closed and says so.
  const gate = contextTermsGate(shell.ctx, experience);
  if (!gate.usable) {
    const fCur = publishedVersions(gate.foundation.legal);
    const xCur = publishedVersions(gate.experience.legal);
    const nameOf = (l: typeof gate.foundation.legal) => l.registeredName ?? l.label;
    const docs: ShownDoc[] = [];
    if (fCur && gate.foundation.state !== "accepted" && gate.foundation.legal.terms && gate.foundation.legal.privacy) {
      docs.push({ title: `${nameOf(gate.foundation.legal)} Terms of Use`, version: fCur.terms, url: gate.foundation.legal.terms.url });
      docs.push({ title: `${nameOf(gate.foundation.legal)} Privacy Notice`, version: fCur.privacy, url: gate.foundation.legal.privacy.url });
    }
    const sameAsFoundation = gate.experience.legal.entity === gate.foundation.legal.entity
      && fCur && xCur && fCur.terms === xCur.terms && fCur.privacy === xCur.privacy;
    if (xCur && gate.experience.state !== "accepted" && !sameAsFoundation && gate.experience.legal.terms && gate.experience.legal.privacy) {
      docs.push({ title: `${x.name} Terms of Use (${nameOf(gate.experience.legal)})`, version: xCur.terms, url: gate.experience.legal.terms.url });
      docs.push({ title: `${x.name} Privacy Notice (${nameOf(gate.experience.legal)})`, version: xCur.privacy, url: gate.experience.legal.privacy.url });
    }
    const unpublished = !fCur || !xCur;
    return (
      <main className="min-h-screen bg-gray-50 px-4 py-10 sm:py-16">
        <div className="mx-auto max-w-xl">
          <div className="mb-6"><ExperienceMark wordmark={x.wordmark} accent={x.accent} /></div>
          {unpublished ? (
            <StatePanel title={`${x.name} is not open yet`} actions={<SignOutButton />}>
              <p>Its terms of use and privacy notice have not been published for this service yet. You will be asked to read and accept them before you use {x.name}.</p>
              <p>Your access is in place, and nothing on your account has changed.</p>
            </StatePanel>
          ) : (
            <section className="rounded-2xl border border-gray-200 bg-white p-6 sm:p-8">
              <h1 className="text-xl font-bold tracking-tight text-gray-900">Before you use {x.name}</h1>
              <p className="mt-2 text-[14.5px] leading-relaxed text-gray-700">
                {nameOf(gate.foundation.legal)} manages your Competen identity, Passport, history and personal AI.
                {gate.experience.legal.entity !== gate.foundation.legal.entity ? ` ${x.name} is operated by ${nameOf(gate.experience.legal)}.` : ""}
                {" "}Please read and accept the following.
              </p>
              <TermsAcceptance experience={experience} accent={x.accent} docs={docs} foundation={fCur!} experienceDocs={xCur!} />
            </section>
          )}
        </div>
      </main>
    );
  }

  // HFE-01 F8: with the experience switcher showing, the phone header keeps only the C mark, so the row fits 375px.
  const initials = (profile.fullName ?? profile.email ?? "?").split(/\s+/).map(s => s.charAt(0)).join("").slice(0, 2).toUpperCase();
  // COMPETEN-LEARNING-01: one link to the member-only Learning area, only while learning_app is on (ADR-017).
  const learning = await learningEnabled(shell.ctx.admin);

  // Scholar HFE redesign (2026-10-26): the Scholar shell carries the agreed prototype's palette (.cmp-scholar,
  // globals.css), its AI help switch at the right of every page heading, and its footer. The structure --
  // header, sidebar, bottom bar -- is the same for both experiences, so the two shells still cannot drift.
  const scholar = experience === "scholar";
  const action = scholar ? <AiHelpSwitch admin={shell.ctx.admin} userId={shell.ctx.userId} /> : null;
  // HFE-01 Wave 1: the product's AI standing once per page, so AI actions show their availability before a click.
  const ai = await getAiStanding(shell.ctx.admin, { userId: shell.ctx.userId, product: experience });
  const aiSlim = { readable: ai.readable, policyPublished: ai.policyPublished, activities: ai.activities, message: ai.message };

  return (
    <div className={`min-h-screen bg-gray-50 ${scholar ? "cmp-scholar" : ""}`}>
      <header className="sticky top-0 z-30 border-b border-gray-200 bg-white">
        <div className="flex h-14 md:h-[76px] items-center gap-3 px-4 md:gap-7 md:px-7">
          <Link href={experienceHref(experience)} className={`rounded-lg md:w-[200px] ${focusRing}`} aria-label={`${x.name} home`}>
            <span className="md:hidden"><ExperienceMark wordmark={x.wordmark} accent={x.accent} size="sm" iconOnly={live.length > 1} /></span>
            <span className="hidden md:inline"><ExperienceMark wordmark={x.wordmark} accent={x.accent} /></span>
          </Link>
          <div className="ml-auto md:ml-0"><ExperienceSwitcher current={experience} live={live} /></div>
          {learning && <Link href="/individual/learning" className={`inline-flex min-h-[36px] pointer-coarse:min-h-[var(--cmp-touch-min)] items-center rounded-lg px-2 text-[13px] font-semibold text-gray-700 hover:bg-gray-50 ${focusRing}`}>Learning</Link>}
          <div className="hidden md:flex md:ml-auto items-center gap-2.5 text-[13px]">
            <span className="rounded-full bg-[#eff2f5] px-2.5 py-1 text-[11px] font-semibold text-[#61717e]">Individual account</span>
          </div>
          <AccountMenu experience={experience} initials={initials} name={profile.fullName ?? profile.email ?? "Your account"} />
        </div>
      </header>

      <div className="flex">
        <aside className="hidden md:flex sticky top-[76px] h-[calc(100vh-76px)] w-[236px] shrink-0 flex-col border-r border-gray-200 bg-white">
          <SidebarNav experience={experience} learning={learning} />
          <div className="mx-4 mt-auto border-t border-gray-200 px-2 py-5 text-[12px] leading-relaxed text-gray-600">
            <p><strong className="text-gray-900">Competen Individual</strong></p>
            <p>One account, one Passport.</p>
            <p>Across {live.length > 1 ? "both your experiences" : "every experience you add"}.</p>
            {scholar && <div className="mt-4"><JourneyButton /></div>}
          </div>
        </aside>
        <main id="main" className="min-w-0 flex-1 pb-24 md:pb-10">
          <ShellActionProvider action={action}>
          <AiAvailabilityProvider standing={aiSlim}>
            <div className={scholar
              ? "w-full max-w-[1600px] px-4 py-6 md:px-[42px] md:pt-[30px] md:pb-[70px]"
              : "mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8"}>
              {children}
              {scholar && (
                <footer className="mt-8 text-[12px] text-[#7c8b95]">
                  Competen Scholar · Your learning belongs to you.{" "}
                  <Link href={experienceHref("scholar", "settings")} className={`font-semibold underline-offset-2 hover:underline ${focusRing}`} style={{ color: x.accent }}>Privacy &amp; AI controls</Link>
                </footer>
              )}
            </div>
          </AiAvailabilityProvider>
          </ShellActionProvider>
        </main>
      </div>

      <BottomNav experience={experience} />
    </div>
  );
}
