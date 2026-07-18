import { createAdminClient } from "@/lib/supabase/server";

// In-app notification writes (§8). Failures are swallowed — a notification
// must never break the action that triggered it (and before migration 029 is
// applied the table simply doesn't exist yet).
export async function notify(userIds: string[], n: { type: string; title: string; body?: string; href?: string }) {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return;
  try {
    const admin = createAdminClient();
    await admin.from("notifications").insert(
      ids.map(user_id => ({ user_id, type: n.type, title: n.title, body: n.body ?? null, href: n.href ?? null })),
    );
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
