/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadRequestMode, pilotHourlyLimit } from "@/lib/ai/operating-mode";
import type { AiProduct } from "@/lib/ai/fair-use-policy";
import { individualQuotaRefusal } from "./policy";

type Refusal = ReturnType<typeof individualQuotaRefusal>;

// ── SUPERVISED PILOT, LEARNER SIDE ── owner GO "COMPETEN AI — SUPERVISED PILOT MODE", 29 Oct 2026 ──────────────────
//
// Two small things every Individual AI route shares. Pure where it can be; the mode itself is decided by the Holdings
// gate (src/lib/ai/operating-mode.ts), never here.

/**
 * The learner's answer to a clarify question, from the request body. ONLY the exact string "education" counts: anything
 * else (a typo, another value, the wrong type) is ignored, so a client cannot invent a purpose the gate does not know.
 * It is sent on to the gate on the risk context. It is never part of the subject text and is not stored with the text.
 */
export const purposeFrom = (body: unknown): "education" | null => ((body as { purpose?: unknown } | null | undefined)?.purpose === "education" ? "education" : null);

/**
 * The hourly AI quota with a named pilot cohort's higher limit applied (operating-mode.ts pilotHourlyLimit). Called with the
 * refusal the ordinary quota already produced: no refusal means nothing to relieve. A cohort limit can only RAISE the
 * limit, never lower it, and an unreadable count is still refused (fails closed).
 */
export async function pilotQuotaRefusal(
  admin: any, product: AiProduct, userId: string,
  quota: { used: number; limit: number; unreadable: boolean },
  refusal: Refusal, noun = "AI requests",
): Promise<Refusal> {
  if (!refusal || quota.unreadable) return refusal;
  const limit = pilotHourlyLimit(await loadRequestMode(admin, product, userId), quota.limit);
  if (limit <= quota.limit) return refusal;
  return individualQuotaRefusal({ ok: quota.used < limit, limit, unreadable: false }, noun);
}
