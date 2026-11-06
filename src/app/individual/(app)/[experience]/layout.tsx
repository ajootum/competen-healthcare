import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { EXPERIENCES, experienceHref, isExperienceKey } from "@/lib/individual/experiences";
import { individualShell, gatedMetadata } from "../../_components/shell-context";
import { SCHOLAR_ICONS } from "@/lib/individual/scholar/brand";
import { ExperienceMark, ExperienceSwitcher, StatePanel, focusRing, secondaryBtn } from "../../_components/chrome";
import { SidebarNav, BottomNav, AccountMenu, SignOutButton } from "../../_components/ShellNav";
import { lifeosEntryEnabled } from "@/lib/individual/lifeos-entry";
import { ScholarDrawer } from "../../_components/ScholarDrawer";
import { readPreviewRender } from "@/lib/individual/preview/headers";
// HFE-01 D1: AccountMenu is the one account menu on phone and desktop (every destination the bottom bar cannot hold).
import TermsAcceptance, { type ShownDoc } from "../../_components/TermsAcceptance";
import { contextTermsGate } from "@/lib/individual/guard";
import { publishedVersions } from "@/lib/individual/legal";
import { experienceOfPath, forQuery, isIndividualNext, signInHref } from "@/lib/individual/entry";
import { initialsOf } from "@/lib/individual/initials";
import { headers } from "next/headers";
import { JOIN_START, selfRegistrationEnabled } from "@/lib/individual/join";
import { learningEnabled } from "@/lib/learning/policy";
import { ShellActionProvider } from "../../_components/Dialog";
import { AiHelpSwitch, JourneyButton } from "./(scholar)/study/_components/shell-pieces";
import { ScholarEduNotice } from "./(scholar)/study/_components/edu-notice";
import { getAiStanding } from "@/lib/ai/allowance";
import { AiAvailabilityProvider } from "../../_components/ai/AiAvailabilityContext";
import { SearchHistoryChoiceProvider } from "../../_components/SearchHistoryChoice";
import { NavigationProgress } from "../../_components/NavigationProgress";
import { GlobalSearch } from "../../_components/search/GlobalSearch";
import { readSearchHistoryChoice } from "@/lib/individual/scholar/search-history-choice";
import { MyPlanNavProvider } from "./(scholar)/study/_components/plan-nav";
import { isMyPlanOn, loadIndividualPolicyOnce } from "@/lib/individual/policy";
import { studyPlanSchema } from "@/lib/individual/scholar/store";
import { scholarModulesOnce, type ScholarModuleKey } from "@/lib/individual/scholar/module-access";

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
  // SCHOLAR-BRAND-LOGO-01: only Competen Scholar's routes carry its emblem as the tab and home-screen icon; the global
  // favicon and every other product keep theirs.
  const icons = experience === "scholar" ? SCHOLAR_ICONS : undefined;
  return gatedMetadata({ title: { default: name, template: `%s · ${name}` }, ...(icons ? { icons } : {}) });
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
  // HQ-SCHOLAR-PREVIEW-01: true only when the proxy verified a live preview session for this request (headers.ts).
  const previewing = readPreviewRender(await headers()) !== null;

  if (!live.includes(experience)) {
    const other = live[0] ? EXPERIENCES[live[0]] : null;
    // COMPETEN-SCHOLAR-JOIN-01 J1: a member may add Scholar themselves, only while individual_self_registration is on.
    const canJoin = experience === "scholar" && (await selfRegistrationEnabled(shell.ctx.admin));
    if (canJoin) {
      return (
        <main className="min-h-screen bg-[var(--cmp-app-bg)] px-4 py-10 sm:py-16">
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
      <main className="min-h-screen bg-[var(--cmp-app-bg)] px-4 py-10 sm:py-16">
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
      <main className="min-h-screen bg-[var(--cmp-app-bg)] px-4 py-10 sm:py-16">
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
  const initials = initialsOf(profile);
  // COMPETEN-LEARNING-01: one link to the member-only Learning area, only while learning_app is on (ADR-017).
  // MY PLAN PERF: the three shell reads below are independent of each other, so they are made together (they were three steps in a row).
  const learningP = learningEnabled(shell.ctx.admin);
  const lifeosP = lifeosEntryEnabled(shell.ctx.admin);

  // Scholar HFE redesign (2026-10-26): the Scholar shell carries the agreed prototype's palette (.cmp-scholar,
  // globals.css), its AI help switch at the right of every page heading, and its footer. The structure --
  // header, sidebar, bottom bar -- is the same for both experiences, so the two shells still cannot drift.
  const scholar = experience === "scholar";
  // Modular restructuring (2 Nov 2026): Scholar's sidebar is the module tree (ScholarSidebar); below md, where it is not drawn, the header's Menu
  // button opens the same tree in a drawer (ScholarDrawer). The five-tab bottom bar stays. Keep block comments out of this file: the harness's strip().
  const action = scholar ? <AiHelpSwitch admin={shell.ctx.admin} userId={shell.ctx.userId} /> : null;
  // HFE-01 Wave 1: the product's AI standing once per page, so AI actions show their availability before a click.
  const aiP = getAiStanding(shell.ctx.admin, { userId: shell.ctx.userId, product: experience });
  // PLP-01..04: the My Plan tab shows only where HQ has My Plan on AND migration 780 is present (unreadable: off, so it fails closed).
  const myPlanP = scholar ? (async () => { try { const [policy, provisioned] = await Promise.all([loadIndividualPolicyOnce(shell.ctx.admin), studyPlanSchema(shell.ctx.admin, shell.ctx.userId)]); return isMyPlanOn(policy, provisioned); } catch { return false; } })() : false;
  // Private module development access: the private Scholar modules this person may see, computed once and handed to every navigation surface. Any failure is none.
  const modulesP: Promise<Set<ScholarModuleKey>> | Set<ScholarModuleKey> = scholar ? scholarModulesOnce(shell.ctx.admin, shell.ctx.userId) : new Set<ScholarModuleKey>();
  // My Search History (993): the learner's own choice, once per page, for the notices and for what a page may send. Any failure is off: nothing is kept.
  const historyP = scholar ? (async () => { try { return await readSearchHistoryChoice(shell.ctx.admin, shell.ctx.userId, await loadIndividualPolicyOnce(shell.ctx.admin)); } catch { return { offered: false, on: false, pending: false }; } })() : { offered: false, on: false, pending: false };
  const [learning, ai, myPlanOn, moduleSet, historyChoice] = await Promise.all([learningP, aiP, myPlanP, modulesP, historyP]);
  const globalSearchOn = scholar ? await loadIndividualPolicyOnce(shell.ctx.admin).then(p => p.scholarGlobalSearch === "on").catch(() => false) : false;
  const scholarModules = [...moduleSet];
  const aiSlim = { readable: ai.readable, policyPublished: ai.policyPublished, activities: ai.activities, message: ai.message };

  // SCHOLAR-BRAND-LOGO-01: Scholar's logo is the same size on phone and desktop in the header, so both marks are ONE image request.
  // HFE-COLOR-02: one neutral canvas (#F7F8FA) for every product, white header and sidebar, subtle borders.
  return (
    <div data-cmp-theme={experience} className={`min-h-screen bg-[var(--cmp-app-bg)] ${scholar ? "cmp-scholar" : ""}`}>
      <Suspense fallback={null}><NavigationProgress /></Suspense>
      <header className="sticky top-[var(--cmp-preview-h,0px)] z-30 border-b border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)]">
        <div className="flex h-14 md:h-[76px] items-center gap-3 px-4 md:gap-7 md:px-7">
          {scholar && <ScholarDrawer myPlan={myPlanOn} searchHistory={historyChoice.offered} modules={scholarModules} learning={learning} />}
          <Link href={experienceHref(experience)} className={`rounded-lg md:w-[200px] ${focusRing}`} aria-label={`${x.name} home`}>
            <span className="md:hidden"><ExperienceMark wordmark={x.wordmark} accent={x.accent} size={scholar ? "md" : "sm"} iconOnly={live.length > 1} /></span>
            <span className="hidden md:inline"><ExperienceMark wordmark={x.wordmark} accent={x.accent} /></span>
          </Link>
          <div className="ml-auto flex items-center gap-2 md:ml-0 md:gap-3">
            {globalSearchOn && <SearchHistoryChoiceProvider value={{ offered: historyChoice.offered, on: historyChoice.on, pending: historyChoice.pending }}><GlobalSearch /></SearchHistoryChoiceProvider>}
            <ExperienceSwitcher current={experience} live={live} />
          </div>
          {learning && <Link href="/individual/learning" className={`${scholar ? "hidden md:inline-flex" : "inline-flex"} min-h-[36px] pointer-coarse:min-h-[var(--cmp-touch-min)] items-center rounded-lg px-2 text-[13px] font-semibold text-gray-700 hover:bg-gray-50 ${focusRing}`}>Learning</Link>}
          <div className="hidden md:flex md:ml-auto items-center gap-2.5 text-[13px]">
            <span className="rounded-full bg-[var(--cmp-app-bg)] px-2.5 py-1 text-[11px] font-semibold text-[var(--cmp-app-text-secondary)] ring-1 ring-[var(--cmp-app-border)]">Individual account</span>
          </div>
          <AccountMenu experience={experience} initials={initials} name={profile.fullName ?? profile.email ?? "Your account"} preview={previewing} scholarModules={scholarModules} lifeos={await lifeosP} />
        </div>
      </header>

      <div className="flex">
        <aside className={`hidden md:flex sticky top-[calc(76px+var(--cmp-preview-h,0px))] h-[calc(100vh-76px-var(--cmp-preview-h,0px))] ${scholar ? "w-[256px]" : "w-[236px]"} shrink-0 flex-col border-r border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)]`}>
          <SidebarNav experience={experience} learning={learning} myPlan={myPlanOn} searchHistory={historyChoice.offered} scholarModules={scholarModules} />
          <div className="mx-4 mt-auto border-t border-[var(--cmp-app-border)] px-2 py-5 text-[12px] leading-relaxed text-gray-600">
            <p><strong className="text-gray-900">Competen Individual</strong></p>
            <p>One account, one Passport.</p>
            <p>Across {live.length > 1 ? "both your experiences" : "every experience you add"}.</p>
            {scholar && <div className="mt-4"><JourneyButton /></div>}
          </div>
        </aside>
        <main id="main" className="min-w-0 flex-1 pb-24 md:pb-10">
          <ShellActionProvider action={action}>
          <AiAvailabilityProvider standing={aiSlim}>
          <SearchHistoryChoiceProvider value={{ offered: historyChoice.offered, on: historyChoice.on, pending: historyChoice.pending }}>
          <MyPlanNavProvider on={myPlanOn}>
            <div className={scholar
              ? "w-full max-w-[1600px] px-4 py-6 md:px-[42px] md:pt-[30px] md:pb-[70px]"
              : "mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8"}>
              {scholar && <ScholarEduNotice />}
              {children}
              {scholar && (
                <footer className="mt-8 text-[12px] text-[var(--cmp-app-text-secondary)]">
                  Competen Scholar · Your learning belongs to you.{" "}
                  <Link href={experienceHref("scholar", "settings")} className={`font-semibold underline-offset-2 hover:underline ${focusRing}`} style={{ color: x.accent }}>Privacy &amp; AI controls</Link>
                </footer>
              )}
            </div>
          </MyPlanNavProvider>
          </SearchHistoryChoiceProvider>
          </AiAvailabilityProvider>
          </ShellActionProvider>
        </main>
      </div>

      <BottomNav experience={experience} />
    </div>
  );
}
