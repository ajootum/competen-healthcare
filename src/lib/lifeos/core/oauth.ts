import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { LifeosError, notFound } from "./errors";
import type { SessionIdentity } from "./optin";
import type { LifeosStore, Principal, Row } from "./types";

// LIFEOS-API-001 delivery step 9. User-delegated access: OAuth 2.1 authorization code with PKCE. There is no master key.
// A third party holds only what one person approved, within the scopes that person saw, until that person revokes it.
// Clients are public (no secret to leak from an app), so PKCE and an exact redirect match are what bind a code to its client.

export const PUBLIC_API_FLAG = "lifeos_public_api";

export const SCOPES: Record<string, string> = {
  "profile:read": "See your name and the names of your workspaces",
  "commitments:read": "See your commitments",
  "commitments:write": "Add and change your commitments",
  "worlds:read": "See your worlds",
  "schedules:read": "See your calendar events and protected time",
};

const CODE_SECONDS = 60;
const ACCESS_SECONDS = 3600;
const REFRESH_DAYS = 30;
const ACCESS_PREFIX = "lo_at_";
const REFRESH_PREFIX = "lo_rt_";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const pkceChallenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");
const inFuture = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();

export const AuthorizeInput = z.object({
  clientId: z.uuid(),
  redirectUri: z.string().min(1).max(2000),
  scope: z.string().min(1).max(500),
  state: z.string().max(500).optional(),
  codeChallenge: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
  codeChallengeMethod: z.literal("S256"),
}).strict().meta({ title: "AuthorizeInput" });
export type AuthorizeRequest = z.infer<typeof AuthorizeInput>;

/** Exact match only, and https unless it is this machine. An attacker's page must never receive a code. */
export function redirectAllowed(client: Row, redirectUri: string): boolean {
  if (!(client.redirect_uris as string[]).includes(redirectUri)) return false;
  try {
    const u = new URL(redirectUri);
    return u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname));
  } catch {
    return false;
  }
}

/** An app is usable only while it is approved and not archived. A change to either applies to tokens it already holds. */
const clientUsable = (client: Row | null): client is Row => !!client && client.status === "approved" && !client.archived_at;

/** What a token holds today: what the person approved, and only what the app may still hold. */
const liveScopes = (approved: unknown, client: Row) => (approved as string[]).filter(s => (client.allowed_scopes as string[]).includes(s));

/** A real, approved client asking for scopes it may hold. Anything else is refused before the person sees a screen. */
export async function checkAuthorizeRequest(store: LifeosStore, r: AuthorizeRequest): Promise<{ client: Row; scopes: string[] }> {
  if (!(await store.flagEnabled(PUBLIC_API_FLAG))) throw notFound();
  const client = await store.get("lifeos_api_client", r.clientId);
  if (!clientUsable(client)) throw new LifeosError("validation_failed", "This app is not recognised.");
  if (!redirectAllowed(client, r.redirectUri)) throw new LifeosError("validation_failed", "This app's return address is not recognised.");
  const scopes = [...new Set(r.scope.split(/\s+/).filter(Boolean))];
  const allowed = client.allowed_scopes as string[];
  if (scopes.length === 0 || scopes.some(s => !(s in SCOPES) || !allowed.includes(s))) {
    throw new LifeosError("validation_failed", "This app is asking for access it is not approved for.");
  }
  return { client, scopes };
}

/**
 * The signed-in person's yes. A delegated token can never reach this, because this route is not on the public list. It
 * replaces any earlier approval of this app by this person, so what they just saw is what the app holds.
 */
export async function approve(store: LifeosStore, individualId: string, r: AuthorizeRequest, traceId: string): Promise<{ redirect: string }> {
  const { client, scopes } = await checkAuthorizeRequest(store, r);
  const code = randomBytes(32).toString("base64url");
  const grantId = crypto.randomUUID();
  const earlier = await store.where("lifeos_oauth_grant", { client_id: String(client.id), individual_id: individualId, status: "active" }, { limit: 200 });
  await store.mutate({
    actor: individualId, actorKind: "user", idempotencyKey: null, requestHash: null, traceId,
    ops: [
      { t: "lifeos_oauth_grant", op: "insert", values: { id: grantId, client_id: client.id, individual_id: individualId, scopes, provenance_source: "user" } },
      { t: "lifeos_oauth_code", op: "insert", values: { grant_id: grantId, code_hash: sha256(code), code_challenge: r.codeChallenge, redirect_uri: r.redirectUri, expires_at: inFuture(CODE_SECONDS), provenance_source: "system" } },
      ...earlier.map(g => ({ t: "lifeos_oauth_grant", op: "update" as const, id: String(g.id), values: { status: "revoked", revoked_at: new Date().toISOString() } })),
    ],
  });
  const u = new URL(r.redirectUri);
  u.searchParams.set("code", code);
  if (r.state) u.searchParams.set("state", r.state);
  return { redirect: u.toString() };
}

export class OAuthError extends Error {
  constructor(readonly error: string, readonly status = 400) { super(error); }
}

/** Throws a forbidden LifeosError unless LifeOS would still let this person in. The adapter asks about their account. */
export type SubjectCheck = (individualId: string) => Promise<void>;

async function issueTokens(store: LifeosStore, grant: Row, extra: Parameters<LifeosStore["mutate"]>[0]["ops"]) {
  const access = `${ACCESS_PREFIX}${randomBytes(32).toString("base64url")}`;
  const refresh = `${REFRESH_PREFIX}${randomBytes(32).toString("base64url")}`;
  await store.mutate({
    actor: String(grant.individual_id), actorKind: "system", idempotencyKey: null, requestHash: null, traceId: null,
    ops: [
      ...extra,
      {
        t: "lifeos_oauth_token", op: "insert",
        values: {
          grant_id: grant.id, access_hash: sha256(access), refresh_hash: sha256(refresh), access_expires_at: inFuture(ACCESS_SECONDS),
          refresh_expires_at: inFuture(REFRESH_DAYS * 86400), provenance_source: "system",
        },
      },
    ],
  });
  return { access_token: access, refresh_token: refresh, token_type: "Bearer", expires_in: ACCESS_SECONDS, scope: (grant.scopes as string[]).join(" ") };
}

/** Code to tokens. One use, for the client it was issued to, with the verifier only that client holds. */
export async function exchangeCode(store: LifeosStore, b: { code?: unknown; code_verifier?: unknown; client_id?: unknown; redirect_uri?: unknown }, assertSubject: SubjectCheck) {
  if (typeof b.code !== "string" || typeof b.code_verifier !== "string" || typeof b.client_id !== "string" || typeof b.redirect_uri !== "string") throw new OAuthError("invalid_request");
  const [code] = await store.where("lifeos_live_oauth_code", { code_hash: sha256(b.code) }, { limit: 1 });
  if (!code) throw new OAuthError("invalid_grant");
  const grant = await store.get("lifeos_oauth_grant", String(code.grant_id));
  if (!grant || grant.status !== "active" || grant.client_id !== b.client_id) throw new OAuthError("invalid_grant");
  if (code.redirect_uri !== b.redirect_uri || pkceChallenge(b.code_verifier) !== code.code_challenge) throw new OAuthError("invalid_grant");
  const client = await store.get("lifeos_api_client", String(grant.client_id));
  if (!clientUsable(client)) throw new OAuthError("invalid_grant");
  await assertSubject(String(grant.individual_id)).catch(refusedAsInvalidGrant);
  // The expected version makes the code single-use, even when two requests race: the loser fails the whole batch.
  return issueTokens(store, { ...grant, scopes: liveScopes(grant.scopes, client) }, [{ t: "lifeos_oauth_code", op: "update", id: String(code.id), expected_version: Number(code.version), values: { status: "used" } }])
    .catch(e => { if (e instanceof LifeosError && e.code === "version_conflict") throw new OAuthError("invalid_grant"); throw e; });
}

const refusedAsInvalidGrant = (e: unknown): never => {
  if (e instanceof LifeosError && e.code === "forbidden") throw new OAuthError("invalid_grant");
  throw e;
};

/**
 * Refresh rotates. A refresh token that was already rotated is a stolen one being replayed, so the whole grant ends: the
 * person's app has to ask again, and the thief holds nothing. It also passes the admission a request passes. Someone who holds
 * no LifeOS access at all has their approval ended here, so coming back later does not bring the app back without asking.
 */
export async function refreshTokens(store: LifeosStore, b: { refresh_token?: unknown; client_id?: unknown }, assertSubject: SubjectCheck) {
  if (typeof b.refresh_token !== "string" || typeof b.client_id !== "string") throw new OAuthError("invalid_request");
  const hash = sha256(b.refresh_token);
  const [live] = await store.where("lifeos_live_oauth_token", { refresh_hash: hash }, { limit: 1 });
  if (!live || live.refresh_live !== true) {
    const [spent] = await store.where("lifeos_oauth_token", { refresh_hash: hash }, { limit: 1 });
    if (spent?.status === "rotated") await revokeGrantById(store, String(spent.grant_id));
    throw new OAuthError("invalid_grant");
  }
  if (live.client_id !== b.client_id) throw new OAuthError("invalid_grant");
  const grant = await store.get("lifeos_oauth_grant", String(live.grant_id));
  if (!grant) throw new OAuthError("invalid_grant");
  const client = await store.get("lifeos_api_client", String(live.client_id));
  if (!clientUsable(client)) throw new OAuthError("invalid_grant");
  const individualId = String(grant.individual_id);
  await assertSubject(individualId).catch(async (e: unknown) => {
    if (e instanceof LifeosError && e.code === "forbidden") {
      const entitled = await store.where("lifeos_live_entitlement", { individual_id: individualId }, { limit: 1 });
      if (entitled.length === 0) await revokeGrantById(store, String(grant.id));
    }
    refusedAsInvalidGrant(e);
  });
  return issueTokens(store, { ...grant, scopes: liveScopes(grant.scopes, client) }, [{ t: "lifeos_oauth_token", op: "update", id: String(live.id), expected_version: Number(live.version), values: { status: "rotated" } }])
    .catch(e => { if (e instanceof LifeosError && e.code === "version_conflict") throw new OAuthError("invalid_grant"); throw e; });
}

async function revokeGrantById(store: LifeosStore, grantId: string) {
  const grant = await store.get("lifeos_oauth_grant", grantId);
  if (!grant || grant.status !== "active") return;
  await store.mutate({
    actor: String(grant.individual_id), actorKind: "system", idempotencyKey: null, requestHash: null, traceId: null,
    ops: [{ t: "lifeos_oauth_grant", op: "update", id: grantId, values: { status: "revoked", revoked_at: new Date().toISOString() } }],
  });
}

/** RFC 7009: revoking something unknown is not an error, so this cannot be used to test whether a token exists. */
export async function revokeToken(store: LifeosStore, token: unknown): Promise<void> {
  if (typeof token !== "string") return;
  const hash = sha256(token);
  const [row] = await store.where("lifeos_oauth_token", token.startsWith(REFRESH_PREFIX) ? { refresh_hash: hash } : { access_hash: hash }, { limit: 1 });
  if (row) await revokeGrantById(store, String(row.grant_id));
}

/** A bearer token to a principal, or a refusal. It never reveals why, beyond what the standard allows. */
export async function principalFromToken(store: LifeosStore, token: string): Promise<{ principal: Principal; individualId: string }> {
  const [t] = await store.where("lifeos_live_oauth_token", { access_hash: sha256(token) }, { limit: 1 });
  if (!t || t.access_live !== true) throw new LifeosError("unauthenticated", "This access token is not valid.");
  const client = await store.get("lifeos_api_client", String(t.client_id));
  if (!clientUsable(client)) throw new LifeosError("unauthenticated", "This access token is not valid.");
  const individualId = String(t.individual_id);
  return { individualId, principal: { kind: "delegated_token", individualId, scopes: liveScopes(t.scopes, client), clientId: String(t.client_id) } };
}

/**
 * Who this signed-in account is in LifeOS, whatever the state of their access. A person can always see and end what they
 * approved, including after their own access has ended.
 */
async function individualOf(store: LifeosStore, id: SessionIdentity): Promise<string | null> {
  const [link] = await store.where("lifeos_identity_link", { issuer: id.issuer, subject: id.subject }, { limit: 1 });
  return link ? String(link.individual_id) : null;
}

export async function listConnectedApps(store: LifeosStore, id: SessionIdentity) {
  const individualId = await individualOf(store, id);
  if (!individualId) return [];
  const grants = await store.where("lifeos_oauth_grant", { individual_id: individualId, status: "active" }, { limit: 200 });
  const clients = await Promise.all(grants.map(g => store.get("lifeos_api_client", String(g.client_id))));
  return grants.map((g, i) => ({ id: String(g.id), appName: String(clients[i]?.name ?? "Unknown app"), scopes: g.scopes as string[], connectedAt: String(g.created_at) }));
}

export async function disconnectApp(store: LifeosStore, id: SessionIdentity, grantId: string): Promise<void> {
  const individualId = await individualOf(store, id);
  const grant = await store.get("lifeos_oauth_grant", grantId);
  if (!individualId || !grant || grant.individual_id !== individualId) throw notFound();
  await revokeGrantById(store, grantId);
}
