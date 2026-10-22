import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { EXPERIENCES, experienceHref, isExperienceKey } from "@/lib/individual/experiences";
import { individualShell } from "../../_components/shell-context";
import { ExperienceMark, ExperienceSwitcher, StatePanel, focusRing, secondaryBtn } from "../../_components/chrome";
import { SidebarNav, BottomNav, SignOutButton } from "../../_components/ShellNav";

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
  return { title: { default: name, template: `%s · ${name}` } };
}

export default async function ExperienceLayout({ children, params }: {
  children: React.ReactNode; params: Promise<{ experience: string }>;
}) {
  const { experience } = await params;
  if (!isExperienceKey(experience)) notFound();
  const shell = await individualShell();
  if (shell.state !== "READY") redirect("/individual/access");
  const { live, profile } = shell.ctx;
  const x = EXPERIENCES[experience];

  if (!live.includes(experience)) {
    const other = live[0] ? EXPERIENCES[live[0]] : null;
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

  const initials = (profile.fullName ?? profile.email ?? "?").split(/\s+/).map(s => s.charAt(0)).join("").slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/95 backdrop-blur">
        <div className="flex h-14 items-center gap-3 px-4 md:px-6">
          <Link href={experienceHref(experience)} className={`rounded-lg ${focusRing}`} aria-label={`${x.name} home`}>
            <ExperienceMark wordmark={x.wordmark} accent={x.accent} size="sm" />
          </Link>
          <div className="ml-auto md:ml-6"><ExperienceSwitcher current={experience} live={live} /></div>
          <div className="hidden md:flex md:ml-auto items-center gap-3">
            <Link href={experienceHref(experience, "settings")} className={`flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-gray-50 ${focusRing}`}>
              <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-full text-[12px] font-bold text-white" style={{ background: x.accent }}>{initials}</span>
              <span className="max-w-[12rem] truncate text-[13px] font-medium text-gray-800">{profile.fullName ?? profile.email}</span>
            </Link>
            <SignOutButton />
          </div>
          <Link href={experienceHref(experience, "settings")} aria-label="Account and settings"
            className={`md:hidden flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${focusRing}`}>
            <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-full text-[12px] font-bold text-white" style={{ background: x.accent }}>{initials}</span>
          </Link>
        </div>
      </header>

      <div className="flex">
        <aside className="hidden md:flex sticky top-14 h-[calc(100vh-3.5rem)] w-60 shrink-0 flex-col border-r border-gray-200 bg-white">
          <SidebarNav experience={experience} />
          <div className="mt-auto border-t border-gray-100 px-4 py-3">
            <p className="text-[11.5px] font-semibold text-gray-800">Competen Individual</p>
            <p className="text-[11px] leading-snug text-gray-500">One account, one Passport, across {live.length > 1 ? "both your experiences" : "every experience you add"}.</p>
          </div>
        </aside>
        <main id="main" className="min-w-0 flex-1 pb-24 md:pb-10">
          <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">{children}</div>
        </main>
      </div>

      <BottomNav experience={experience} />
    </div>
  );
}
