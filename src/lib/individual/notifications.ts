/* eslint-disable @typescript-eslint/no-explicit-any */

// ── NOTICES IN THE PERSON'S OWN ACCOUNT ── migration 466, owner: "Use notifications in the user account, not Email" ──
//
// One store for every Individual notice, read on the person's home (HomeNotices) and marked read there. Reusable: a
// notice is a kind, a short text, an optional same-site link and a dedupe key.
//
// ⚠ NOT THE ESTATE `notifications` TABLE. Its rows are counted by type across every user on estate consoles, and an
// Individual-only person has no inbox to read them in (ADR-016 D1, owner ruling D1). Nothing here writes it, and
// nothing here sends email.
//
// ⚠ THE TEXT NAMES NO COURSE OR RECORD. A notice body is safe to show anywhere, including any email-like surface that
// may read it later. The link carries the person to the detail, which is behind their own sign-in.
//
// ⚠ ONCE, BY CONSTRUCTION. 466's unique index on (user_id, kind, dedupe_key) makes a second notice for the same thing
// impossible, so a retry or an overlapping job run is harmless: the conflict reads as "already".
//
// ⚠ ABSENT IS TOLERATED. Until 466 is applied, posting returns "unavailable" and the panel shows nothing. Every caller
// is already behind its own gate (the CPD duplicate rule is behind Learning's learning_app flag, off by default).

export const NOTIFICATION_TABLE = "individual_notification";
const KIND = /^[a-z][a-z0-9_]{2,60}$/;
const missing = (e: any) => /does not exist|schema cache|could not find/i.test(e?.message ?? "");

export type IndividualNotice = { id: string; kind: string; body: string; href: string | null; createdAt: string; readAt: string | null };
export type PostResult = "posted" | "already" | "unavailable" | "failed";

/** Pure: a same-site link only, never another host. */
export const safeHref = (href: string | null | undefined) => (typeof href === "string" && /^\/[^/]/.test(href) && href.length <= 300 ? href : null);

/** Post one notice to one person. Never throws. */
export async function postNotice(admin: any, userId: string, n: { kind: string; body: string; href?: string | null; dedupeKey: string }): Promise<PostResult> {
  if (!KIND.test(n.kind) || !n.body || n.body.length > 400 || !n.dedupeKey || n.dedupeKey.length > 200) return "failed";
  try {
    const { error } = await admin.from(NOTIFICATION_TABLE).insert({ user_id: userId, kind: n.kind, body: n.body, href: safeHref(n.href), dedupe_key: n.dedupeKey });
    if (!error) return "posted";
    if (error.code === "23505") return "already";
    return missing(error) ? "unavailable" : "failed";
  } catch { return "failed"; }
}

/** The person's own notices, newest first. null = could not be read. `available` false = 466 is not on this environment. */
export async function loadNotices(admin: any, userId: string, limit = 20): Promise<{ available: boolean; items: IndividualNotice[] } | null> {
  try {
    const { data, error } = await admin.from(NOTIFICATION_TABLE).select("id, kind, body, href, created_at, read_at")
      .eq("user_id", userId).order("created_at", { ascending: false }).limit(limit);
    if (error) return missing(error) ? { available: false, items: [] } : null;
    return { available: true, items: (data ?? []).map((r: any) => ({ id: r.id, kind: r.kind, body: r.body, href: safeHref(r.href), createdAt: r.created_at, readAt: r.read_at ?? null })) };
  } catch { return null; }
}

/** Mark one of the person's OWN notices read. Another person's notice, or one already read, changes nothing. */
export async function markNoticeRead(admin: any, userId: string, id: string): Promise<boolean> {
  try {
    const { data, error } = await admin.from(NOTIFICATION_TABLE).update({ read_at: new Date().toISOString() })
      .eq("id", id).eq("user_id", userId).is("read_at", null).select("id");
    return !error && (data ?? []).length > 0;
  } catch { return false; }
}
