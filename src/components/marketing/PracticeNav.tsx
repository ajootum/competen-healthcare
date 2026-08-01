import Link from "next/link";
import { PRACTICE_AREAS, PRACTICE_ACCENT } from "@/lib/marketing/practice-content";

// Section navigation for /practice and its capability pages.
//
// Generated from PRACTICE_AREAS, which is the same list the routes and the /practice cards are built from.
// A capability page therefore cannot exist without a way in, and this bar cannot advertise a page that is
// not there -- the failure mode of hand-written navigation being a link that 404s in production because the
// page it pointed at was renamed six months later.
//
// It scrolls horizontally on a phone rather than wrapping to three lines above the fold.

export default function PracticeNav({ current }: { current?: string }) {
  return (
    <nav aria-label="Competen Practice sections"
      /* 71px, not 70: SiteHeader is a 70px row PLUS a 1px bottom border. Sticking at 70 parks this bar
         over the header's own hairline, which reads as a rule that thins out the moment you scroll. */
      className="sticky top-[71px] z-30 border-b border-gray-100 bg-white/95 backdrop-blur">
      <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
        <ul className="flex items-center gap-1 overflow-x-auto py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <li className="shrink-0">
            <Link href="/practice"
              aria-current={current === undefined ? "page" : undefined}
              className={`block rounded-lg px-3 py-1.5 text-[13px] font-semibold whitespace-nowrap transition-colors ${
                current === undefined ? "text-white" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"}`}
              style={current === undefined ? { background: PRACTICE_ACCENT } : undefined}>
              Overview
            </Link>
          </li>
          {PRACTICE_AREAS.map(a => {
            const active = a.slug === current;
            return (
              <li key={a.slug} className="shrink-0">
                <Link href={`/practice/${a.slug}`}
                  aria-current={active ? "page" : undefined}
                  className={`block rounded-lg px-3 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors ${
                    active ? "text-white font-semibold" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"}`}
                  style={active ? { background: a.accent } : undefined}>
                  {a.nav}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
