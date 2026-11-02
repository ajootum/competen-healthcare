// HQ-SCHOLAR-PREVIEW-01 -- WHAT THE PREVIEW HOST MAY SERVE. Pure: no request object, no database, no next/*.
//
// The preview host (preview.<domain>) serves the SAME application as the main host, so without a fence it
// would answer /super-admin, /login, /practice and every API. This module is the fence: given the host, the
// path, the method and the preview mode, it says whether the request is allowed, is a 404 (the surface does
// not exist on this host), or is refused 403 (the surface exists but this method is not allowed in this mode).
//
// ⚠ DEFAULT DENY. Only the families listed below are served. A path nobody classified is a 404.
// ⚠ PATHS ARE DECODED AND NORMALISED BEFORE THEY ARE JUDGED. Next routes on the decoded path, so a rule that
//   compared the raw string would be bypassed by `/individual/%73ign-in` or `/api//hq` or `/individual/../login`.
// ⚠ SERVER ACTIONS. A Next server action is an HTTP POST to the PAGE's own path. There are none under
//   src/app/individual today (grep "use server"), and the non-GET rule below would refuse one anyway: a page path is
//   never on the testing-mode write list, so read-only AND testing both refuse a POST to a page.

import { isPreviewHost } from "@/lib/identity/domains";

export type PreviewMode = "read_only" | "testing";

export type PreviewDecision =
  | { action: "allow"; kind: PathKind }
  | { action: "not_found"; reason: string }
  | { action: "forbidden"; reason: string };

/**
 * What a path is, for the preview host:
 *  - asset    a static or Next-internal file. No session needed.
 *  - preview  /preview/*. Its route handlers decide (enter and ended need no session).
 *  - session  /individual/** and /api/individual/**. A live preview session is required.
 */
export type PathKind = "asset" | "preview" | "session";

/** The first segment under /individual that is NOT part of the preview (their own sign-in, joining, money, access desk). */
const INDIVIDUAL_BLOCKED = new Set(["sign-in", "join", "billing", "access"]);

/** GET APIs that exist for sign-up, money or invitations. Their pages are blocked, so their reads are too. */
const API_READ_BLOCKED = new Set(["billing", "join", "invitation"]);

/** Testing mode: the only API families a non-GET may reach. */
const TESTING_WRITE_PREFIXES: readonly (readonly string[])[] = [
  ["scholar"],
  ["assistant"],
];

/** Testing mode: inside scholar/**, these two stay refused (erasing the learner, and sharing a Passport outside). */
const TESTING_WRITE_REFUSED: readonly (readonly string[])[] = [
  ["scholar", "erase"],
  ["scholar", "passport-share"],
];

/** Static families served from /public and Next itself. */
const ASSET_PREFIXES: readonly string[] = ["_next", "brand", "images", "fonts"];
const ASSET_FILES = new Set(["favicon.ico"]);

/**
 * Decode and normalise a pathname into lower-case segments.
 * Returns null when the path cannot be judged safely: bad encoding, a dot segment, a slash or backslash or a NUL
 * hidden inside an encoded segment. Empty segments (a doubled or trailing slash) are dropped.
 */
export function normalisePath(pathname: string): string[] | null {
  if (typeof pathname !== "string" || !pathname.startsWith("/")) return null;
  const out: string[] = [];
  for (const raw of pathname.split("/")) {
    if (raw === "") continue;
    let seg: string;
    try { seg = decodeURIComponent(raw); } catch { return null; }
    if (seg === "." || seg === ".." || /[\\/\0]/.test(seg)) return null;
    out.push(seg.toLowerCase());
  }
  return out;
}

const startsWithSegments = (segs: readonly string[], prefix: readonly string[]) =>
  prefix.every((p, i) => segs[i] === p);

/** Classify a path on the preview host, or null when the host serves nothing at that path. */
export function classifyPreviewPath(pathname: string): PathKind | null {
  const segs = normalisePath(pathname);
  if (!segs || segs.length === 0) return null;
  const [a, b] = segs;

  if (ASSET_PREFIXES.includes(a)) return "asset";
  if (segs.length === 1 && ASSET_FILES.has(a)) return "asset";

  if (a === "preview") return segs.length >= 2 ? "preview" : null;

  if (a === "individual") {
    if (segs.length < 2) return null;            // /individual itself is the public marketing gateway
    if (INDIVIDUAL_BLOCKED.has(b)) return null;
    return "session";
  }

  if (a === "api" && b === "individual") return segs.length >= 3 ? "session" : null;

  return null;
}

/** Whether a non-GET to this path is on the testing-mode write list. */
export function isTestingWritePath(pathname: string): boolean {
  const segs = normalisePath(pathname);
  if (!segs || segs[0] !== "api" || segs[1] !== "individual") return false;
  const rest = segs.slice(2);
  if (!TESTING_WRITE_PREFIXES.some(p => startsWithSegments(rest, p))) return false;
  if (TESTING_WRITE_REFUSED.some(p => startsWithSegments(rest, p))) return false;
  return true;
}

/**
 * THE DECISION. `mode` is the live session's mode, or null when no session is known yet (treated as read-only,
 * the strictest). On any host except the preview host, `/preview/*` is a 404 and everything else is untouched.
 */
export function decidePreviewRequest(
  host: string | null | undefined,
  pathname: string,
  method: string,
  mode: PreviewMode | null,
): PreviewDecision {
  const onPreview = isPreviewHost(host);
  if (!onPreview) {
    const segs = normalisePath(pathname);
    // An unjudgeable path on the main host is not ours to refuse. Only /preview/* is.
    if (segs && segs[0] === "preview") return { action: "not_found", reason: "preview routes exist only on the preview host" };
    return { action: "allow", kind: "session" };
  }

  const kind = classifyPreviewPath(pathname);
  if (!kind) return { action: "not_found", reason: "not served on the preview host" };

  const m = method.toUpperCase();
  const read = m === "GET" || m === "HEAD";

  if (kind === "asset") return read ? { action: "allow", kind } : { action: "not_found", reason: "assets are read only" };
  if (kind === "preview") return { action: "allow", kind };

  // kind === "session"
  const segs = normalisePath(pathname)!;
  if (segs[0] === "api" && segs[1] === "individual" && read && API_READ_BLOCKED.has(segs[2] ?? "")) {
    return { action: "not_found", reason: "not served on the preview host" };
  }
  if (read) return { action: "allow", kind };

  if (mode === "testing" && isTestingWritePath(pathname)) return { action: "allow", kind };
  return {
    action: "forbidden",
    reason: mode === "testing" ? "this action is not allowed in testing mode" : "read-only preview",
  };
}
