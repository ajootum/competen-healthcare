import type { AccountType } from "@/lib/hq/account-classification";

// Shared look-ups for the Users directory and its profile. Moved out of UsersWorkspace.tsx so the directory table and
// the detail workspace use ONE set, with no import cycle between the two components.

export const TYPE_PILL: Record<AccountType, string> = {
  human: "bg-[var(--cmp-surface-information)] text-[var(--cmp-text-information)]",
  demo: "bg-purple-100 text-purple-700",
  test: "bg-amber-100 text-amber-800",
  system: "bg-slate-200 text-slate-700",
  unclassified: "bg-gray-100 text-gray-600",
};

export const ROLE_BADGE: Record<string, string> = {
  nurse:          "bg-teal-100 text-teal-700",
  assessor:       "bg-indigo-100 text-indigo-700",
  educator:       "bg-purple-100 text-purple-700",
  hospital_admin: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]",
  super_admin:    "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]",
};

// "pending" is shown as "Invited": the invitation went out and the person has not finished signing in. The filter value
// and the stored status stay "pending".
export const STATUS_UI = {
  active:    { label: "Active",    pill: "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]",  dot: "bg-[var(--cmp-color-success)]" },
  pending:   { label: "Invited",   pill: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]",  dot: "bg-[var(--cmp-color-warning)]" },
  suspended: { label: "Suspended", pill: "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]",      dot: "bg-[var(--cmp-color-critical)]" },
} as const;

const AVATAR_TINTS = ["bg-teal-700", "bg-indigo-600", "bg-[var(--cmp-color-error)]", "bg-[var(--cmp-color-warning)]", "bg-violet-600", "bg-[var(--cmp-color-information)]"];
export const tint = (id: string) => AVATAR_TINTS[[...id].reduce((s, ch) => s + ch.charCodeAt(0), 0) % AVATAR_TINTS.length];

export const relTime = (iso: string | null) => {
  if (!iso) return "Never";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
};
