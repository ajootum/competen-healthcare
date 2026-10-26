import Link from "next/link";
import { EXPERIENCES, experienceHref, type ExperienceKey } from "@/lib/individual/experiences";
import { ShellAction } from "./Dialog";

// The Individual application's shared visual pieces. The shapes are the public site's (COMPETEN-WEB-IND-001,
// src/components/marketing/IndividualFamily.tsx on web-ind-001): the competen + sub-brand mark, rounded-xl
// controls of at least 44px, accent from the experience registry, and state carried by text as well as
// colour (COMP-IND-UX-001 s14).

export const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";

export const primaryBtn =
  "inline-flex min-h-[44px] items-center justify-center rounded-xl px-5 py-2.5 text-[14.5px] font-semibold text-white "
  + "transition-opacity hover:opacity-90 disabled:opacity-50 " + focusRing;

export const secondaryBtn =
  "inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-300 bg-white px-5 py-2.5 "
  + "text-[14.5px] font-semibold text-gray-800 hover:bg-gray-50 " + focusRing;

/** competen + SUB-BRAND -- the mark /practice, the coming-soon doors and the public experience pages use. */
export function ExperienceMark({ wordmark, accent, size = "md" }: { wordmark: string; accent: string; size?: "sm" | "md" }) {
  const sm = size === "sm";
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className={`${sm ? "w-7 h-7 text-[13px]" : "w-9 h-9 text-base"} shrink-0 rounded-full flex items-center justify-center text-white font-bold`}
        style={{ background: accent }}>C</span>
      <span className="leading-none">
        <span className={`block ${sm ? "text-[13px]" : "text-[15px]"} font-bold tracking-tight text-gray-900`}>competen</span>
        <span className={`block ${sm ? "text-[9.5px]" : "text-[10.5px]"} mt-0.5 font-bold uppercase tracking-[0.18em]`} style={{ color: accent }}>
          {wordmark}
        </span>
      </span>
    </span>
  );
}

/** The Individual family mark, for screens that belong to no single experience (welcome, access). */
export function IndividualMark() {
  return <ExperienceMark wordmark="individual" accent="#111827" />;
}

/**
 * The experience switcher. Lists ONLY experiences live for this person (ADR-016), so it never offers a
 * door that bounces. With one live experience there is nothing to switch to, and it renders nothing.
 * Switching is navigation: same account, same data, a different experience's shell.
 */
export function ExperienceSwitcher({ current, live }: { current: ExperienceKey; live: readonly ExperienceKey[] }) {
  if (live.length < 2) return null;
  return (
    <nav aria-label="Switch experience" className="flex items-center rounded-xl bg-gray-100 p-1">
      {live.map(key => {
        const x = EXPERIENCES[key];
        const on = key === current;
        return (
          <Link key={key} href={experienceHref(key)} aria-current={on ? "page" : undefined}
            className={`inline-flex min-h-[36px] pointer-coarse:min-h-[var(--cmp-touch-min)] items-center rounded-lg px-3 text-[13px] font-semibold ${focusRing} ${on ? "bg-white shadow-sm" : "text-gray-600 hover:text-gray-900"}`}
            style={on ? { color: x.accent } : undefined}>
            <span className="sm:hidden">{x.wordmark.charAt(0).toUpperCase() + x.wordmark.slice(1)}</span>
            <span className="hidden sm:inline">{x.name}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * A governed state: a page-level statement of what is true, why, and what the person can do. Used for
 * no-access, not-active and could-not-check. Never a disabled control and never "coming soon".
 */
export function StatePanel({ title, children, actions, tone = "neutral" }: {
  title: string; children: React.ReactNode; actions?: React.ReactNode; tone?: "neutral" | "warning";
}) {
  return (
    <section className={`rounded-2xl border bg-white p-6 sm:p-8 ${tone === "warning" ? "border-amber-300" : "border-gray-200"}`}>
      <h1 className="text-xl font-bold tracking-tight text-gray-900 text-balance">{title}</h1>
      <div className="mt-2 space-y-2 text-[14.5px] leading-relaxed text-gray-700">{children}</div>
      {actions && <div className="mt-5 flex flex-wrap gap-3">{actions}</div>}
    </section>
  );
}

/** A section that could not be read. Distinct from an empty one -- see src/lib/individual/passport.ts. */
export function Unreadable({ what }: { what: string }) {
  return (
    <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13.5px] text-amber-900">
      Your {what} could not be read just now. This is not the same as having none. Try again shortly.
    </p>
  );
}

/**
 * A page's heading. The control at its right (Scholar: the AI help switch) comes from the experience layout
 * through ShellAction, so no page loads it itself.
 */
export function PageHeader({ eyebrow, title, intro, accent }: { eyebrow?: string; title: string; intro?: string; accent: string }) {
  return (
    <header className="mb-5 flex items-start justify-between gap-4 md:items-center">
      <div className="min-w-0">
        {eyebrow && <p className="text-[11px] font-extrabold uppercase tracking-[0.18em]" style={{ color: accent }}>{eyebrow}</p>}
        <h1 className="mt-1 text-[27px] md:text-[32px] font-bold leading-tight tracking-[-0.03em] text-gray-900 text-balance">{title}</h1>
        {intro && <p className="mt-1.5 max-w-2xl text-[15px] leading-relaxed text-gray-600">{intro}</p>}
      </div>
      <ShellAction />
    </header>
  );
}

/**
 * HFE-01 Wave 4 (F11): the formative / private / not-verified boundary, said once per screen in one compact line,
 * with the screen's own detail one tap away. The boundary itself is unchanged; it just stops being repeated in
 * full on every tab, where it stopped being read.
 */
export function BoundaryNotice({ notice, detail }: { notice: string; detail?: React.ReactNode }) {
  return (
    <div className="mb-5 rounded-[9px] bg-[#edf3f6] px-[17px] py-[11px] text-[13px] leading-relaxed text-[#4f6475]">
      <p className="font-semibold">{notice}</p>
      {detail && (
        <details className="mt-1">
          <summary className="cursor-pointer text-[12.5px] font-semibold underline underline-offset-2">What this means here</summary>
          <p className="mt-1">{detail}</p>
        </details>
      )}
    </div>
  );
}

/**
 * HFE-01 Wave 4 (F10): one empty state -- one message and one primary action -- instead of walls of zeros,
 * empty filters and disabled rows before there is anything to show.
 */
export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="mb-5 rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-center">
      <h2 className="text-[18px] font-bold tracking-tight text-gray-900">{title}</h2>
      {children && <div className="mx-auto mt-1.5 max-w-md text-[14.5px] leading-relaxed text-gray-600">{children}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </section>
  );
}

/** A quiet statement of what a surface is and is not (Scholar HFE: formative, private, not verified). */
export function Notice({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <p className={`mb-5 rounded-[9px] bg-[#edf3f6] px-[17px] py-[13px] text-[13px] leading-relaxed text-[#4f6475] ${className}`}>{children}</p>;
}
