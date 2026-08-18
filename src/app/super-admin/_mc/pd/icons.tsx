// CPR-PD-002 — the line-icon vocabulary the comp draws Mission Control with.
//
// ⚠ INLINE SVG, NOT A PACKAGE. This repository carries no icon dependency, and adding one for a single
// screen would put a hundred kilobytes of glyphs behind six KPI tiles. Every path below is 24×24,
// stroked in `currentColor`, so a tile's tint is set once on the wrapper and the glyph follows it —
// which is also why no colour is written here at all.
//
// ⚠ EVERY ICON IS DECORATIVE AND SAYS SO. `aria-hidden` is not optional: each of these sits beside the
// word it illustrates, and an icon that announces itself makes a screen reader read every label twice.
// PD-002 §15 forbids colour or icon ALONE carrying meaning; nothing here is ever the only carrier.

import type { ReactNode } from "react";

const PATHS: Record<string, ReactNode> = {
  // ── Product Pulse ────────────────────────────────────────────────────────────────────────────────
  practices: <><rect x="3" y="3" width="18" height="18" rx="2.5" /><path d="M3 9h18M3 15h18M9 3v18M15 3v18" /></>,
  practitioners: <><circle cx="9" cy="8" r="3.2" /><path d="M2.6 20a6.4 6.4 0 0 1 12.8 0" /><path d="M16.6 5.6a3.2 3.2 0 0 1 0 4.8" /><path d="M18.2 20a6.5 6.5 0 0 0-1.7-4.4" /></>,
  active: <path d="M2.5 12h3.8l2.4-6.2 3.9 12.4 2.9-9 1.9 2.8h4.1" />,
  patients: <><circle cx="9.5" cy="7.6" r="3.2" /><path d="M3 20a6.5 6.5 0 0 1 13 0" /><path d="M17.6 4.4c1.5-1.3 3.8.2 2.9 2-.5 1-1.6 1.8-2.9 2.5-1.2-.7-2.4-1.5-2.9-2.5-.9-1.8 1.4-3.3 2.9-2Z" /></>,
  bookings: <><rect x="3" y="5" width="18" height="16" rx="2.5" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  health: <><path d="M12 3l7.5 3v6c0 4.6-3.2 8-7.5 9.2C7.7 20 4.5 16.6 4.5 12V6L12 3Z" /><path d="M8.9 12.1l2.3 2.3 4.1-4.5" /></>,

  // ── Today, and the operational shortcuts ─────────────────────────────────────────────────────────
  onboarding: <><path d="M4 21V6.5L12 3l8 3.5V21" /><path d="M9.5 21v-5h5v5" /><path d="M8 9.5h2M14 9.5h2M8 13h2M14 13h2" /></>,
  encounters: <><rect x="5" y="4.5" width="14" height="16.5" rx="2.5" /><rect x="9" y="2.2" width="6" height="4" rx="1.4" /><path d="M8.5 12h7M8.5 16h4" /></>,
  support: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3.6" /><path d="M5.6 5.6l3.9 3.9M14.5 14.5l3.9 3.9M18.4 5.6l-3.9 3.9M9.5 14.5l-3.9 3.9" /></>,
  incident: <><circle cx="12" cy="12" r="9" /><path d="M12 7.4v5.2M12 16.2h.01" /></>,
  queue: <><rect x="4" y="4" width="16" height="16" rx="2.5" /><path d="M8 9h8M8 13h8M8 17h4.5" /></>,
  provision: <><circle cx="9" cy="8" r="3.2" /><path d="M2.6 20a6.4 6.4 0 0 1 12.8 0" /><path d="M18.5 7.5v6M15.5 10.5h6" /></>,
  release: <><path d="M5.2 15.2c-1.6 1.6-2.1 5.3-2.1 5.3s3.7-.5 5.3-2.1" /><path d="M14.4 4.4C17 1.8 21 2.9 21 2.9s1.1 4-1.5 6.6L14 15l-5-5 5.4-5.6Z" /><circle cx="15.6" cy="8.4" r="1.5" /></>,
  configuration: <><path d="M4 7.5h9.5M18.5 7.5H20M4 16.5h3.5M12.5 16.5H20" /><circle cx="16" cy="7.5" r="2.4" /><circle cx="10" cy="16.5" r="2.4" /></>,

  // ── Chrome ───────────────────────────────────────────────────────────────────────────────────────
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5.2M12 7.9h.01" /></>,
  spark: <path d="M12 3l1.9 5.3L19.2 10l-5.3 1.7L12 17l-1.9-5.3L4.8 10l5.3-1.7L12 3Z" />,
  chevron: <path d="M9.5 5.5l6.5 6.5-6.5 6.5" />,
  arrow: <path d="M4.5 12h14M13 6l6 6-6 6" />,
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "h-4 w-4" }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
