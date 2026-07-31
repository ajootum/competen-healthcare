import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadUnitCommunications } from "@/lib/operations/unit-communications";
import { cardClass, Section, Badge, Alert, Progress, PriorityPill, TableWrap, Th, EmptyState, type BadgeTone } from "@/components/ui/primitives";
import { KpiRibbon, StackedBar } from "@/components/ui/charts";

// Notifications, Communications & Collaboration (UMW-TLS-004) — migrations 161 + 163.
//
// Priority and acknowledgement come from the notification row itself (migration 161), not from a second
// opinion formed here. "Unanswered critical alerts" is therefore a real query over requires_ack and
// escalate_after_min, not a heuristic over type names.
//
// The notification centre is THIS MANAGER'S OWN inbox. There is no hospital-wide notification feed to
// aggregate, and manufacturing one would mean showing a manager other people's private notifications.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

const ALLOWED = ["hospital_admin", "super_admin"];
const titleCase = (s: string | null | undefined) => (s ?? "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
const when = (t: string | null) => t ? new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const TONE: Record<string, BadgeTone> = { critical: "critical", high: "error", emergency: "critical", urgent: "warning", medium: "warning", moderate: "warning", low: "info", routine: "neutral" };
const KIND: Record<string, { icon: string; tone: BadgeTone }> = {
  notification: { icon: "🔔", tone: "info" }, message: { icon: "💬", tone: "neutral" },
  broadcast: { icon: "📣", tone: "primary" }, escalation: { icon: "⬆", tone: "error" },
};

export default async function UnitCommunicationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ALLOWED.includes(r))) redirect("/dashboard");

  const d: any = await loadUnitCommunications(admin, profile?.hospital_id ?? null, roles.includes("super_admin"), user.id);
  const k = d.kpis;

  return (
    <div className="space-y-4 max-w-[1500px]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Notifications, Communications &amp; Collaboration</h1>
          <p className="text-sm text-gray-500 mt-0.5">Operational communications for this unit — {d.window.days} days from {d.window.from}.</p>
        </div>
        <Link href="/dashboard/preferences" className="text-sm font-medium text-teal-700 hover:underline self-center">Notification preferences →</Link>
      </div>

      <KpiRibbon
        kpis={[
          { label: "Unread", value: k.unread, sub: "your notifications", href: "/dashboard/notifications" },
          { label: "Awaiting your acknowledgement", value: k.unanswered, tone: k.unansweredOverdue ? "critical" : k.unanswered ? "warning" : "default",
            sub: k.unansweredOverdue ? `${k.unansweredOverdue} past escalation window` : "none overdue" },
          { label: "Open escalations", value: k.openEscalations, tone: k.openEscalations ? "warning" : "default", sub: "unit-wide" },
          { label: "Messages", value: k.messages, sub: k.unreadMessages == null ? "read receipts unavailable" : `${k.unreadMessages} unread by you` },
          { label: "Broadcasts", value: k.broadcasts, sub: d.broadcasts.recorded === 0 ? "none sent in window" : "sent in window" },
          { label: "Open tasks", value: d.taskAck.pending, tone: d.taskAck.overdue ? "warning" : "default",
            sub: d.taskAck.overdue ? `${d.taskAck.overdue} overdue` : `${d.taskAck.unassigned} unassigned` },
        ]}
        note={d.frameworkReady ? undefined : "Notification priority is unavailable on this database — apply migration 161 to enable the priority and acknowledgement model."}
      />

      {d.signals.length > 0 && (
        <div className="space-y-2">
          {d.signals.map((s: any, i: number) => (
            <Alert key={i} tone={s.severity === "high" ? "critical" : "warning"}>{s.text}</Alert>
          ))}
        </div>
      )}

      {/* ── Unanswered alerts: the spec's sharpest requirement ── */}
      <Section title="Alerts Awaiting Acknowledgement" sub={`${d.notifications.unanswered.length}`}
        note="Only alerts whose priority REQUIRES acknowledgement appear here. Reading one does not clear it — that distinction is enforced by the notification framework, not by this page.">
        {d.notifications.unanswered.length === 0 ? (
          <p className="text-sm text-gray-500">Nothing is awaiting your acknowledgement.</p>
        ) : (
          <ul className="space-y-2">
            {d.notifications.unanswered.slice(0, 10).map((n: any) => (
              <li key={n.id} className="flex items-start justify-between gap-3 border-b border-gray-50 last:border-0 pb-2 last:pb-0">
                <div className="min-w-0">
                  <p className="text-sm text-gray-900">{n.title}</p>
                  {n.body && <p className="text-[11px] text-gray-500">{n.body}</p>}
                  <p className="text-[10px] text-gray-400">
                    {n.category ? titleCase(n.category) : "Notification"} · raised {n.ageMin < 60 ? `${n.ageMin} min ago` : when(n.created_at)}
                    {n.escalate_after_min ? ` · escalates after ${n.escalate_after_min} min` : ""}
                  </p>
                </div>
                <span className="flex items-center gap-1.5 shrink-0">
                  {n.overdue && <Badge tone="critical" icon="▲">Overdue</Badge>}
                  {n.priority && <PriorityPill level={n.priority} />}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* ── Notification centre ── */}
        <Section title="Notification Centre" sub={`${d.notifications.recorded} in window`}
          note="Your own notifications. There is no hospital-wide feed — other people's notifications are theirs.">
          {d.notifications.recorded === 0 ? (
            <EmptyState title="No notifications in this window" icon="🔔" />
          ) : (
            <>
              <StackedBar label="By priority"
                segments={d.notifications.byPriority.filter((p: any) => p.n > 0).map((p: any) => ({
                  name: titleCase(p.priority), value: p.n,
                  color: p.priority === "critical" ? "var(--cmp-color-critical)" : p.priority === "high" ? "var(--cmp-color-warning)"
                    : p.priority === "medium" ? "var(--cmp-color-secondary)" : "var(--cmp-color-information)",
                }))} />
              <div className="mt-3 space-y-1">
                {d.notifications.byCategory.map((c: any) => (
                  <div key={c.category} className="flex items-center justify-between text-[11px]">
                    <span className="text-gray-700"><span aria-hidden>{c.icon}</span> {c.label}</span>
                    <span className="text-gray-400 tabular-nums">{c.unread > 0 && <span className="text-gray-700 font-medium">{c.unread} unread · </span>}{c.n}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Section>

        {/* ── Delivery health ── */}
        <Section title="Delivery" sub={`${d.delivery.recorded} attempts`}
          note="Recorded per channel by the dispatcher. A channel with no attempts is not shown — silence is not a 100% success rate.">
          {d.delivery.recorded === 0 ? (
            <p className="text-sm text-gray-500">No delivery attempts recorded in this window.</p>
          ) : (
            <div className="space-y-2">
              {d.delivery.byChannel.map((c: any) => (
                <div key={c.channel}>
                  <Progress label={titleCase(c.channel)} value={c.rate}
                    tone={c.rate == null ? "primary" : c.rate >= 95 ? "success" : c.rate >= 80 ? "warning" : "critical"} />
                  <p className="text-[10px] text-gray-400">{c.sent} sent · {c.failed} failed · {c.skipped} skipped of {c.attempts}</p>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* ── Task acknowledgement ── */}
        <Section title="Task Acknowledgement" sub={`${d.taskAck.recorded} tasks`}>
          {d.taskAck.recorded === 0 ? (
            <p className="text-sm text-gray-500">No tasks raised in this window.</p>
          ) : (
            <div className="space-y-1.5 text-sm">
              <p className="text-gray-700">Pending <span className="font-semibold tabular-nums">{d.taskAck.pending}</span></p>
              <p className="text-gray-700">Unassigned <span className="font-semibold tabular-nums" style={d.taskAck.unassigned ? { color: "var(--cmp-text-warning)" } : undefined}>{d.taskAck.unassigned}</span></p>
              <p className="text-gray-700">Overdue <span className="font-semibold tabular-nums" style={d.taskAck.overdue ? { color: "var(--cmp-text-critical)" } : undefined}>{d.taskAck.overdue}</span></p>
              <p className="text-gray-700">Completed <span className="font-semibold tabular-nums">{d.taskAck.completed}</span></p>
            </div>
          )}
        </Section>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* ── Team messaging ── */}
        <Section title="Team Messaging" sub={`${d.messaging.recorded} messages`}
          note={d.readsReady
            ? "Unread counts come from per-message read receipts. Your own messages are never counted as unread to you."
            : "Read receipts are unavailable on this database — apply migration 163 to enable per-message unread counts."}>
          {d.messaging.recorded === 0 ? (
            <EmptyState title="No messages in this window" icon="💬" />
          ) : (
            <>
              <TableWrap>
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-100"><Th>Channel</Th><Th>Context</Th><Th align="right">Messages</Th><Th align="right">Unread</Th><Th>Last</Th></tr></thead>
                  <tbody>
                    {d.messaging.channels.slice(0, 10).map((c: any) => (
                      <tr key={c.channel} className="border-b border-gray-50 last:border-0">
                        <td className="py-2 text-gray-900 font-medium">{c.channel}</td>
                        <td className="py-2 text-[11px] text-gray-500">{titleCase(c.contextType)}</td>
                        <td className="py-2 text-right tabular-nums text-gray-600">{c.total}</td>
                        <td className="py-2 text-right tabular-nums">
                          {!d.readsReady ? <span className="text-gray-400">—</span> : c.unread > 0 ? <span className="font-semibold text-gray-900">{c.unread}</span> : <span className="text-gray-400">0</span>}
                        </td>
                        <td className="py-2 text-[11px] text-gray-400">{when(c.lastAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
              <p className="text-[10px] text-gray-400 mt-2">
                op_messages is a CHANNEL store — it has no recipient column, so &quot;unread&quot; means a message in a channel you have not opened, not a message addressed to you.
              </p>
            </>
          )}
        </Section>

        {/* ── Broadcasts ── */}
        <Section title="Broadcasts" sub={`${d.broadcasts.recorded} in window`}
          note="Acknowledgement rate needs a target audience size. Where a broadcast has none, no rate is shown rather than an invented denominator.">
          {d.broadcasts.recorded === 0 ? (
            <EmptyState title="No broadcasts sent in this window" icon="📣" />
          ) : (
            <ul className="space-y-2">
              {d.broadcasts.items.slice(0, 8).map((b: any) => (
                <li key={b.id} className="border-b border-gray-50 last:border-0 pb-2 last:pb-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm text-gray-900">{b.title}</p>
                      <p className="text-[10px] text-gray-400">
                        {b.author_name ?? "System"} · {when(b.created_at)}{b.audience ? ` · ${b.audience}` : ""}
                        {b.expired ? " · expired" : ""}
                      </p>
                    </div>
                    <span className="flex items-center gap-1.5 shrink-0">
                      {b.emergency && <Badge tone="critical" icon="▲">Emergency</Badge>}
                      {b.priority && <Badge tone={TONE[b.priority] ?? "neutral"}>{titleCase(b.priority)}</Badge>}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-500 mt-1">
                    {b.ackRate == null
                      ? <>{b.acked} acknowledgement{b.acked === 1 ? "" : "s"} · no target audience recorded, so no rate</>
                      : <>{b.acked} of {b.target_count} acknowledged · {b.ackRate}%</>}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {/* ── Communication timeline ── */}
      <Section title="Communication Timeline" sub="notifications, messages, broadcasts and escalations, merged">
        {d.timeline.length === 0 ? (
          <EmptyState title="Nothing recorded in this window" icon="🗓" />
        ) : (
          <ul className="space-y-2">
            {d.timeline.slice(0, 20).map((t: any, i: number) => (
              <li key={`${t.kind}-${i}`} className="flex items-start gap-2.5 border-b border-gray-50 last:border-0 pb-2 last:pb-0">
                <span className="text-sm leading-5 shrink-0" aria-hidden>{KIND[t.kind]?.icon ?? "•"}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-900">{t.title}</p>
                  {t.detail && <p className="text-[11px] text-gray-500 truncate">{t.detail}</p>}
                </div>
                <span className="flex items-center gap-1.5 shrink-0">
                  <Badge tone={KIND[t.kind]?.tone ?? "neutral"}>{titleCase(t.kind)}</Badge>
                  <span className="text-[10px] text-gray-400 whitespace-nowrap">{when(t.at)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className={cardClass}>
        <h2 className="text-sm font-bold text-gray-900 mb-2">What this hub does not do</h2>
        <ul className="space-y-1.5 text-[11px] text-gray-600">
          <li><span className="font-medium text-gray-700">No hospital-wide notification feed.</span> Notifications are per-user. A manager sees their own, plus what is unanswered — not everyone else&apos;s inbox.</li>
          <li><span className="font-medium text-gray-700">No AI drafting or recipient recommendation.</span> The spec asks for both. Drafting an announcement on a manager&apos;s behalf and guessing who should receive it are decisions with real consequences, and neither has a grounded model here.</li>
          <li><span className="font-medium text-gray-700">Message unread is channel-based.</span> op_messages has no recipient, so unread means &quot;in a channel you have not opened&quot;, not &quot;addressed to you and unread&quot;.</li>
          <li><span className="font-medium text-gray-700">Priority is not re-derived here.</span> It is stored on the notification, and the acknowledgement and escalation rules come from the shared framework — so this page cannot disagree with the alert a nurse saw.</li>
        </ul>
      </div>
    </div>
  );
}
