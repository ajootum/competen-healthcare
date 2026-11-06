// LIFEOS-API-001 delivery step 7. What a request's host means. It imports nothing, because src/proxy.ts runs it on every
// request: the one recorded place where the rest of the application reaches into LifeOS (scripts/lifeos-seal-harness.ts).
//
// INERT UNLESS LIFEOS_TENANT_HOSTS=1 on the server. With it unset, every request behaves exactly as it did before this
// file existed. Only domains attached to the Vercel project reach this code, so a host that is not first-party is a tenant's.
// A tenant's host serves LifeOS and nothing else. The hostname never grants access: the page and the API still check it.

export const LIFEOS_TENANT_HOSTS_ENV = "LIFEOS_TENANT_HOSTS";

const FIRST_PARTY_SUFFIXES = ["competenhealthcare.com", "vercel.app", "localhost"];
const FIRST_PARTY_EXACT = ["127.0.0.1", "[::1]", "::1"];

export function normaliseHost(raw: string | null | undefined): string | null {
  const h = (raw ?? "").trim().toLowerCase();
  if (!h) return null;
  if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1);
  return h.split(":")[0] || null;
}

export function isFirstPartyHost(host: string): boolean {
  if (FIRST_PARTY_EXACT.includes(host)) return true;
  return FIRST_PARTY_SUFFIXES.some(s => host === s || host.endsWith(`.${s}`));
}

export type TenantRoute = { kind: "pass" } | { kind: "rewrite"; pathname: string } | { kind: "block" };

/** Null: this request is not a tenant's, so nothing here applies. */
export function lifeosTenantRoute(rawHost: string | null, pathname: string, enabled: boolean): TenantRoute | null {
  if (!enabled) return null;
  const host = normaliseHost(rawHost);
  if (!host || isFirstPartyHost(host)) return null;
  if (pathname === "/") return { kind: "rewrite", pathname: "/lifeos" };
  if (pathname === "/lifeos" || pathname.startsWith("/lifeos/") || pathname.startsWith("/api/lifeos/") || pathname.startsWith("/_next/")) return { kind: "pass" };
  return { kind: "block" };
}

/** A name a tenant may claim: a real public hostname, and never ours. */
export function validTenantHostname(raw: string): string | null {
  const h = raw.trim().toLowerCase();
  if (h.length > 253 || !/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(h)) return null;
  return isFirstPartyHost(h) ? null : h;
}
