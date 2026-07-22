import { createAdminClient } from "@/lib/supabase/server";
import { recordDeliveries } from "@/lib/notifications/dispatch";

// In-app notification writes (§8). Failures are swallowed — a notification
// must never break the action that triggered it (and before migration 029 is
// applied the table simply doesn't exist yet). Each write also records an
// in-app delivery (fail-soft) so the notifications console can track delivery.
export async function notify(userIds: string[], n: { type: string; title: string; body?: string; href?: string }) {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return;
  try {
    const admin = createAdminClient();
    const { data } = await admin.from("notifications").insert(
      ids.map(user_id => ({ user_id, type: n.type, title: n.title, body: n.body ?? null, href: n.href ?? null })),
    ).select("id, user_id");
    await recordDeliveries(admin, (data ?? []).map((row: any) => ({ notification_id: row.id, user_id: row.user_id, channel: "in_app" as const, status: "sent" as const, provider: "internal" })));
  } catch { /* best-effort */ }
}

// All verifier-role users in a hospital (capped) — e.g. to announce a new
// pending logbook entry.
export async function hospitalVerifierIds(hospitalId: string | null, excludeId?: string): Promise<string[]> {
  if (!hospitalId) return [];
  try {
    const admin = createAdminClient();
    const { data } = await admin.from("profiles")
      .select("id, role, roles")
      .eq("hospital_id", hospitalId)
      .limit(50);
    return (data ?? [])
      .filter(p => {
        const roles: string[] = p.roles?.length ? p.roles : [p.role].filter(Boolean);
        return roles.some(r => ["assessor", "educator", "hospital_admin"].includes(r));
      })
      .map(p => p.id)
      .filter(id => id !== excludeId)
      .slice(0, 10);
  } catch { return []; }
}
