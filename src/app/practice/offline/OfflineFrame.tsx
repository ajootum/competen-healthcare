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
// ⚠ AND THERE IS NO NAVIGATION IN IT, DELIBERATELY. Offline, sw.js redirects every other /practice/*
// route back to this page. Nine sidebar links that all bounce the practitioner here would look entirely
// normal and behave bizarrely -- worse than having none, because the failure would be silent and would
// read as the product being broken rather than as the network being gone.
//
// ⚠ IT NAMES NO PRACTICE AND NO PERSON. The shell footer prints the workspace name; this cannot, and
// must not pretend to. The offline store deliberately keeps only an opaque workspace uuid -- no name, no
// membership, nothing meaningful to somebody reading the browser's storage. Rendering a practice name
// here would mean caching one, which is a disclosure nobody agreed to for the sake of a heading.

export default function OfflineFrame({ children }: { children: React.ReactNode }) {
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

        {/* Where the nav would be. It says what it is instead of pretending to be a menu. */}
        <div className="px-4 py-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-blue-200/50">Offline</p>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-blue-100/70">
            This device only. The rest of the practice needs a connection, so it is not shown rather than
            shown and broken.
          </p>
        </div>

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
