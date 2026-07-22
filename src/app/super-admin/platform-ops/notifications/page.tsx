import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadNotificationsOps } from "@/lib/notifications/dispatch";
import NotificationsTester from "./NotificationsTester";

export const dynamic = "force-dynamic";

// Notifications console (PFS-000 §12 / POS-001H) — channel providers, delivery
// tracking and a test-send. In-app is always live; email/webhook are real
// adapters gated on provider env; other channels show honest states.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const fmt = (n: number) => n.toLocaleString();
const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
const CH_ICON: Record<string, string> = { in_app: "🔔", email: "✉️", sms: "💬", webhook: "🪝", teams: "👥", slack: "🧵" };
const STATUS_TONE: Record<string, string> = { sent: "text-green-600", failed: "text-rose-600", skipped: "text-gray-400", queued: "text-amber-600" };

export default async function NotificationsConsole() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const { summary: s, byChannel, recent } = await loadNotificationsOps(admin);

  const kpis = [
    { label: "Channels Ready", value: `${s.channelsReady}/6`, icon: "📡", iconBg: "bg-teal-50", sub: "with a provider" },
    { label: "Deliveries (24h)", value: s.ready ? fmt(s.deliveries24h) : "—", icon: "📨", iconBg: "bg-sky-50", sub: s.ready ? `${s.sent24h} sent` : "tracking off", muted: !s.ready },
    { label: "Failed (24h)", value: s.ready ? fmt(s.failed24h) : "—", icon: "⚠️", iconBg: "bg-rose-50", sub: "delivery errors", tone: s.failed24h ? "text-rose-600" : undefined, muted: !s.ready },
    { label: "Skipped (24h)", value: s.ready ? fmt(s.skipped24h) : "—", icon: "⏭️", iconBg: "bg-gray-50", sub: "no provider", muted: !s.ready },
    { label: "In-app Read Rate", value: s.readRate == null ? "—" : `${s.readRate}%`, icon: "👁️", iconBg: "bg-violet-50", sub: `${fmt(s.totalNotifs)} messages`, muted: s.readRate == null },
    { label: "In-app Messages", value: fmt(s.totalNotifs), icon: "🔔", iconBg: "bg-amber-50", sub: "total stored" },
  ];

  return (
    <div data-wide className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Link href="/super-admin/platform-ops" className="hover:text-teal-700">Platform Operations</Link><span>/</span><span className="text-gray-600">Notifications</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mt-0.5">Notification &amp; Delivery</h1>
        <p className="text-sm text-gray-500">Channels, providers, delivery tracking and escalation across the platform.</p>
      </div>

      {!s.ready && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="font-semibold">Delivery tracking off.</span> Run <code className="font-mono text-[12px] bg-amber-100 px-1 rounded">supabase/RUN-ME-056-notification-delivery.sql</code> to log deliveries. In-app notifications still send; channel providers below are live.
        </div>
      )}

      {/* KPI ribbon */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map(k => (
          <div key={k.label} className={`${card} p-4`}>
            <div className="flex items-start justify-between">
              <span className="text-[11px] font-semibold text-gray-500 leading-tight">{k.label}</span>
              <span className={`w-7 h-7 rounded-lg ${k.iconBg} flex items-center justify-center text-sm shrink-0`}>{k.icon}</span>
            </div>
            <p className={`text-2xl font-bold mt-1.5 tabular-nums ${(k as any).muted ? "text-gray-400" : (k as any).tone ?? "text-gray-900"}`}>{k.value}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{k.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Channels */}
        <div className={`${card} p-5 lg:col-span-2`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Channels</h2>
          <div className="space-y-1.5">
            {byChannel.map((ch: any) => (
              <div key={ch.channel} className="flex items-center gap-3 py-1.5">
                <span className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center text-sm shrink-0">{CH_ICON[ch.channel]}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-800 capitalize">{ch.channel.replace("_", "-")} <span className="text-[10px] text-gray-400">{ch.provider ? `· ${ch.provider}` : ""}</span></p>
                  <p className="text-[10px] text-gray-400">{s.ready ? `${ch.n} sent ${ch.sent} · failed ${ch.failed} · skipped ${ch.skipped} (24h)` : "tracking off"}</p>
                </div>
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded shrink-0 ${ch.ready ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>{ch.ready ? "Provider ready" : "No provider"}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-3 pt-2 border-t border-gray-50">In-app is always live. Email activates with <code className="font-mono">RESEND_API_KEY</code>+<code className="font-mono">NOTIFY_FROM_EMAIL</code>, webhook with <code className="font-mono">NOTIFY_WEBHOOK_URL</code>, SMS with Twilio env. Unconfigured channels record an honest skip.</p>
        </div>

        {/* Test send */}
        <NotificationsTester />
      </div>

      {/* Recent deliveries */}
      <div className={`${card} p-5`}>
        <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Recent Deliveries</h2>
        {!s.ready || recent.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">{s.ready ? "No deliveries recorded yet — send a test above." : "Run the migration to record deliveries."}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                <th className="px-3 py-2 font-semibold">Channel</th><th className="px-3 py-2 font-semibold">Provider</th><th className="px-3 py-2 font-semibold">Target</th><th className="px-3 py-2 font-semibold">Status</th><th className="px-3 py-2 font-semibold">Detail</th><th className="px-3 py-2 font-semibold text-right">When</th>
              </tr></thead>
              <tbody>
                {recent.map((r: any, i: number) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="px-3 py-2 text-gray-700 capitalize">{CH_ICON[r.channel]} {r.channel.replace("_", "-")}</td>
                    <td className="px-3 py-2 text-gray-500">{r.provider ?? "—"}</td>
                    <td className="px-3 py-2 text-gray-500 font-mono text-[11px] truncate max-w-[160px]">{r.address ?? "—"}</td>
                    <td className={`px-3 py-2 capitalize font-medium ${STATUS_TONE[r.status] ?? "text-gray-500"}`}>{r.status}</td>
                    <td className="px-3 py-2 text-gray-400 text-[11px] truncate max-w-[220px]">{r.error ?? ""}</td>
                    <td className="px-3 py-2 text-right text-[11px] text-gray-400">{relTime(r.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Every notification records a per-channel delivery attempt. In-app is real and always on; email and webhook are real adapters gated on provider env; SMS/Teams/Slack show honest states until a provider is wired. Escalation chains, retries and read receipts are the next layer.</p>
    </div>
  );
}
