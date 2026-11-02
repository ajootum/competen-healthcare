import Link from "next/link";
import { PLAN_VIEWS, PLAN_VIEW_DESC, PLAN_VIEW_LABEL, planViewHref, type PlanView } from "@/lib/individual/scholar/plan-view";
import { focusRing } from "./plan-style";
import { CalendarIcon, ChartIcon, SunIcon } from "./plan-ui";

// MY PLAN's three views as three large cards: an icon, the name and one line about it. Three real links, the current one marked by aria-current, a
// tint, a ring and a raised surface (never colour alone). On a phone the three sit in one compact row (icon and name; the line is for screen readers,
// and from the small breakpoint up it shows), so nothing scrolls sideways. At least the touch minimum high.
const ICON: Record<PlanView, React.ReactNode> = { today: <SunIcon size={22} />, calendar: <CalendarIcon size={22} />, insights: <ChartIcon size={22} /> };

export function PlanViewNav({ base, current, extra }: { base: string; current: PlanView; /** Query parts kept on every link (the connected study session). */ extra?: Record<string, string | null | undefined> }) {
  return (
    <nav aria-label="My Plan views" data-testid="plan-views" className="mb-5">
      <ul className="grid grid-cols-3 gap-2 sm:gap-3">
        {PLAN_VIEWS.map(v => {
          const on = v === current;
          return (
            <li key={v} className="flex">
              <Link href={planViewHref(base, v, extra)} aria-current={on ? "page" : undefined}
                className={`flex min-h-[64px] w-full flex-1 flex-col items-center justify-center gap-1 rounded-2xl border px-2 py-3 text-center pointer-coarse:min-h-[var(--cmp-touch-min)] sm:min-h-[104px] sm:gap-1.5 sm:px-3 sm:py-4 ${focusRing} ${on ? "border-transparent bg-[var(--cmp-role-indigo-soft)] text-gray-900 shadow-sm ring-2 ring-[var(--cmp-role-indigo-ink)]" : "border-gray-200 bg-gray-50 text-gray-800 hover:bg-white"}`}>
                <span className={on ? "text-[var(--cmp-role-indigo-ink)]" : "text-gray-700"}>{ICON[v]}</span>
                <span className="text-[14px] font-bold leading-tight sm:text-[16px]">{PLAN_VIEW_LABEL[v]}</span>
                <span className="sr-only text-[13px] font-normal leading-snug text-gray-700 sm:not-sr-only sm:block">{PLAN_VIEW_DESC[v]}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
