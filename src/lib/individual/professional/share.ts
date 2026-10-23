/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomBytes } from "node:crypto";
import { ORIGIN } from "./vocabulary";

// ── SHARING THE PASSPORT FROM COMPETEN PROFESSIONAL ── reuses passport_share_tokens and /verify ──────────
//
// ⚠ NOT A SECOND SHARE MECHANISM. The link is a row in passport_share_tokens (migration 122), read by the
// existing public /verify/<token> page, with the same expiry, scope, revoke and view count the estate's
// share route uses (src/app/api/passport/share/route.ts). What is added is ONE companion row in
// individual_professional_share (migration 373): its presence is the person's consent that the link
// carries their own records, so a link minted anywhere else can never show them.
//
// ⚠ hospital_id IS ALWAYS NULL HERE. The estate route stamps the person's hospital. A Professional link is
// the person's own act, not an organisation's, and stamping a hospital would make it countable by one.

export const SHARE_DAYS_MAX = 365;
/** The lifetime the form suggests, kept within the policy maximum (COMPETEN-CONFIG-002). */
export const SHARE_DAYS_SUGGESTED = 30;
export const suggestedShareDays = (maxDays: number) => Math.min(SHARE_DAYS_SUGGESTED, maxDays);

export type ShareLink = {
  id: string; token: string; scope: string; label: string | null; expires_at: string | null;
  revoked: boolean; view_count: number; created_at: string;
};

/**
 * Pure: the request body, clamped the way the estate route clamps it. `maxDays` is the Individual policy
 * maximum (src/lib/individual/policy.ts), itself never above SHARE_DAYS_MAX, applied again here.
 */
export function parseShare(b: Record<string, unknown>, maxDays: number = SHARE_DAYS_MAX): { scope: "summary" | "full"; label: string | null; days: number } {
  const scope = b.scope === "full" ? "full" : "summary";
  const label = typeof b.label === "string" && b.label.trim() ? b.label.trim().slice(0, 120) : null;
  const n = Number(b.days);
  const max = Math.min(SHARE_DAYS_MAX, Math.max(1, Math.floor(maxDays)));
  const days = Number.isFinite(n) ? Math.min(max, Math.max(1, Math.floor(n))) : suggestedShareDays(max);
  return { scope, label, days };
}

export async function mintShare(admin: any, userId: string, input: ReturnType<typeof parseShare>): Promise<ShareLink | null> {
  const token = randomBytes(24).toString("hex");
  const { data: share, error } = await admin.from("passport_share_tokens").insert({
    token, nurse_id: userId, hospital_id: null, scope: input.scope, label: input.label,
    expires_at: new Date(Date.now() + input.days * 86400000).toISOString(), consent: true, revoked: false,
  }).select("id, token, scope, label, expires_at, revoked, view_count, created_at").single();
  if (error || !share) return null;
  const { error: linkErr } = await admin.from("individual_professional_share").insert({
    share_token_id: share.id, user_id: userId, experience_code: ORIGIN,
  });
  if (linkErr) {
    // Without the companion row the link would show the institution sections only, which is not what the
    // person asked to share. Withdraw it rather than hand out a different link than the one requested.
    await admin.from("passport_share_tokens").update({ revoked: true }).eq("id", share.id).eq("nurse_id", userId);
    return null;
  }
  return { ...share, view_count: share.view_count ?? 0 };
}

/** The person's Professional links, newest first. Estate-minted links are not listed: they are not these. */
export async function listShares(admin: any, userId: string): Promise<ShareLink[] | null> {
  try {
    const { data: rows, error } = await admin.from("individual_professional_share").select("share_token_id").eq("user_id", userId).limit(200);
    if (error) return null;
    const ids = (rows ?? []).map((r: any) => r.share_token_id);
    if (!ids.length) return [];
    const { data, error: tErr } = await admin.from("passport_share_tokens")
      .select("id, token, scope, label, expires_at, revoked, view_count, created_at")
      .in("id", ids).eq("nurse_id", userId).order("created_at", { ascending: false });
    return tErr ? null : (data ?? []).map((s: any) => ({ ...s, view_count: s.view_count ?? 0 }));
  } catch { return null; }
}

/** Revoke one of the person's own Professional links. False when it is not theirs or not a Professional link. */
export async function revokeShare(admin: any, userId: string, id: string): Promise<boolean> {
  const { data: link } = await admin.from("individual_professional_share").select("share_token_id").eq("share_token_id", id).eq("user_id", userId).maybeSingle();
  if (!link) return false;
  const { data } = await admin.from("passport_share_tokens").update({ revoked: true }).eq("id", id).eq("nurse_id", userId).select("id").maybeSingle();
  return !!data;
}

/** For /verify: whether a token carries the person's own records. Unreadable answers false -- show less. */
export async function shareCarriesOwnRecords(admin: any, tokenId: string, userId: string): Promise<boolean> {
  try {
    const { data, error } = await admin.from("individual_professional_share").select("share_token_id")
      .eq("share_token_id", tokenId).eq("user_id", userId).maybeSingle();
    return !error && !!data;
  } catch { return false; }
}
