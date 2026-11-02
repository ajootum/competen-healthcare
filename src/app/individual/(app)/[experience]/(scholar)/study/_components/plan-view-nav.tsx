import Link from "next/link";
import { PLAN_VIEWS, PLAN_VIEW_LABEL, planViewHref, type PlanView } from "@/lib/individual/scholar/plan-view";
import { focusRing } from "./plan-style";

// MY PLAN's three views as a segmented control: three real links, the current one marked by aria-current, a ring and a raised surface
// (never colour alone), icon and label, at least the touch minimum. The pattern of flashcards-modes.tsx.
const ICON: Record<PlanView, React.ReactNode> = {
  today: <><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" /></>,
  calendar: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /></>,
  insights: <path d="M5 20V12M12 20V5M19 20v-9" />,
};

export function PlanViewNav({ base, current }: { base: string; current: PlanView }) {
  return (
    <nav aria-label="My Plan views" data-testid="plan-views" className="mb-5">
      <ul className="grid grid-cols-3 gap-1 rounded-2xl border border-gray-200 bg-gray-50 p-1">
        {PLAN_VIEWS.map(v => {
          const on = v === current;
          return (
            <li key={v} className="flex">
              <Link href={planViewHref(base, v)} aria-current={on ? "page" : undefined}
                className={`flex min-h-[48px] w-full flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1.5 py-1.5 text-center text-[13px] font-semibold leading-tight pointer-coarse:min-h-[var(--cmp-touch-min)] md:flex-row md:gap-2 md:text-[14px] ${focusRing} ${on ? "bg-white text-[var(--cmp-role-indigo-ink)] shadow-sm ring-2 ring-[var(--cmp-role-indigo-ink)]" : "text-gray-700 hover:bg-white"}`}>
                <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ICON[v]}</svg>{PLAN_VIEW_LABEL[v]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
