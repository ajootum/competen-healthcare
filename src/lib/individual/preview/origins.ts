// HQ-SCHOLAR-PREVIEW-01 -- WHICH ORIGINS THE PREVIEW MAY SEND A PERSON TO. Pure.
//
// Two origins are involved: the PREVIEW origin (where the learner's session lives) and the RETURN origin (the HQ host
// the person started from, where "Return to HQ" lands). Neither is ever taken from user input as-is: the preview
// origin is derived from the request host, and the return origin must be a registered Competen origin.

import { GATEWAYS, GATEWAY_KEYS, SCHOLAR_PREVIEW_DEV_HOST, SCHOLAR_PREVIEW_HOST, gatewayForHost, normaliseHost, gatewayOrigin } from "@/lib/identity/domains";

const DEV_NAMES: ReadonlySet<string> = new Set(GATEWAY_KEYS.flatMap(k => GATEWAYS[k].devHosts));

/** The port of a raw Host header ("" when absent). */
function portOf(rawHost: string | null | undefined): string {
  const first = (rawHost ?? "").trim().toLowerCase().split(",")[0].trim();
  const m = /:(\d{1,5})$/.exec(first);
  return m ? `:${m[1]}` : "";
}

/** True for a development host: localhost, 127.0.0.1 or a registered *.localhost alias. */
export function isDevHost(rawHost: string | null | undefined): boolean {
  const h = normaliseHost(rawHost);
  return h !== null && (DEV_NAMES.has(h) || h === SCHOLAR_PREVIEW_DEV_HOST);
}

/** The preview origin for a request that arrived on `requestHost`. Dev stays on http and the same port. */
export function previewOrigin(requestHost: string | null | undefined): string {
  return isDevHost(requestHost)
    ? `http://${SCHOLAR_PREVIEW_DEV_HOST}${portOf(requestHost)}`
    : `https://${SCHOLAR_PREVIEW_HOST}`;
}

/**
 * The return origin for a request that arrived on `requestHost`: that host, when the registry knows it, else the
 * public gateway. Never an arbitrary Host header value.
 */
export function returnOriginFor(requestHost: string | null | undefined): string {
  const h = normaliseHost(requestHost);
  if (h === null || gatewayForHost(h) === null) return gatewayOrigin("public");
  return isDevHost(h) ? `http://${h}${portOf(requestHost)}` : `https://${h}`;
}

/** Whether a string is exactly a registered Competen origin (a gateway host over https, or a dev host over http with an optional port). */
export function isRegisteredOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;
  let u: URL;
  try { u = new URL(origin); } catch { return false; }
  if (u.origin !== origin) return false; // no path, query, fragment, credentials, trailing slash
  const host = u.hostname.toLowerCase();
  if (u.protocol === "https:") return !u.port && GATEWAY_KEYS.some(k => GATEWAYS[k].host === host);
  if (u.protocol === "http:") return DEV_NAMES.has(host) && host !== SCHOLAR_PREVIEW_DEV_HOST;
  return false;
}

/** Same-origin check for a form POST: the Origin header, when present, must be this request's own origin. */
export function sameOrigin(originHeader: string | null | undefined, requestHost: string | null | undefined, proto: string): boolean {
  if (!originHeader || !requestHost) return false;
  let u: URL;
  try { u = new URL(originHeader); } catch { return false; }
  const own = (requestHost ?? "").trim().toLowerCase().split(",")[0].trim();
  return u.host.toLowerCase() === own && u.protocol === `${proto.replace(/:$/, "")}:`;
}
