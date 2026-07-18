import { requireEducatorAccess } from "@/lib/educator-access";
import { loadAnalytics } from "@/lib/analytics";
import { StatTiles, Card } from "@/app/assessor/reports/ui";
import { EduHeader } from "../ui";
import MessagePanel from "./MessagePanel";

// Communication Centre — one-way messaging over the notifications system
// (learners or all educators), with your sent history from the audit trail.
// Threaded discussions and broadcasts-to-all need a messaging store and are
// stated as such.

export const dynamic = "force-dynamic";

export default async function CommunicationCentrePage() {
  const { admin, hospitalId, userId } = await requireEducatorAccess();
  const ctx = await loadAnalytics(admin, hospitalId);
  const d7 = new Date(new Date().getTime() - 7 * 86400000).toISOString();

  const [{ data: sent }, { data: recentNotifs }] = await Promise.all([
    admin.from("audit_log")
      .select("entity_id, new_value, created_at")
      .eq("actor_id", userId).eq("action", "send_message")
      .order("created_at", { ascending: false }).limit(8),
    admin.from("notifications").select("type").gte("created_at", d7).limit(2000),
  ]);
  const weekMessages = (recentNotifs ?? []).filter(x => x.type === "message").length;
  const nameOf = new Map(ctx.nurses.map(n => [n.id, n.name]));

  return (
    <div className="max-w-3xl">
      <EduHeader icon="📣" title="Communication Centre" sub="Message learners and colleagues — delivered as in-app notifications, audit-logged." />
      <StatTiles tiles={[
        { label: "Learners Reachable", value: String(ctx.nurses.length) },
        { label: "Messages (7d)", value: String(weekMessages), sub: "platform-wide" },
        { label: "My Sent (recent)", value: String((sent ?? []).length) },
        { label: "Delivery", value: "In-app", sub: "notification engine" },
      ]} />

      <Card title="New Message">
        <MessagePanel people={ctx.nurses.map(n => ({ id: n.id, name: n.name, dept: n.dept }))} />
      </Card>

      <div className="mt-4">
        <Card title="My Sent Messages" sub="from the audit trail">
          {(sent ?? []).length ? (
            <ul className="space-y-1.5">
              {(sent ?? []).map((s, i) => {
                const meta = s.new_value as { recipients?: number; chars?: number } | null;
                return (
                  <li key={i} className="text-[11px] text-gray-600">
                    To {s.entity_id ? (nameOf.get(s.entity_id) ?? "a colleague") : `${meta?.recipients ?? "?"} recipients`}
                    <span className="text-gray-400"> · {meta?.chars ?? "?"} chars</span>
                    <span className="text-gray-300 ml-1" suppressHydrationWarning>{new Date(s.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                  </li>
                );
              })}
            </ul>
          ) : <p className="text-xs text-gray-400">Nothing sent yet.</p>}
        </Card>
      </div>

      <p className="text-[10px] text-gray-400 mt-4">
        Honest scope: messages are one-way notifications (content is not stored beyond the recipient&apos;s notification). Threaded discussions,
        group broadcasts to all learners and read receipts need a messaging store — not simulated.
      </p>
    </div>
  );
}
