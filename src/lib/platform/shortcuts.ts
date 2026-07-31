// Keyboard shortcuts (PUI-005 s2 "Keyboard Navigation").
//
// ONE table, consumed by both the binder that makes the shortcuts work and the Help page that documents
// them — so the documentation cannot describe a key the platform does not bind, and a new binding cannot
// ship undocumented. scripts/pui-header-harness.ts asserts the two stay in step.
//
// Deliberately NOT included: shortcuts the spec's mockup lists but the platform has no destination for.
// A documented key that does nothing is worse than an absent one.

export type Shortcut = {
  combo: string;        // normalised: lowercase key, modifiers in ctrl+shift+alt order
  display: string;      // what the Help page and tooltips show
  action: string;
  href?: string;        // navigations
  behaviour?: "focus-search" | "toggle-help";
};

// NOT INCLUDED, deliberately: the spec's mockup shows a "/" focus-search shortcut, but the platform has no
// global search to focus — the one search box that existed was decorative and was removed. A documented key
// that does nothing is worse than an absent one, so "/" returns here when a real global search does.
// Escape is likewise absent: it is handled locally by each menu, dialog and drawer, which is where focus
// restoration belongs, and a global handler would fight them.
export const SHORTCUTS: Shortcut[] = [
  { combo: "n",   display: "N",            action: "Open notifications",        href: "/dashboard/notifications" },
  { combo: "m",   display: "M",            action: "Open messages",             href: "/dashboard/messages" },
  { combo: "g+h", display: "G then H",     action: "Go to your dashboard",      href: "/dashboard" },
  { combo: "g+p", display: "G then P",     action: "Go to Competency Passport", href: "/dashboard/passport" },
  { combo: "g+l", display: "G then L",     action: "Go to Learning",            href: "/dashboard/learning" },
  { combo: "?",   display: "?",            action: "Keyboard shortcuts help",   href: "/dashboard/help" },
];

// A shortcut must never fire while the user is typing, or "/" becomes unusable in any note field.
export function isTypingTarget(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || t.isContentEditable === true;
}
