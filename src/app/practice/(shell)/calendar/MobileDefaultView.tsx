"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// CPR-MOB-001 s8 -- "Default view: Day or Agenda, not full desktop week grid."
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE PLANNER'S STATE IS THE URL, SO THE MOBILE DEFAULT IS A URL, NOT A SECOND VIEW RESOLVER.
//
// page.tsx mounts this ONLY when the request named no valid ?view= -- the one situation where a
// default is being applied at all. On a viewport below md it replaces the bare URL with the same URL
// plus view=day (date, filters and search ride along untouched), and the server then composes Day
// mode exactly as it would for anybody who chose it. Everything downstream stays coherent: the
// navigator highlights Day, a bookmark of the result MEANS Day, and back does not bounce (replace,
// never push).
//
// ⚠ WHAT THIS DELIBERATELY DOES NOT TOUCH:
//   - DEFAULT_PLANNER_VIEW stays "week" (CPR-PLN-002 s5.2's frozen desktop default -- the freeze
//     harness pins it), and the engine's fallback rule in page.tsx is unchanged. This is presentation
//     choosing a URL, not a second source of truth about views.
//   - An EXPLICIT ?view=week on a phone is honoured: this component is not mounted for it, so a
//     practitioner who chooses Week from the navigator gets Week (as the stacked day cards).
//
// Until the replace lands, the server's week composition shows -- which below md is already the
// stacked-day-cards face, so the transient frame is a sensible planner, not a broken one. With
// scripts disabled the week face simply stays, which degrades to something true rather than blank.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
export default function MobileDefaultView({ dayHref }: { dayHref: string }) {
  const router = useRouter();
  useEffect(() => {
    if (window.matchMedia("(max-width: 767px)").matches) {
      router.replace(dayHref, { scroll: false });
    }
  }, [router, dayHref]);
  return null;
}
