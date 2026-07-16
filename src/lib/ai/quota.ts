import { createAdminClient } from "@/lib/supabase/server";

type Admin = ReturnType<typeof createAdminClient>;

// Per-user AI rate limit. Every AI call is already audit-logged, so the
// audit trail doubles as a durable, serverless-safe counter — no extra
// infrastructure. Default: 30 AI calls per user per hour.
const HOURLY_LIMIT = Number(process.env.AI_HOURLY_LIMIT ?? 30);
const AI_ACTIONS = ["ai_assistant_query", "ai_coach", "ai_governance_brief"];

export async function checkAiQuota(admin: Admin, userId: string): Promise<{ ok: boolean; used: number; limit: number }> {
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count, error } = await admin
    .from("audit_log")
    .select("id", { count: "exact", head: false })
    .eq("actor_id", userId)
    .in("action", AI_ACTIONS)
    .gte("created_at", since)
    .limit(1);
  const used = error ? 0 : (count ?? 0); // fail open — quota is protection, not a gate
  return { ok: used < HOURLY_LIMIT, used, limit: HOURLY_LIMIT };
}
