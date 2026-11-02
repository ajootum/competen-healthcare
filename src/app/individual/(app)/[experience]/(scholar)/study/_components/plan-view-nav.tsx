"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { PLAN_VIEWS, PLAN_VIEW_LABEL, PLAN_VIEW_STORE, planViewHref, resolveView, type PlanView } from "@/lib/individual/scholar/plan-view";
import { focusRing } from "./plan-style";
import { CalendarIcon, ChartIcon, SunIcon } from "./plan-ui";

// MY PLAN's three views as three equal tinted tiles in ONE row (icon and name; the owner's mockup): Calendar (information tint), Today (success tint),
// Insights (indigo tint). Each tile keeps its tint; the current one also has a stronger border in its hue, aria-current and a raised look, so the
// choice is never colour alone. Three real links, each with an explicit ?view= (an explicit view always wins). At least the touch minimum high on a
// coarse pointer. The text shrinks on a narrow phone; nothing scrolls sideways.
//
// The learner's last view is remembered on this device (localStorage, in a try/catch: a private window simply opens the Calendar). It is read here, in
// the browser, ONLY when the address names no view and the remembered one is not the default: then the address is replaced once. The server never redirects.
const ICON: Record<PlanView, React.ReactNode> = { calendar: <CalendarIcon size={18} />, today: <SunIcon size={18} />, insights: <ChartIcon size={18} /> };
const TINT: Record<PlanView, { bg: string; edge: string; ink: string }> = {
  calendar: { bg: "var(--cmp-surface-information)", edge: "var(--cmp-color-information)", ink: "var(--cmp-text-information)" },
  today: { bg: "var(--cmp-surface-success)", edge: "var(--cmp-color-success)", ink: "var(--cmp-text-success)" },
  insights: { bg: "var(--cmp-role-indigo-soft)", edge: "var(--cmp-role-indigo-accent)", ink: "var(--cmp-role-indigo-ink)" },
};

export function PlanViewNav({ base, current, explicit, extra }: {
  base: string; current: PlanView;
  /** The address names a view (?view=). */
  explicit: boolean;
  /** Query parts kept on every link (the connected study session). */
  extra?: Record<string, string | null | undefined>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  useEffect(() => {
    let stored: string | null = null;
    try { stored = window.localStorage.getItem(PLAN_VIEW_STORE); } catch { /* not remembered */ }
    const r = resolveView(explicit ? current : undefined, stored);
    if (r.remember) { try { window.localStorage.setItem(PLAN_VIEW_STORE, r.remember); } catch { /* not remembered */ } }
    if (r.redirectTo) {
      // Keep whatever else the address carries (the connected study session, a chosen day), name the remembered view.
      const q = new URLSearchParams(params.toString());
      q.set("view", r.redirectTo);
      router.replace(`${pathname}?${q.toString()}`);
    }
    // Once, on arrival: choosing a view later is an ordinary link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <nav aria-label="My Plan views" data-testid="plan-views" className="mt-3">
      <ul className="grid grid-cols-3 gap-2">
        {PLAN_VIEWS.map(v => {
          const on = v === current;
          const t = TINT[v];
          return (
            <li key={v} className="flex">
              <Link href={planViewHref(base, v, extra)} aria-current={on ? "page" : undefined} onClick={() => { try { window.localStorage.setItem(PLAN_VIEW_STORE, v); } catch { /* not remembered */ } }}
                className={`flex min-h-12 w-full items-center justify-center gap-1.5 rounded-xl border-2 px-1.5 text-[13px] font-bold leading-tight sm:text-[14.5px] pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing} ${on ? "shadow-sm" : ""}`}
                style={{ background: t.bg, color: t.ink, borderColor: on ? t.edge : t.bg }}>
                <span aria-hidden className="shrink-0">{ICON[v]}</span>
                <span>{PLAN_VIEW_LABEL[v]}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
