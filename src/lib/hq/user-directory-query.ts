/**
 * HQ-USERS-CLASSIFY-01 -- the Users directory's filters and pagination, run on the SERVER.
 *
 * The screen used to receive every profile and filter in the browser. It now receives one page. The rules below
 * are the same rules the workspace applied (search, role, organisation, facility, status, last login, product,
 * HQ position), plus the account view, so a URL is the whole query and the CSV export answers the same rows.
 * Pure: no I/O, so the tests can pin it.
 */
import { USER_VIEWS, isUserView, viewMatches, type AccountStatus, type AccountType, type UserView } from "./account-classification";

export const PAGE_SIZE = 25;

export type DirectoryFilters = {
  view: UserView; q: string; role: string; org: string; facility: string;
  status: string; login: string; product: string; hq: string; page: number;
};

export type FilterableRow = {
  name: string; email: string; phone: string | null; roles: string[];
  organisationId: string | null; hospitalId: string | null;
  status: AccountStatus; lastSignIn: string | null; products: string[]; hqActive: boolean;
  accountType: AccountType;
};

type Params = Record<string, string | string[] | undefined>;
const one = (p: Params, k: string) => { const v = p[k]; return (Array.isArray(v) ? v[0] : v) ?? ""; };
const pick = (v: string, allowed: readonly string[]) => (allowed.includes(v) ? v : "all");
const free = (v: string) => (v && v.length <= 64 ? v : "all");

export function parseDirectoryFilters(p: Params, defaultView: UserView): DirectoryFilters {
  const v = one(p, "view");
  const page = Number.parseInt(one(p, "page"), 10);
  return {
    view: isUserView(v) ? v : defaultView,
    q: one(p, "q").slice(0, 120),
    role: free(one(p, "role")),
    org: free(one(p, "org")),
    facility: free(one(p, "facility")),
    status: pick(one(p, "status"), ["active", "pending", "suspended"]),
    login: pick(one(p, "login"), ["today", "7d", "30d", "never"]),
    product: pick(one(p, "product"), ["platform", "enterprise", "practice", "individual", "none"]),
    hq: pick(one(p, "hq"), ["yes", "no"]),
    // 1-based in the URL, 0-based here.
    page: Number.isFinite(page) && page > 1 ? page - 1 : 0,
  };
}

/** The query string for a filter set. Defaults are left out, so the bare URL means "the configured default". */
export function toQueryString(f: DirectoryFilters, defaultView: UserView): string {
  const s = new URLSearchParams();
  if (f.view !== defaultView) s.set("view", f.view);
  if (f.q.trim()) s.set("q", f.q.trim());
  for (const k of ["role", "org", "facility", "status", "login", "product", "hq"] as const) if (f[k] !== "all") s.set(k, f[k]);
  if (f.page > 0) s.set("page", String(f.page + 1));
  return s.toString();
}

/** Every filter EXCEPT the account view: what the view chips' counts are taken over. */
export function matchesOtherFilters(u: FilterableRow, f: DirectoryFilters, now: number): boolean {
  const q = f.q.trim().toLowerCase();
  if (q && !u.name.toLowerCase().includes(q) && !u.email.toLowerCase().includes(q) && !(u.phone ?? "").toLowerCase().includes(q)) return false;
  if (f.role !== "all" && !u.roles.includes(f.role)) return false;
  if (f.org !== "all" && u.organisationId !== f.org) return false;
  if (f.facility !== "all" && u.hospitalId !== f.facility) return false;
  if (f.status !== "all" && u.status !== f.status) return false;
  if (f.login !== "all") {
    const age = u.lastSignIn ? (now - new Date(u.lastSignIn).getTime()) / 86400000 : Infinity;
    if (f.login === "today" && age > 1) return false;
    if (f.login === "7d" && age > 7) return false;
    if (f.login === "30d" && age > 30) return false;
    if (f.login === "never" && u.lastSignIn) return false;
  }
  if (f.product === "none" && u.products.length > 0) return false;
  if (f.product !== "all" && f.product !== "none" && !u.products.includes(f.product)) return false;
  if (f.hq === "yes" && !u.hqActive) return false;
  if (f.hq === "no" && u.hqActive) return false;
  return true;
}

/** The stat cards' portals, in screen order. */
export const STAT_ROLES = ["super_admin", "hospital_admin", "educator", "assessor", "nurse"] as const;
export type DirectoryStats = { total: number; active: number; byRole: Record<string, { count: number; active: number }> };

/** The stat cards, counted over whatever rows they are given (the page passes the selected account view). */
export function directoryStats(rows: Pick<FilterableRow, "roles" | "status">[]): DirectoryStats {
  const byRole = Object.fromEntries(STAT_ROLES.map(r => [r, { count: 0, active: 0 }])) as DirectoryStats["byRole"];
  let active = 0;
  for (const u of rows) {
    const on = u.status === "active";
    if (on) active++;
    for (const r of STAT_ROLES) if (u.roles.includes(r)) { byRole[r].count++; if (on) byRole[r].active++; }
  }
  return { total: rows.length, active, byRole };
}

export type DirectoryResult<T> = {
  rows: T[]; total: number; page: number; pages: number;
  /** Each view's count under the other filters, so a chip says how many rows clicking it would show. */
  viewCounts: Record<UserView, number>;
  /** All rows matching every filter (for the export). */
  matched: T[];
};

export function queryDirectory<T extends FilterableRow>(all: T[], f: DirectoryFilters, now: number = Date.now(), size = PAGE_SIZE): DirectoryResult<T> {
  const others = all.filter(u => matchesOtherFilters(u, f, now));
  const viewCounts = Object.fromEntries(USER_VIEWS.map(v => [v, 0])) as Record<UserView, number>;
  for (const u of others) for (const v of USER_VIEWS) if (viewMatches(v, u)) viewCounts[v]++;
  const matched = others.filter(u => viewMatches(f.view, u));
  const pages = Math.max(1, Math.ceil(matched.length / size));
  const page = Math.min(f.page, pages - 1);
  return { rows: matched.slice(page * size, (page + 1) * size), total: matched.length, page, pages, viewCounts, matched };
}
