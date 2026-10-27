"use client";
import { useState } from "react";
import Link from "next/link";
import { presentationFor, type ProductIcon } from "@/lib/design/product-themes";
import { presentWith, type PresentationConfig } from "@/lib/design/presentation-config";

// COMPETEN-DESIGN-SYSTEM-01 s4: the post-sign-in destination chooser, one card per AUTHORISED destination.
//
// ⚠ PRESENTATION OVER THE SERVER'S SET, NEVER MORE (COMP-ID-ROUTE-001 s5, s8). The destinations are exactly the
// ones /api/auth/destinations resolved from membership tables. "Last used" (browser storage) only MARKS and
// ORDERS a card that is already in that set: it never adds one, preselects one or navigates on its own, and a
// remembered code that is no longer authorised is simply ignored. Each destination re-checks access on arrival.

export type Destination = { code: string; name: string; blurb: string; href: string };

const LAST_KEY = "cmp.lastDestination";

function readLast(): string | null {
  try { return window.localStorage.getItem(LAST_KEY); } catch { return null; }
}
function writeLast(code: string) {
  try { window.localStorage.setItem(LAST_KEY, code); } catch { /* private mode: nothing to remember */ }
}

/** Pure: the authorised set, with the remembered destination first if (and only if) it is in the set. */
export function orderDestinations<T extends { code: string }>(list: T[], last: string | null): T[] {
  if (!last || !list.some(d => d.code === last)) return list;
  return [...list.filter(d => d.code === last), ...list.filter(d => d.code !== last)];
}

function Icon({ name }: { name: ProductIcon }) {
  const common = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (name) {
    case "building": return <svg {...common}><path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16" /><path d="M15 9h4a1 1 0 0 1 1 1v11" /><path d="M8 8h3M8 12h3M8 16h3M3 21h18" /></svg>;
    case "stethoscope": return <svg {...common}><path d="M6 3v6a5 5 0 0 0 10 0V3" /><path d="M11 14v2a4 4 0 0 0 8 0v-1" /><circle cx="19" cy="13" r="2" /></svg>;
    case "person": return <svg {...common}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>;
    case "book": return <svg {...common}><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" /><path d="M4 19V5" /></svg>;
    case "briefcase": return <svg {...common}><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>;
  }
}

// `presentation` is the published HQ wording (presentation-config.ts), laid over the code default per card.
export function DestinationChooser({ destinations, presentation }: { destinations: Destination[]; presentation?: Partial<PresentationConfig> }) {
  // Lazy initialiser: this component renders only after the client resolved destinations, never on the server.
  const [last] = useState<string | null>(() => (typeof window === "undefined" ? null : readLast()));
  const ordered = orderDestinations(destinations, last);

  return (
    <div className="mt-7">
      <h2 className="text-[17px] font-bold text-gray-900">How would you like to use Competen?</h2>
      <p className="mt-1 text-[13px] text-gray-600">Choose where to go now. You can switch at any time; your account is the same everywhere.</p>
      <ul className="mt-4 flex flex-col gap-3">
        {ordered.map(d => {
          const p = presentWith(d.code, presentation, presentationFor(d.code));
          const isLast = d.code === last;
          return (
            <li key={d.code} data-cmp-theme={p.theme}>
              <Link
                href={d.href}
                onClick={() => writeLast(d.code)}
                aria-describedby={`dest-${d.code}-desc`}
                className="group flex items-start gap-4 rounded-2xl border-2 border-[var(--cmp-theme-border)] bg-[var(--cmp-theme-soft)] p-4 transition-colors hover:border-[var(--cmp-theme-accent)] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--cmp-theme-accent)] pointer-coarse:min-h-[88px]"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--cmp-theme-accent)] text-[var(--cmp-theme-on-accent)]">
                  <Icon name={p.icon} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[11.5px] font-bold uppercase tracking-[0.08em] text-[var(--cmp-theme-ink)]">{p.role}</span>
                    {isLast && ordered.length > 1 && (
                      <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-[var(--cmp-theme-ink)] ring-1 ring-[var(--cmp-theme-border)]">Last used</span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-[16px] font-bold text-gray-900">{d.name}</span>
                  <span id={`dest-${d.code}-desc`} className="mt-0.5 block text-[13px] leading-snug text-gray-700">{p.description}</span>
                  <span className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[var(--cmp-theme-accent)] px-3.5 py-2 text-[13.5px] font-semibold text-[var(--cmp-theme-on-accent)] group-hover:bg-[var(--cmp-theme-strong)]">
                    {p.action} <span aria-hidden>→</span>
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
