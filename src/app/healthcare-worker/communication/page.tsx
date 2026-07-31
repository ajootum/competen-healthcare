import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { titleCase, fmtWhen, SectionCard, Empty, Chip } from "@/lib/hww/kit";
import ChatPanel from "./ChatPanel";
import AckBroadcast from "./AckBroadcast";

// Communication (HWW-WARD-001 S4.10 / HWW-COM-001) — the nurse's team
// communication surface: shared ward channels (op_messages), broadcasts with
// acknowledgement tracking (op_broadcast_acks), and the personal notification
// feed. Nurses are first-class participants on the tenant's channels.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

const PRIO_TONE: Record<string, string> = { low: "bg-gray-100 text-gray-500", medium: "bg-[var(--cmp-surface-information)] text-blue-700", high: "bg-[var(--cmp-surface-warning)] text-orange-700", critical: "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]" };

export default async function CommunicationPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("hospital_id, role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  const NONE = "00000000-0000-0000-0000-000000000000";
  const scope = (q: any) => (roles.includes("super_admin") ? q : q.eq("hospital_id", profile?.hospital_id ?? NONE));

  const [chRes, bcRes, ackRes, notifRes] = await Promise.all([
    scope(admin.from("op_messages").select("channel").order("created_at", { ascending: false }).limit(400)),
    scope(admin.from("op_broadcasts").select("*").order("created_at", { ascending: false }).limit(20)),
    admin.from("op_broadcast_acks").select("broadcast_id").eq("user_id", user.id).limit(200),
    admin.from("notifications").select("id, type, title, body, href, read, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(15),
  ]);
  const channels = [...new Set(((chRes.data ?? []) as any[]).map(m => m.channel).filter(Boolean))].slice(0, 8) as string[];
  if (!channels.includes("General")) channels.unshift("General");
  const myAcks = new Set(((ackRes.data ?? []) as any[]).map(a => a.broadcast_id));
  const broadcasts = bcRes.data ?? [];
  const notifications = notifRes.data ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Communication</h1>
        <p className="text-sm text-gray-500 mt-1">Ward channels, broadcasts and your personal notifications — operational coordination, never clinical documentation.</p>
      </div>

      <ChatPanel channels={channels} />

      <div className="grid lg:grid-cols-2 gap-5">
        <div id="announcements" className="scroll-mt-24">
        <SectionCard icon="📣" title="Unit Announcements" count={broadcasts.length}>
          <div className="divide-y divide-gray-100">
            {broadcasts.length === 0 && <Empty>No broadcasts. Ward and hospital announcements from your coordinators land here.</Empty>}
            {broadcasts.map((b: any) => (
              <div key={b.id} className="py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  {b.emergency && <span className="text-[var(--cmp-text-critical)]">🚨</span>}
                  <span className="font-medium text-gray-800">{b.title}</span>
                  <Chip tone={PRIO_TONE[b.priority] ?? PRIO_TONE.medium}>{titleCase(b.priority)}</Chip>
                  <span className="text-xs text-gray-400 ml-auto">{b.author_name ?? ""} · {fmtWhen(b.created_at)}</span>
                </div>
                {b.body && <p className="text-sm text-gray-600 mt-0.5">{b.body}</p>}
                <div className="flex items-center gap-2 mt-1.5">
                  {myAcks.has(b.id)
                    ? <span className="text-xs text-emerald-700">✓ Acknowledged</span>
                    : <AckBroadcast id={b.id} />}
                  <span className="text-[10px] text-gray-400">audience: {b.audience ?? "All Staff"}</span>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
        </div>

        <SectionCard icon="🔔" title="My Notifications" count={notifications.length}>
          <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
            {notifications.length === 0 && <Empty>No notifications.</Empty>}
            {notifications.map((n: any) => (
              <div key={n.id} className="py-2.5">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-gray-800 truncate">{n.title}</p>
                  {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-[var(--cmp-color-success)] shrink-0" />}
                  <span className="ml-auto text-[10px] text-gray-400 shrink-0">{fmtWhen(n.created_at)}</span>
                </div>
                {n.body && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.body}</p>}
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <p className="text-center text-[11px] text-gray-400 pt-1">
        Escalation communications have their own channel — the Safety &amp; Escalation module — with response deadlines and audit trails.
      </p>
    </div>
  );
}
