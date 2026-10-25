import Link from "next/link";
import { EXPERIENCES, experienceHref, type ExperienceKey } from "@/lib/individual/experiences";
import { ExperienceMark, focusRing } from "@/app/individual/_components/chrome";

// The member-only Learning area's frame (COMPETEN-LEARNING-01, owner D2). It belongs to the Individual identity, not to
// an experience: a course-only member, who holds neither Scholar nor Professional, sees exactly this. A member who
// holds an experience gets a link back to it, never a door into one they do not hold.

export const LEARNING_ACCENT = "#0f766e";

export function LearningShell({ live, children, current }: { live: readonly ExperienceKey[]; children: React.ReactNode; current: "catalogue" | "mine" | null }) {
  const tab = (href: string, label: string, on: boolean) => (
    <Link href={href} aria-current={on ? "page" : undefined} className={`inline-flex min-h-[44px] items-center rounded-xl px-3 text-[14px] font-semibold ${focusRing} ${on ? "bg-teal-50 text-teal-900" : "text-gray-700 hover:text-gray-900"}`}>{label}</Link>
  );
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link href="/individual/learning" className={focusRing}><ExperienceMark wordmark="learning" accent={LEARNING_ACCENT} /></Link>
          <nav aria-label="Competen Learning" className="flex flex-wrap items-center gap-1">
            {tab("/individual/learning", "Catalogue", current === "catalogue")}
            {tab("/individual/learning?view=mine", "My learning", current === "mine")}
            {live.map(k => <Link key={k} href={experienceHref(k)} className={`inline-flex min-h-[44px] items-center rounded-xl px-3 text-[14px] text-gray-600 hover:text-gray-900 ${focusRing}`}>{EXPERIENCES[k].name}</Link>)}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}

export const day = (t: string | null) => (t ? new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "");
