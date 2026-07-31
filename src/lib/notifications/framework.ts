// Platform Notification, Messaging & Alert Framework (PUI-006) — migration 161.
//
// THE PROBLEM THIS SOLVES. The platform writes 242 distinct notification `type` values. Priority was not
// stored; it was GUESSED downstream from a hard-coded list of about a dozen type names, so roughly 230
// types silently resolved to "low". A safety alert and a course reminder were indistinguishable to every
// consumer but that one loader.
//
// Here priority is a property of the notification, decided ONCE at write time from a single table, and
// everything that follows -- whether acknowledgement is required, how long before it escalates, which
// channels carry it, whether quiet hours may silence it -- is derived from that one decision. Behaviour
// therefore cannot drift from severity.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { priority as PRIORITY_TOKENS, type PriorityKey } from "@/lib/design/tokens";
// ── PUI-006 s1: the six notification types ──────────────────────────────────────────────────────────────
export const CATEGORIES = {
  information:   { label: "Information",   icon: "ℹ", blurb: "General updates and informational messages." },
  reminder:      { label: "Reminder",      icon: "⏰", blurb: "Reminders for tasks, deadlines and activities." },
  clinical_alert:{ label: "Clinical Alert",icon: "❤", blurb: "Patient or clinical condition changes." },
  safety_alert:  { label: "Safety Alert",  icon: "⚠", blurb: "High-risk or patient safety incidents." },
  escalation:    { label: "Escalation",    icon: "⬆", blurb: "Escalated issues requiring attention." },
  announcement:  { label: "Announcement",  icon: "\u{1F4E3}", blurb: "Organisation-wide announcements." },
} as const;
export type Category = keyof typeof CATEGORIES;
export const CATEGORY_KEYS = Object.keys(CATEGORIES) as Category[];

export type Priority = PriorityKey;
export const PRIORITY_ORDER: Priority[] = ["critical", "high", "medium", "low"];
export const STATES = ["unread", "read", "acknowledged", "escalated", "resolved"] as const;
export type NotifState = typeof STATES[number];

// ── The one table that decides behaviour from priority (PUI-006 s2 + s7) ────────────────────────────────
// requiresAck comes from the design tokens rather than being restated, so the badge a user sees and the
// behaviour they get are guaranteed to come from the same source.
export const BEHAVIOUR: Record<Priority, {
  requiresAck: boolean; escalateAfterMin: number | null; channels: ("in_app" | "email" | "sms" | "push")[];
  persistent: boolean; silenceableByQuietHours: boolean;
}> = {
  critical: { requiresAck: PRIORITY_TOKENS.critical.requiresAck, escalateAfterMin: 5,  channels: ["in_app", "push", "sms", "email"], persistent: true,  silenceableByQuietHours: false },
  high:     { requiresAck: PRIORITY_TOKENS.high.requiresAck,     escalateAfterMin: 30, channels: ["in_app", "push", "email"],        persistent: true,  silenceableByQuietHours: false },
  medium:   { requiresAck: PRIORITY_TOKENS.medium.requiresAck,   escalateAfterMin: null, channels: ["in_app", "email"],              persistent: false, silenceableByQuietHours: true  },
  low:      { requiresAck: PRIORITY_TOKENS.low.requiresAck,      escalateAfterMin: null, channels: ["in_app"],                        persistent: false, silenceableByQuietHours: true  },
};

// ── Category -> default priority ────────────────────────────────────────────────────────────────────────
// A caller may raise a notification above its category default but never below it: a safety alert cannot be
// filed as "low" by a careless call site. clampPriority enforces that.
export const CATEGORY_FLOOR: Record<Category, Priority> = {
  safety_alert: "high",
  clinical_alert: "high",
  escalation: "high",
  reminder: "low",
  announcement: "low",
  information: "low",
};

const rank = (p: Priority) => PRIORITY_ORDER.indexOf(p);

export function clampPriority(category: Category, requested?: Priority | null): Priority {
  const floor = CATEGORY_FLOOR[category] ?? "low";
  if (!requested) return floor === "low" ? "medium" : floor;
  // Lower rank index = more severe. Never allow LESS severe than the category floor.
  return rank(requested) <= rank(floor) ? requested : floor;
}

// ── Type -> category, for the 242 legacy `type` values ───────────────────────────────────────────────────
// Deliberately conservative: a type that does not clearly signal clinical risk stays "information". Guessing
// a course reminder is a safety alert is as wrong as the reverse, and the fix for a mis-categorised type is
// for its CALL SITE to declare a category, not for this list to grow indefinitely.
const CLINICAL = /^(patient_|obs_|pews|deterioration|acuity|med_|medication_|assignment_|transfer_|concern)/;
const SAFETY = /^(safety|incident|fall|pressure|infection|harm|never_event)/;
const ESCALATION = /(escalat|rapid_response|code_|emergency)/;
const REMINDER = /(due|reminder|overdue|expiry|expiring|renewal|scheduled)/;
const ANNOUNCEMENT = /^(announcement|broadcast|policy_|system_notice)/;

export function categoryOfType(type: string): Category {
  const t = String(type ?? "").toLowerCase();
  if (ESCALATION.test(t)) return "escalation";
  if (SAFETY.test(t)) return "safety_alert";
  if (CLINICAL.test(t)) return "clinical_alert";
  if (ANNOUNCEMENT.test(t)) return "announcement";
  if (REMINDER.test(t)) return "reminder";
  return "information";
}

// ── Quiet hours (PUI-006 s6) ────────────────────────────────────────────────────────────────────────────
export type Prefs = {
  in_app: boolean; email: boolean; sms: boolean; push: boolean;
  quiet_from: string | null; quiet_to: string | null;
  muted_categories: string[]; min_priority: Priority;
};

export const DEFAULT_PREFS: Prefs = {
  in_app: true, email: true, sms: false, push: true,
  quiet_from: null, quiet_to: null, muted_categories: [], min_priority: "low",
};

// A quiet window may wrap midnight (22:00 -> 07:00), which a naive from<=now<=to comparison gets wrong.
export function inQuietHours(prefs: Prefs, at: Date): boolean {
  if (!prefs.quiet_from || !prefs.quiet_to) return false;
  const mins = at.getHours() * 60 + at.getMinutes();
  const toMin = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + (m || 0); };
  const from = toMin(prefs.quiet_from), to = toMin(prefs.quiet_to);
  return from <= to ? mins >= from && mins < to : mins >= from || mins < to;
}

// Which channels actually carry this notification for this user, right now.
//
// THE RULE THAT MATTERS: a critical alert is never silenced. Not by quiet hours, not by a muted category,
// not by a min_priority filter. A user can quieten their evening; they cannot quieten a patient
// deteriorating. Every suppression path below checks `silenceableByQuietHours` / priority first.
export function resolveChannels(
  category: Category, priority: Priority, prefs: Prefs, at: Date,
): { channels: string[]; suppressed: string[]; reason: string | null } {
  const behaviour = BEHAVIOUR[priority];
  const never = !behaviour.silenceableByQuietHours;   // critical + high

  if (!never) {
    if (prefs.muted_categories.includes(category)) {
      return { channels: [], suppressed: behaviour.channels, reason: `user muted ${CATEGORIES[category].label}` };
    }
    if (rank(priority) > rank(prefs.min_priority)) {
      return { channels: [], suppressed: behaviour.channels, reason: `below the user's minimum priority (${prefs.min_priority})` };
    }
    if (inQuietHours(prefs, at)) {
      // Quiet hours do not delete the notification — it still lands in-app for when they look.
      return { channels: ["in_app"], suppressed: behaviour.channels.filter(c => c !== "in_app"), reason: "quiet hours" };
    }
  }

  // A critical/high alert overrides DISABLED CHANNELS too — the preference filter must not run for them,
  // or turning off SMS would quietly silence a deteriorating patient. It says so rather than pretending
  // the user chose this.
  const disabled = behaviour.channels.filter(c => (prefs as any)[c] === false);
  if (never) {
    return {
      channels: behaviour.channels,
      suppressed: [],
      reason: disabled.length ? "priority overrides channel preferences" : null,
    };
  }
  const enabled = behaviour.channels.filter(c => (prefs as any)[c] !== false);
  return {
    channels: enabled,
    suppressed: disabled,
    reason: disabled.length ? "channel disabled by user" : null,
  };
}

// ── State machine (PUI-006 s7) ──────────────────────────────────────────────────────────────────────────
// Terminal states are terminal: a resolved alert cannot silently reopen, which would let an old row
// resurface as if it were new.
const TRANSITIONS: Record<NotifState, NotifState[]> = {
  unread:       ["read", "acknowledged", "escalated", "resolved"],
  read:         ["acknowledged", "escalated", "resolved"],
  acknowledged: ["resolved"],
  escalated:    ["acknowledged", "resolved"],
  resolved:     [],
};

export function canTransition(from: NotifState, to: NotifState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

// Reading is not acknowledging. A critical alert that requires acknowledgement stays outstanding until the
// user explicitly acknowledges it, however many times they have looked at it.
export function isOutstanding(n: { requires_ack?: boolean | null; state?: string | null }): boolean {
  if (!n.requires_ack) return n.state === "unread";
  return n.state === "unread" || n.state === "read" || n.state === "escalated";
}

// Due for escalation: requires acknowledgement, still outstanding, past its window, not already escalated.
export function escalationDue(
  n: { requires_ack?: boolean | null; state?: string | null; created_at?: string | null; escalate_after_min?: number | null },
  now = Date.now(),
): boolean {
  if (!n.requires_ack || !n.created_at) return false;
  if (n.state === "acknowledged" || n.state === "resolved" || n.state === "escalated") return false;
  const window = n.escalate_after_min;
  if (window == null) return false;
  return now - new Date(n.created_at).getTime() >= window * 60_000;
}

// ── Building a notification row ─────────────────────────────────────────────────────────────────────────
export type NotifyInput = {
  type: string; title: string; body?: string | null; href?: string | null;
  category?: Category; priority?: Priority;
  entityType?: string | null; entityId?: string | null; hospitalId?: string | null;
  expiresAt?: string | null;
};

// One place decides category, priority, ack requirement and escalation window — so a row can never claim
// critical severity while behaving like an FYI.
export function buildNotification(userId: string, input: NotifyInput) {
  const category = input.category ?? categoryOfType(input.type);
  const priority = clampPriority(category, input.priority);
  const behaviour = BEHAVIOUR[priority];
  return {
    user_id: userId,
    type: input.type,
    title: input.title,
    body: input.body ?? null,
    href: input.href ?? null,
    category,
    priority,
    state: "unread" as NotifState,
    read: false,
    requires_ack: behaviour.requiresAck,
    escalate_after_min: behaviour.escalateAfterMin,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    hospital_id: input.hospitalId ?? null,
    expires_at: input.expiresAt ?? null,
  };
}
