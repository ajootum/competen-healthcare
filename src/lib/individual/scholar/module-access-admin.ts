/* eslint-disable @typescript-eslint/no-explicit-any */
// ── PRIVATE MODULE DEVELOPMENT ACCESS: THE HQ HALF ── owner GO 2 Nov 2026 ───────────────────────────────────────
//
// What the Individual configuration screen and its route need to turn an email address an administrator typed into an account id
// (the only thing the policy stores), to check each stored id is an account, and to show a name and email beside an id.
// It reads the profiles and nothing else. It never writes. Used by /api/hq/individual/config (guarded by
// hq.individual.config.manage) and by the HQ page; nothing in the learner application imports it.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Pure: an email address typed by an administrator, trimmed and lower-cased, or null when it is not one. */
export function normaliseAccountEmail(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254 ? s : null;
}

export type AccountLabel = { id: string; name: string | null; email: string | null };
export type AccountLookup = { ok: true; found: false } | { ok: true; found: true; account: AccountLabel } | { ok: false; message: string };

/** One account by its exact email address, case-insensitive (LIKE wildcards escaped, so it is never a pattern search). Two accounts with one address is refused. */
export async function resolveAccountByEmail(admin: any, email: string): Promise<AccountLookup> {
  const pattern = email.replace(/[\%_]/g, c => "\\" + c);
  const { data, error } = await admin.from("profiles").select("id, full_name, email").ilike("email", pattern).limit(2);
  if (error) return { ok: false, message: "The account could not be looked up just now. Nothing has changed." };
  const rows = (data ?? []) as { id: string; full_name: string | null; email: string | null }[];
  if (rows.length === 0) return { ok: true, found: false };
  if (rows.length > 1) return { ok: false, message: "More than one account carries that email address. Resolve that in Users first." };
  return { ok: true, found: true, account: { id: String(rows[0].id).toLowerCase(), name: rows[0].full_name ?? null, email: rows[0].email ?? null } };
}

/** The name and email of each id that is an account. An id with no account is absent from the result. Unreadable: null. */
export async function labelAccounts(admin: any, ids: readonly string[]): Promise<Map<string, AccountLabel> | null> {
  const clean = [...new Set(ids.filter(i => UUID.test(i)).map(i => i.toLowerCase()))];
  const out = new Map<string, AccountLabel>();
  if (clean.length === 0) return out;
  const { data, error } = await admin.from("profiles").select("id, full_name, email").in("id", clean);
  if (error) return null;
  for (const r of (data ?? []) as { id: string; full_name: string | null; email: string | null }[]) {
    const id = String(r.id).toLowerCase();
    out.set(id, { id, name: r.full_name ?? null, email: r.email ?? null });
  }
  return out;
}
