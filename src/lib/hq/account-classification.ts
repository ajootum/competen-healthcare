/**
 * HQ-USERS-CLASSIFY-01 -- what kind of account a profile is (Human, Demo, Test, System / Service, Unclassified).
 *
 * ⚠ AN ADMINISTRATIVE ATTRIBUTE, NEVER AN AUTHORITY. It is read for filtering, counting and reporting only. Nothing
 * that admits, refuses, grants or revokes may read it: a "demo" label on a real person must never cost them access,
 * and a "human" label must never give any. Status (active, pending, suspended) stays a separate fact from Auth.
 *
 * ⚠ EVIDENCE ONLY. Migration 650 classified an account as Demo or Test only where a seed or fixture in the repository
 * is provably its creator. Everything else is Unclassified until an authorised person reviews it -- never by email
 * domain, name, missing login or unverified email.
 *
 * ⚠ FAILS SAFE WITHOUT 650. An unreadable table answers `available: false` and every account Unclassified, and the
 * Users screen then opens on All Accounts (today's behaviour) instead of an empty "Active Humans" list.
 */

export const ACCOUNT_TYPES = ["human", "demo", "test", "system", "unclassified"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  human: "Human", demo: "Demo", test: "Test", system: "System / Service", unclassified: "Unclassified",
};

export const isAccountType = (x: unknown): x is AccountType => typeof x === "string" && (ACCOUNT_TYPES as readonly string[]).includes(x);

/** The Users screen's account views. Must match the CHECK on hq_config.users_default_view (migration 650). */
export const USER_VIEWS = ["active_humans", "all_humans", "pending", "demo", "test", "system", "unclassified", "all"] as const;
export type UserView = (typeof USER_VIEWS)[number];

export const USER_VIEW_LABEL: Record<UserView, string> = {
  active_humans: "Active Humans", all_humans: "All Humans", pending: "Pending Invitations", demo: "Demo",
  test: "Test", system: "System", unclassified: "Unclassified", all: "All Accounts",
};

/** What each view admits, said in words on the screen so the filter is never a black box. */
export const USER_VIEW_RULE: Record<UserView, string> = {
  active_humans: "Classified Human and status Active",
  all_humans: "Classified Human, any status",
  pending: "Status Pending (invitation sent or email not yet verified), any classification",
  demo: "Classified Demo", test: "Classified Test", system: "Classified System / Service",
  unclassified: "Not yet classified",
  all: "Every account",
};

export const isUserView = (x: unknown): x is UserView => typeof x === "string" && (USER_VIEWS as readonly string[]).includes(x);

export const PRODUCT_DEFAULT_VIEW: UserView = "active_humans";
/** Without 650 nobody is Human, so Active Humans would be empty. Fall back to today's screen. */
export const FALLBACK_VIEW: UserView = "all";

export type AccountStatus = "active" | "pending" | "suspended";
export type Classifiable = { accountType: AccountType; status: AccountStatus };

export function viewMatches(view: UserView, r: Classifiable): boolean {
  switch (view) {
    case "active_humans": return r.accountType === "human" && r.status === "active";
    case "all_humans": return r.accountType === "human";
    case "pending": return r.status === "pending";
    case "demo": case "test": case "system": case "unclassified": return r.accountType === view;
    case "all": return true;
  }
}

export function countViews(rows: Classifiable[]): Record<UserView, number> {
  const out = Object.fromEntries(USER_VIEWS.map(v => [v, 0])) as Record<UserView, number>;
  for (const r of rows) for (const v of USER_VIEWS) if (viewMatches(v, r)) out[v]++;
  return out;
}

/**
 * The analytics split (directive s6): genuine active humans, pending humans, demo, test, system and unclassified.
 * The all-accounts figure is kept beside it, so a previously reported number is shown, not silently replaced.
 */
export type ClassificationBreakdown = {
  available: boolean; all: number; activeHumans: number; pendingHumans: number; humans: number;
  demo: number; test: number; system: number; unclassified: number;
};

export function breakdown(rows: Classifiable[], available: boolean): ClassificationBreakdown {
  const b: ClassificationBreakdown = { available, all: rows.length, activeHumans: 0, pendingHumans: 0, humans: 0, demo: 0, test: 0, system: 0, unclassified: 0 };
  for (const r of rows) {
    if (r.accountType === "human") {
      b.humans++;
      if (r.status === "active") b.activeHumans++;
      if (r.status === "pending") b.pendingHumans++;
    } else b[r.accountType]++;
  }
  return b;
}

/** One sentence for an analytics card's subline: what the headline figure contains. */
export function breakdownLine(b: ClassificationBreakdown): string {
  if (!b.available) return "account classification not yet available";
  return `${b.activeHumans} active human · ${b.unclassified} unclassified · ${b.demo + b.test} demo/test · ${b.system} system`;
}

export type ClassificationMap = { available: boolean; byId: Map<string, AccountType> };

/** The type of one profile. Absent row = Unclassified (the table's default, without a write). */
export const typeOf = (m: ClassificationMap, id: string): AccountType => m.byId.get(id) ?? "unclassified";

/**
 * For an analytics card that counts profiles without their Auth status (HQ home, Platform Operations): how many of
 * the counted accounts are of each type. The card keeps its all-accounts figure and shows this beside it.
 */
export type TypeCounts = { available: boolean; all: number } & Record<AccountType, number>;

export function typeCounts(ids: string[], m: ClassificationMap): TypeCounts {
  const c: TypeCounts = { available: m.available, all: ids.length, human: 0, demo: 0, test: 0, system: 0, unclassified: 0 };
  for (const id of ids) c[typeOf(m, id)]++;
  return c;
}

/** "N human · N unclassified · N demo/test · N system", or the card's old subline while 650 is absent. */
export const typeCountsLine = (c: TypeCounts, fallback: string): string =>
  !c.available ? fallback : `${c.human} human · ${c.unclassified} unclassified · ${c.demo + c.test} demo/test · ${c.system} system`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadClassifications(admin: any): Promise<ClassificationMap> {
  const byId = new Map<string, AccountType>();
  try {
    const { data, error } = await admin.from("hq_account_classification").select("profile_id, account_type").limit(100000);
    if (error) return { available: false, byId };
    for (const r of (data ?? []) as { profile_id: string; account_type: string }[]) {
      if (isAccountType(r.account_type)) byId.set(r.profile_id, r.account_type);
    }
    return { available: true, byId };
  } catch {
    return { available: false, byId };
  }
}

/** hq_config.users_default_view, or the safe fallback. Never throws. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadDefaultView(admin: any, available: boolean): Promise<UserView> {
  if (!available) return FALLBACK_VIEW;
  try {
    const { data, error } = await admin.from("hq_config").select("users_default_view").eq("id", "singleton").limit(1);
    const v = (data?.[0] as { users_default_view?: string } | undefined)?.users_default_view;
    return !error && isUserView(v) ? v : PRODUCT_DEFAULT_VIEW;
  } catch {
    return PRODUCT_DEFAULT_VIEW;
  }
}

/** The request body of POST /api/super-admin/users/classification, checked before any database call. */
export const MAX_BULK = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ClassifyRequest =
  | { action: "classify"; userIds: string[]; accountType: AccountType; reason: string }
  | { action: "set_default_view"; view: UserView };

export function parseClassifyRequest(body: unknown): { ok: true; req: ClassifyRequest } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.action === "set_default_view") {
    return isUserView(b.view) ? { ok: true, req: { action: "set_default_view", view: b.view } } : { ok: false, error: "A valid view is required" };
  }
  if (b.action !== "classify") return { ok: false, error: "action must be classify or set_default_view" };
  if (!isAccountType(b.accountType)) return { ok: false, error: "A valid account type is required" };
  if (!Array.isArray(b.userIds) || b.userIds.length === 0) return { ok: false, error: "Select at least one account" };
  if (b.userIds.length > MAX_BULK) return { ok: false, error: `At most ${MAX_BULK} accounts at a time` };
  if (!b.userIds.every(id => typeof id === "string" && UUID.test(id))) return { ok: false, error: "Every account id must be a UUID" };
  const reason = typeof b.reason === "string" ? b.reason.trim() : "";
  if (reason.length < 3) return { ok: false, error: "A reason of at least 3 characters is required" };
  if (reason.length > 500) return { ok: false, error: "The reason is limited to 500 characters" };
  return { ok: true, req: { action: "classify", userIds: [...new Set(b.userIds as string[])], accountType: b.accountType, reason } };
}
