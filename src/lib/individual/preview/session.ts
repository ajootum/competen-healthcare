// HQ-SCHOLAR-PREVIEW-01 -- THE PREVIEW SESSION: cookie and database wrappers. No next/headers import, so the proxy
// can use it. Every database call is a service-role RPC of migration 860, judged on the DATABASE clock.
//
// FAIL CLOSED. If migration 860 is absent or the database cannot answer, `livePreview` returns null: no session, so the
// preview host serves nothing but the "preview ended" page. Nothing here ever invents a session.

/* eslint-disable @typescript-eslint/no-explicit-any */

export const PREVIEW_COOKIE = "cmp_scholar_preview";
/** The session lasts 60 minutes from the moment the ticket is exchanged (migration 860). The cookie never outlives it. */
export const PREVIEW_TTL_SECONDS = 60 * 60;
/** Request headers the proxy sets for the layout. Any client-sent copy is stripped on every host. */
export const PREVIEW_HEADER_PREFIX = "x-scholar-preview-";
export const PREVIEW_MODE_HEADER = "x-scholar-preview-mode";
export const PREVIEW_EXPIRES_HEADER = "x-scholar-preview-expires";
export const PREVIEW_RETURN_HEADER = "x-scholar-preview-return";

export type PreviewMode = "read_only" | "testing";

export type PreviewCookieOptions = {
  httpOnly: true; secure: boolean; sameSite: "lax"; path: "/"; maxAge: number;
};

/**
 * The preview cookie's attributes. HttpOnly. Secure in production (not on http dev). SameSite=Lax so the redirect from
 * HQ lands signed in. Path /. NO Domain attribute: a cookie without one is host-only, which is the whole reason the
 * preview host cannot touch the session of the HQ user on the main host.
 */
export function previewCookieOptions(maxAgeSeconds: number = PREVIEW_TTL_SECONDS, production: boolean = process.env.NODE_ENV === "production"): PreviewCookieOptions {
  const maxAge = Math.max(0, Math.min(PREVIEW_TTL_SECONDS, Math.floor(maxAgeSeconds)));
  return { httpOnly: true, secure: production, sameSite: "lax", path: "/", maxAge };
}

/** A cookie that expires it. Same attributes, so the browser matches it. */
export function previewCookieClear(production: boolean = process.env.NODE_ENV === "production"): PreviewCookieOptions {
  return previewCookieOptions(0, production);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

type Admin = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: any; error: any }>; from: (t: string) => any };

/** A service-role client that needs no request context (the proxy runs outside a render). */
export async function previewAdmin(): Promise<Admin> {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  }) as unknown as Admin;
}

export type OpenResult =
  | { ok: true; ticket: string; ticketExpiresAt: string; sessionId: string }
  | { ok: false; code: "NO_LEARNER" | "NOT_SET_UP" | "FAILED"; message: string };

/** Open a preview: a single-use ticket for the learner designated for `mode`. */
export async function openPreview(admin: Admin, actorId: string, mode: PreviewMode, returnOrigin: string): Promise<OpenResult> {
  const { data, error } = await admin.rpc("individual_scholar_preview_open", { p_actor: actorId, p_mode: mode, p_return_origin: returnOrigin });
  if (error) {
    const msg = String(error.message ?? "");
    if (/no_learner/.test(msg)) return { ok: false, code: "NO_LEARNER", message: "No demonstration learner is set up for this preview yet." };
    // 42883 undefined_function, PGRST202 function not in the schema cache: migration 860 is absent.
    if (error.code === "42883" || error.code === "PGRST202") return { ok: false, code: "NOT_SET_UP", message: "The Scholar preview is not set up on this environment yet." };
    return { ok: false, code: "FAILED", message: "The preview could not be opened." };
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.ticket) return { ok: false, code: "FAILED", message: "The preview could not be opened." };
  return { ok: true, ticket: row.ticket, ticketExpiresAt: row.ticket_expires_at, sessionId: row.session_id };
}

export type PreviewSession = {
  token: string; learnerId: string; mode: PreviewMode; expiresAt: string; sessionId: string; actorId: string; returnOrigin?: string;
};

/** Exchange a ticket for a session. Null when the ticket is unknown, used, expired or its session ended, or the call failed. */
export async function consumePreviewTicket(admin: Admin, ticket: string): Promise<PreviewSession | null> {
  if (!isUuid(ticket)) return null;
  const { data, error } = await admin.rpc("individual_scholar_preview_consume", { p_ticket: ticket });
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.token) return null;
  return { token: row.token, learnerId: row.learner_id, mode: row.mode, expiresAt: row.expires_at, sessionId: row.session_id, actorId: row.actor_id };
}

/** The live session for a cookie token, or null (also null on any error: fail closed). */
export async function livePreview(admin: Admin, token: string | null | undefined): Promise<PreviewSession | null> {
  if (!token || !isUuid(token)) return null;
  const { data, error } = await admin.rpc("individual_scholar_preview_live", { p_token: token });
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.learner_id) return null;
  return { token, learnerId: row.learner_id, mode: row.mode, expiresAt: row.expires_at, sessionId: row.session_id, actorId: row.actor_id, returnOrigin: row.return_origin };
}

/** End a session. Idempotent, and a failure to record it must not stop the person leaving. */
export async function endPreview(admin: Admin, token: string | null | undefined, reason: string): Promise<void> {
  if (!token || !isUuid(token)) return;
  try { await admin.rpc("individual_scholar_preview_end", { p_token: token, p_reason: reason }); } catch { /* the cookie is cleared regardless */ }
}

/** The session row (for the return origin) even after it ended, read by token. Null when unknown. */
export async function previewReturnOrigin(admin: Admin, token: string | null | undefined): Promise<string | null> {
  if (!token || !isUuid(token)) return null;
  try {
    const { data } = await admin.from("individual_scholar_preview_session").select("return_origin").eq("token", token).maybeSingle();
    return (data as any)?.return_origin ?? null;
  } catch { return null; }
}

/** Best-effort audit of a refused write. Never throws and never blocks the refusal. */
export async function auditRefusedWrite(admin: Admin, s: PreviewSession, method: string, path: string): Promise<void> {
  try {
    await admin.from("audit_log").insert({
      actor_id: s.actorId, action: "scholar_preview_write_refused", entity_type: "individual_scholar_preview_session", entity_id: s.sessionId,
      new_value: { method, path: path.slice(0, 300), mode: s.mode, learner_id: s.learnerId },
    });
  } catch { /* best effort */ }
}
