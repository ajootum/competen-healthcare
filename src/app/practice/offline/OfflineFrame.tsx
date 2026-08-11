"use client";

import { useEffect, useState } from "react";
import { cachedNav, type CachedNavItem } from "@/lib/practice/offline-store";
// The offline page's chrome. CP-OFFLINE-SURVEY-001 s3.3, and the owner's decision of 2026-08-11.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ WHY THIS EXISTS AT ALL, WHEN THE SHELL ALREADY DRAWS A SIDEBAR.
//
// /practice/offline sits OUTSIDE the (shell) group and must stay there. That layout calls
// resolvePracticeShell (authentication, membership, workspace status, entitlement, onboarding, device
// revocation), then todaysPlan, then resolvePreferences, then two counts -- every one a database read,
// and it REDIRECTS on failure, to /practice/sign-in, which also cannot load. A shell-wrapped offline
// page could never render at the one moment it is needed.
//
// So the chrome was absent, and the owner walked into the consequence: a screen that looks nothing like
// the product they were using a second earlier reads as broken before anybody reaches the banners
// explaining it. The banners were already carrying the "you are in a reduced mode" signal; the missing
// frame was adding confusion rather than information.
//
// ⚠ NOTHING IS IMPORTED FROM THE SHELL, AND THAT IS NOT LAZINESS. Reusing SidebarNav or the layout's
// header would put a module graph the shell owns behind the one page that must render with no
// connection -- and this repository has already lost a board to a server-only import reaching a client
// component: clean tsc, clean eslint, clean harness, dead page. Sixty lines of duplicated markup is the
// cheap side of that trade. The colours come from the same CSS variables, so the two cannot drift apart
// on the thing that actually matters.
//
// ⚠ THE SECTIONS ARE LISTED BUT NONE OF THEM IS A LINK, AND THAT POSITION MOVED ONCE. The first version
// listed nothing at all, reasoning that offline sw.js redirects every /practice/* route back here, so
// nine working links would look normal and behave bizarrely. The links must indeed not work -- but
// leaving the column EMPTY made the page read as a broken product rather than a reduced one, which is
// what the owner reported on seeing it. Every other control on this screen is disabled-with-a-reason
// rather than removed; the sidebar now follows the same rule the rest of the page already followed.
//
// They are rendered as spans, not disabled anchors: there is no such thing as a disabled anchor, it stays
// clickable and focusable, and clicking one offline lands the practitioner straight back here.
//
// ⚠ IT NAMES NO PRACTICE AND NO PERSON. The shell footer prints the workspace name; this cannot, and
// must not pretend to. The offline store deliberately keeps only an opaque workspace uuid -- no name, no
// membership, nothing meaningful to somebody reading the browser's storage. Rendering a practice name
// here would mean caching one, which is a disclosure nobody agreed to for the sake of a heading.

export default function OfflineFrame({ children }: { children: React.ReactNode }) {
  // ⚠ READ IN THE BROWSER, UNSEALED, AND BEFORE ANYTHING IS UNLOCKED. The sidebar has to draw on a
  // LOCKED device too -- that is the whole point of it -- so it cannot live behind the PIN. It holds
  // section names and nothing else: no patient, no person, no practice name.
  const [nav, setNav] = useState<CachedNavItem[]>([]);
  useEffect(() => { void cachedNav().then(setNav); }, []);

  return (
    <div className="flex min-h-screen bg-[var(--cp-canvas,#f7f8fa)]">
      {/* The frame, matching the shell's aside: same width, same surface, same mark. */}
      <aside className="hidden md:flex w-60 shrink-0 flex-col bg-[var(--cp-shell)] text-white">
        <div className="flex h-14 items-center gap-2.5 border-b border-white/10 px-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--cp-primary)] text-sm font-bold text-white">
            C
          </span>
          <span className="text-[15px] font-bold">competen<span className="text-blue-300">Practice</span></span>
        </div>

        {/* ⚠ THE PRACTITIONER'S OWN SECTIONS, DISABLED WITH A REASON -- not hidden, and not omitted.
            The first version left this space empty on the reasoning that nine links which all redirect
            back here would look normal and behave bizarrely. That was half right: the links must not
            WORK, but leaving the column blank made the page look like a broken product rather than a
            reduced one, which is what the owner reported. Disabled-with-a-reason is what every other
            control on this screen already does -- the consultation buttons, the guidance buttons -- so
            this is the established rule rather than a new idea.
            ⚠ The list is the one CACHED FOR THIS ACCOUNT: eight of the nine sections are
            capability-gated, so rendering all of them would show a practice manager sections they do not
            hold. Empty means the sidebar was never remembered, and it says so instead of inventing one. */}
        <nav className="px-3 py-3" aria-label="Practice sections, unavailable offline">
          <p className="px-1 pb-1.5 text-[9.5px] font-bold uppercase tracking-[0.14em] text-blue-200/40">
            Needs a connection
          </p>
          {nav.length === 0 ? (
            <p className="px-1 text-[12px] leading-relaxed text-blue-100/60">
              This device has not stored which sections you use, so none are listed. Opening Practice
              while online will remember them.
            </p>
          ) : (
            <ul>
              {nav.map(item => (
                <li key={item.href}>
                  {/* ⚠ A <span>, NOT A DISABLED LINK. There is no such thing as a disabled anchor -- it
                      stays clickable and keyboard-focusable -- and offline every one of these redirects
                      straight back to this page, which reads as the product being broken. */}
                  <span aria-disabled="true"
                    className="mb-0.5 flex cursor-not-allowed items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-blue-100/35">
                    <span aria-hidden className="w-4 text-center">{item.icon}</span>
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 px-1 text-[11px] leading-relaxed text-blue-100/50">
            These need a connection to the practice. They are shown so you can see what is waiting, not
            because they can be opened from here.
          </p>
        </nav>

        <div className="mt-auto border-t border-white/10 px-4 py-3">
          {/* ⚠ No practice name and no person: see the header. */}
          <p className="text-[12.5px] font-semibold text-white">Working offline</p>
          <p className="text-[10px] leading-relaxed text-blue-200/50">
            Everything here was stored by this browser, for itself.
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* The header band, so the top of the screen is the same shape as every other page. */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-4">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--cp-primary)] text-[12px] font-bold text-white md:hidden">
            C
          </span>
          <span className="text-[13px] font-semibold text-gray-900">Competen Practice</span>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900">
            Offline
          </span>
        </header>

        {/* ⚠ LEFT-ALIGNED, NOT CENTRED, because that is what every other page does. The shell renders
            `main.practice-scale.flex-1.min-w-0.p-5` and its pages constrain themselves with a bare
            `max-w-*` — no `mx-auto`. Centring here put a wide empty band between the sidebar and the
            content and made the offline page look like a different application again, which is the exact
            thing this frame exists to stop. Parity is the whole point of it. */}
        <main className="practice-scale min-w-0 flex-1 p-5">
          <div className="w-full max-w-3xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
