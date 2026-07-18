import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import MarkAllRead from "./MarkAllRead";

// Notifications (§8): stored event notifications plus live-derived expiry
// alerts (competencies and credentials), computed at render time from real
// records — no scheduler exists yet, so nothing pretends to be one.

const TYPE_ICON: Record<string, string> = {
  logbook_pending: "📖", logbook_verified: "✅", logbook_rejected: "❌",
  logbook_changes_requested: "✏️", decisions_issued: "🧠",
  credential_added: "🏅", credential_submitted: "🏅",
};

export default async function NotificationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const in60 = new Date(); in60.setDate(in60.getDate() + 60);
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: rows }, { data: expDecisions }, { data: expCredentials }] = await Promise.all([
    admin.from("notifications").select("id, type, title, body, href, read, created_at")
      .eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
    admin.from("competency_decisions")
      .select("id, expiry_date, framework_competencies(name)")
      .eq("nurse_id", user.id).not("expiry_date", "is", null)
      .lte("expiry_date", in60.toISOString().slice(0, 10)).order("expiry_date").limit(10),
    admin.from("professional_credentials")
      .select("id, title, expiry_date")
      .eq("nurse_id", user.id).not("expiry_date", "is", null)
      .lte("expiry_date", in60.toISOString().slice(0, 10)).order("expiry_date").limit(10),
  ]);

  const notifications = rows ?? [];
  const unread = notifications.filter(n => !n.read).length;
  const expiries = [
    ...(expDecisions ?? []).map(d => ({
      key: `d-${d.id}`,
      label: (d.framework_competencies as unknown as { name: string } | null)?.name ?? "Competency",
      date: d.expiry_date as string, href: "/dashboard/passport", kind: "Competency",
    })),
    ...(expCredentials ?? []).map(c => ({
      key: `c-${c.id}`, label: c.title as string, date: c.expiry_date as string,
      href: "/dashboard/certificates", kind: "Credential",
    })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Notifications</h1>
          <p className="text-gray-400 text-sm mt-0.5">Verification results, decisions and upcoming expiries.</p>
        </div>
        <MarkAllRead unread={unread} />
      </div>

      {/* Live expiry alerts */}
      {expiries.length > 0 && (
        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 mb-5">
          <p className="text-xs font-bold text-amber-900 mb-2.5">⏳ Expiring within 60 days</p>
          <div className="flex flex-col gap-1.5">
            {expiries.map(e => {
              const overdue = e.date < today;
              return (
                <Link key={e.key} href={e.href} className="flex items-center gap-2 group">
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${overdue ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"}`}>
                    {e.kind}
                  </span>
                  <span className="text-xs text-amber-900/90 group-hover:text-amber-950 truncate flex-1">{e.label}</span>
                  <span className={`text-[10px] shrink-0 ${overdue ? "text-red-600 font-bold" : "text-amber-700/70"}`} suppressHydrationWarning>
                    {overdue ? "expired " : ""}{new Date(e.date).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Stored notifications */}
      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
        {notifications.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-3xl mb-2">🔔</p>
            <p className="text-sm font-semibold text-gray-700">No notifications yet</p>
            <p className="text-xs text-gray-400 mt-1">
              You&apos;ll be notified here when your logbook entries are verified, decisions are issued,
              or credentials are recorded.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {notifications.map(n => {
              const inner = (
                <div className={`px-5 py-3.5 flex items-start gap-3 ${n.read ? "" : "bg-teal-50/40"}`}>
                  <span className="text-lg shrink-0">{TYPE_ICON[n.type] ?? "🔔"}</span>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm ${n.read ? "text-gray-600" : "font-semibold text-gray-900"}`}>{n.title}</p>
                    {n.body && <p className="text-xs text-gray-400 mt-0.5 leading-snug">{n.body}</p>}
                    <p className="text-[10px] text-gray-300 mt-1" suppressHydrationWarning>
                      {new Date(n.created_at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  {!n.read && <span className="w-2 h-2 rounded-full bg-teal-500 shrink-0 mt-1.5" />}
                </div>
              );
              return n.href
                ? <Link key={n.id} href={n.href} className="block hover:bg-gray-50 transition-colors">{inner}</Link>
                : <div key={n.id}>{inner}</div>;
            })}
          </div>
        )}
      </div>

      <p className="text-[10px] text-gray-300 mt-4">
        Notifications are in-app only — email and SMS delivery isn&apos;t configured yet.
      </p>
    </div>
  );
}
