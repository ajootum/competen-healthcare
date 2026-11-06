import { createHash } from "node:crypto";
import { hasScope } from "../core/access";
import { PUBLIC_API_FLAG, principalFromToken } from "../core/oauth";
import { assertAdmitted } from "../core/provision";
import { LifeosError } from "../core/errors";
import { ListQueryInput } from "../core/contracts";
import type { SessionIdentity } from "../core/optin";
import type { LifeosStore, Principal } from "../core/types";
import { matchRoute, type Bucket, type Route } from "./routes";

// LIFEOS-API-001 sections 2, 6 and 9. The one door. In order: gate, authentication, route, scope, rate limit,
// request shape, handler. Every LifeOS endpoint passes through this function, and nothing else serves them.

export const LIFEOS_CORE_FLAG = "lifeos_core";

/** Requests per person, per minute. Fixed here at this stage, on the database clock. */
export const RATE_LIMITS: Record<Bucket, { max: number; windowSeconds: number }> = {
  read: { max: 600, windowSeconds: 60 },
  write: { max: 120, windowSeconds: 60 },
  generate: { max: 10, windowSeconds: 60 },
};

export type DispatchDeps = {
  /** Null when the service key is unavailable, which is the same as the gate being off. */
  store: LifeosStore | null;
  /** Resolves the principal, or throws a LifeosError. */
  authenticate: () => Promise<Principal>;
  /** Who is signed in, for the routes that come before holding LifeOS. */
  session?: () => Promise<SessionIdentity>;
  /** Whether an entitlement's source still stands, for a bearer token, which has no session to ask. */
  sourceStands?: (entitlement: Record<string, unknown>, individualId: string) => Promise<boolean>;
  /** Whether the person's identity link and sign-in account still stand, for a bearer token, which has no session to ask. */
  accountStands?: (individualId: string) => Promise<boolean>;
  resolveTxt?: (name: string) => Promise<string[][]>;
  traceId: string;
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });

function errorResponse(e: LifeosError, traceId: string) {
  return json(
    e.status,
    { error: { code: e.code, message: e.message, ...(e.details !== undefined ? { details: e.details } : {}), traceId } },
    e.retryAfter ? { "Retry-After": String(e.retryAfter) } : {},
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const assertIds = (params: Record<string, string>) => {
  for (const value of Object.values(params)) {
    if (!UUID.test(value)) throw new LifeosError("not_found", "That was not found.");
  }
};

/** An app sees where a record came from only when it came from that app. Another app's id is not its business. */
const forApp = (data: unknown, clientId: string): unknown => {
  if (Array.isArray(data)) return data.map(d => forApp(d, clientId));
  if (data && typeof data === "object" && "provenanceRef" in data) {
    return { ...data, provenanceRef: data.provenanceRef === clientId ? clientId : null };
  }
  return data;
};

async function run(req: Request, segments: string[], deps: DispatchDeps & { store: LifeosStore }): Promise<Response> {
  const matched = matchRoute(req.method, segments);
  const bearer = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(\S+)$/i)?.[1] ?? null;
  if (matched && matched !== "method_not_allowed" && matched.route.admission === "session") {
    // A session route answers a person, never an app, whatever cookies come with the token.
    if (bearer) {
      await bearerPrincipal(bearer, deps);
      throw new LifeosError("forbidden", "This is not available to apps.");
    }
    return runSession(req, matched.route, matched.params, deps);
  }
  if (matched && matched !== "method_not_allowed" && matched.route.admission === "open") return runOpen(req, matched.route, deps);

  const principal = bearer ? await bearerPrincipal(bearer, deps) : await deps.authenticate();

  if (!matched) throw new LifeosError("not_found", "That was not found.");
  if (matched === "method_not_allowed") throw new LifeosError("method_not_allowed", "That method is not available here.");
  const { route, params } = matched;

  assertIds(params);
  // THE PUBLIC BOUNDARY: a delegated token reaches only routes on the approved list, whatever scopes it holds.
  if (principal.kind === "delegated_token" && route.visibility !== "public") throw new LifeosError("forbidden", "This is not available to apps.");
  if (route.scope && !hasScope(principal, route.scope)) throw new LifeosError("forbidden", "This access does not include that action.");

  const limit = RATE_LIMITS[route.bucket];
  // An app has its own allowance for each person, so a busy app cannot use up theirs.
  const rateSubject = principal.clientId ? `client:${principal.clientId}:${principal.individualId}` : principal.individualId;
  const rate = await deps.store.rateTake(rateSubject, route.bucket, limit.max, limit.windowSeconds);
  if (!rate.allowed) throw new LifeosError("rate_limited", "Too many requests. Wait a moment and try again.", { retryAfter: rate.retryAfter });

  const url = new URL(req.url);
  let query: Record<string, string | number | undefined> = {};
  if (route.list) {
    const parsed = ListQueryInput.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) throw new LifeosError("validation_failed", "Those filters are not valid.", { details: parsed.error.issues.map(i => ({ path: i.path.join("."), message: i.message })) });
    query = parsed.data;
  }

  let body: unknown = undefined;
  let idempotencyKey: string | null = null;
  let requestHash: string | null = null;
  if (route.method !== "GET") {
    // Blocks a cross-site form post: a browser cannot send this content type from a plain form.
    if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      throw new LifeosError("validation_failed", "Send this request as application/json.");
    }
    idempotencyKey = req.headers.get("idempotency-key");
    if (!idempotencyKey || idempotencyKey.length > 255) throw new LifeosError("validation_failed", "Every write needs an Idempotency-Key header of at most 255 characters.");
    // Keys are per person in the database. Each app, and the person signed in, keeps its own, so one cannot retrieve another's record.
    if (principal.clientId) idempotencyKey = `client:${principal.clientId}:${createHash("sha256").update(idempotencyKey).digest("hex")}`;
    const raw = await req.text();
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      throw new LifeosError("validation_failed", "The request body is not valid JSON.");
    }
    requestHash = createHash("sha256").update(`${route.method} ${url.pathname}\n${raw}`).digest("hex");
    if (route.input) {
      const parsed = route.input.safeParse(body);
      if (!parsed.success) throw new LifeosError("validation_failed", "Some of those values are not valid.", { details: parsed.error.issues.map(i => ({ path: i.path.join("."), message: i.message })) });
    }
  }

  const result = await route.handler({
    ctx: { store: deps.store, principal, traceId: deps.traceId, idempotencyKey, requestHash, resolveTxt: deps.resolveTxt },
    params, body, query,
  });
  return json(result.status ?? 200, {
    data: principal.clientId ? forApp(result.data, principal.clientId) : result.data,
    meta: {
      traceId: deps.traceId,
      ...(result.nextCursor !== undefined ? { nextCursor: result.nextCursor } : {}),
      ...(result.replayed ? { replayed: true } : {}),
    },
  });
}

/**
 * The same questions a signed-in person's request answers, asked for the person an app acts for: their identity link and
 * account, then their admission. With nothing able to answer, the answer is no.
 */
const subjectCheck = (deps: DispatchDeps & { store: LifeosStore }) => async (individualId: string): Promise<void> => {
  if (!(deps.accountStands && await deps.accountStands(individualId))) throw new LifeosError("forbidden", "This account is not active.");
  await assertAdmitted(deps.store, individualId, async e => (deps.sourceStands ? deps.sourceStands(e, individualId) : false));
};

/** A bearer token: the public flag first, then the token, then the same admission a signed-in person passes. */
async function bearerPrincipal(token: string, deps: DispatchDeps & { store: LifeosStore }): Promise<Principal> {
  if (!(await deps.store.flagEnabled(PUBLIC_API_FLAG))) throw new LifeosError("not_found", "That was not found.");
  const { principal, individualId } = await principalFromToken(deps.store, token);
  await subjectCheck(deps)(individualId).catch((e: unknown) => {
    if (e instanceof LifeosError && e.code === "forbidden") throw new LifeosError("unauthenticated", "This access token is not valid.");
    throw e;
  });
  return principal;
}

/** The standard OAuth endpoints: the flag, a rate limit by address, and the form encoding the standard fixes. */
async function runOpen(req: Request, route: Route, deps: DispatchDeps & { store: LifeosStore }): Promise<Response> {
  if (!(await deps.store.flagEnabled(PUBLIC_API_FLAG))) return new Response(null, { status: 404 });
  const limit = RATE_LIMITS[route.bucket];
  const who = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const rate = await deps.store.rateTake(`open:${who}`, route.bucket, limit.max, limit.windowSeconds);
  if (!rate.allowed) throw new LifeosError("rate_limited", "Too many requests. Wait a moment and try again.", { retryAfter: rate.retryAfter });
  let body: Record<string, unknown> = {};
  if (route.method !== "GET") {
    const type = (req.headers.get("content-type") ?? "").toLowerCase();
    if (type.startsWith("application/x-www-form-urlencoded")) body = Object.fromEntries(new URLSearchParams(await req.text()));
    else if (type.startsWith("application/json")) body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    else return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  return route.openHandler!({ store: deps.store, body, assertSubject: subjectCheck(deps) });
}

/** The door before holding LifeOS: a signed-in session, its own rate limit, the same request rules, and no principal. */
async function runSession(req: Request, route: Route, params: Record<string, string>, deps: DispatchDeps & { store: LifeosStore }): Promise<Response> {
  if (!deps.session) throw new LifeosError("forbidden", "This is not available here.");
  assertIds(params);
  const identity = await deps.session();
  const limit = RATE_LIMITS[route.bucket];
  const rate = await deps.store.rateTake(`session:${identity.subject}`, route.bucket, limit.max, limit.windowSeconds);
  if (!rate.allowed) throw new LifeosError("rate_limited", "Too many requests. Wait a moment and try again.", { retryAfter: rate.retryAfter });
  let body: unknown = undefined;
  if (route.method !== "GET") {
    if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      throw new LifeosError("validation_failed", "Send this request as application/json.");
    }
    try {
      body = JSON.parse((await req.text()) || "{}");
    } catch {
      throw new LifeosError("validation_failed", "The request body is not valid JSON.");
    }
    const parsed = route.input?.safeParse(body);
    if (parsed && !parsed.success) throw new LifeosError("validation_failed", "Some of those values are not valid.", { details: parsed.error.issues.map(i => ({ path: i.path.join("."), message: i.message })) });
  }
  const result = await route.sessionHandler!({ store: deps.store, identity, body, params });
  return json(result.status ?? 200, { data: result.data, meta: { traceId: deps.traceId } });
}

export async function dispatch(req: Request, segments: string[], deps: DispatchDeps): Promise<Response> {
  // THE GATE FIRST, before authentication. Off, a signed-out visitor and a signed-in one get the same empty 404, so
  // LifeOS cannot be told apart from a route that does not exist. Any failure to read the gate counts as off.
  let on = false;
  try {
    on = !!deps.store && (await deps.store.flagEnabled(LIFEOS_CORE_FLAG));
  } catch {
    on = false;
  }
  if (!on || !deps.store) return new Response(null, { status: 404 });

  try {
    return await run(req, segments, { ...deps, store: deps.store });
  } catch (e) {
    if (e instanceof LifeosError) return errorResponse(e, deps.traceId);
    // Unknown failures say nothing about their cause. The trace id joins this to the server log.
    console.error(`[lifeos] ${deps.traceId}`, e);
    return errorResponse(new LifeosError("unavailable", "LifeOS could not complete that just now."), deps.traceId);
  }
}
