import { redirect } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { operationsHome } from "@/lib/practice/operations-home";

// CPR-300 PRACTICE OPERATIONS HOME -- laid out to the specification's design comp.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THIS PAGE WAS REBUILT AFTER CPR-AUDIT-001. The first version was designed from the module's title
// alone, without opening the specification or the comp that shipped beside it. It replaced the whole
// layout on the grounds that some of the comp's figures were invented -- which justified omitting four
// tiles, not designing a different page.
//
// So the comp's structure is here: the KPI strip, today's schedule, practice health, operational
// alerts, tasks, messages and quick actions. The ordering doctrine survives INSIDE that layout, as the
// alerts panel: still ordered by what it costs to ignore, still capability-aware, still naming its
// blind spots.
//
// FIGURES THIS PRODUCT CANNOT PRODUCE RENDER IN THEIR DESIGNED POSITION AND SAY WHY. Patient
// satisfaction, revenue and collection appear as the comp places them, carrying the reason they are
// empty. A reader cannot tell an absent tile from an unbuilt one; an empty state in the right place
// can. What is still refused is the CLAIM -- no invented number, no "↑25% vs yesterday" against a
// baseline nothing recorded, no compliance badge, no AI panel for a capability CPR-210 has not built.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

const TONE: Record<string, { border: string; chip: string; text: string }> = {
  critical: {
    border: "border-[var(--cmp-color-critical)]",
    chip: "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]",
    text: "text-[var(--cmp-text-critical)]",
  },
  warning: {
    border: "border-[var(--cmp-color-warning)]",
    chip: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]",
    text: "text-[var(--cmp-text-warning)]",
  },
  normal: { border: "border-gray-200", chip: "bg-gray-100 text-gray-600", text: "text-gray-900" },
};

const card = "rounded-xl border border-gray-200 bg-white p-4";

export default async function PracticeHome() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  const { ctx } = shell;

  const home = await operationsHome(createAdminClient(), ctx);

  return (
    <div className="max-w-[1400px]">
      {/* Header row — title, date, location, notifications (comp: top bar) */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Practice operations home</h1>
          <p className="mt-0.5 text-[13px] text-gray-500">
            Your operational overview and daily command centre.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] text-gray-700">
            {home.today} · {home.timezone}
          </span>
          {/* The comp's location switcher. Real since CPR-360 made locations creatable; it renders only
              when there is more than one, because a switcher with one option is furniture. */}
          {home.locations.length > 1 ? (
            <span className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] text-gray-700">
              {home.locations.length} locations
            </span>
          ) : home.locations.length === 1 ? (
            <span className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] text-gray-700">
              {home.locations[0].name}
            </span>
          ) : null}
          {home.unreadNotifications > 0 && (
            <Link href="/practice/tasks"
              className="rounded-lg bg-[var(--cp-primary-soft)] px-3 py-1.5 text-[12px] font-semibold text-[var(--cp-primary-deep)] hover:bg-[var(--cp-primary-border)]">
              {home.unreadNotifications} new
            </Link>
          )}
        </div>
      </div>

      {/* KPI strip (comp: six tiles across the top) */}
      <div className="mt-4 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {home.kpis.map(k => (
          <div key={k.key} className={card}>
            <p className="text-[11px] font-semibold text-gray-500">{k.label}</p>
            {k.available ? (
              <>
                <Link href={k.href} className="mt-1 block text-2xl font-bold text-gray-900 hover:underline">
                  {k.value}
                </Link>
                <p className="mt-0.5 text-[10px] text-gray-500">{k.detail}</p>
              </>
            ) : (
              <>
                <p className="mt-1 text-2xl font-bold text-gray-300">&mdash;</p>
                <p className="mt-0.5 text-[10px] text-gray-400">not visible to you</p>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 grid xl:grid-cols-3 gap-4">
        {/* Today's schedule (comp: left column) */}
        <section className={card}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-[13px] font-bold text-gray-900">Today&apos;s schedule</h2>
            <Link href="/practice/calendar" className="text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
              Full day →
            </Link>
          </div>
          {home.appointments.length === 0 ? (
            <p className="mt-2 text-[12px] text-gray-400">Nothing booked today.</p>
          ) : (
            <ul className="mt-2 flex flex-col">
              {home.appointments.map((a: any) => (
                <li key={a.id} className="flex items-baseline gap-2 border-b border-gray-100 py-2 last:border-0">
                  <span className="w-12 shrink-0 font-mono text-[11px] text-gray-500">
                    {new Date(a.scheduled_at).toISOString().slice(11, 16)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-semibold text-gray-900">{a.patient_name}</span>
                    <span className="block text-[10px] text-gray-500">{String(a.appointment_type).replace(/_/g, " ")}</span>
                  </span>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                    a.status === "ARRIVED" ? "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]"
                      : a.status === "COMPLETED" ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]"
                        : "bg-gray-100 text-gray-600"}`}>
                    {a.status.toLowerCase()}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[10px] text-gray-400">
            Appointments, not clinic sessions &mdash; sessions are a CPR-300 capability that is not built.
            The day runs on {home.timezone}.
          </p>
        </section>

        {/* Practice health (comp: middle column) */}
        <section className={card}>
          <h2 className="text-[13px] font-bold text-gray-900">Practice health</h2>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {home.health.map(h => (
              <div key={h.key} className="rounded-lg border border-gray-100 p-2">
                <p className="text-[10px] font-semibold text-gray-500">{h.label}</p>
                {h.available ? (
                  <p className="mt-0.5">
                    <span className="text-lg font-bold text-gray-900">{h.value}</span>
                    {h.of !== null && <span className="ml-1 text-[10px] text-gray-500">of {h.of}</span>}
                  </p>
                ) : (
                  <p className="mt-0.5 text-[10px] leading-tight text-gray-400">{h.reason}</p>
                )}
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-gray-400">
            Counts and denominators, never rates &mdash; a percentage over a small number reads as a
            measurement and is not one. The empty tiles are drawn where the design puts them so an
            unbuilt capability is visible rather than silently absent.
          </p>
        </section>

        {/* Operational alerts (comp: right column) — the ordering doctrine, inside the specified layout */}
        <section className={card}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-[13px] font-bold text-gray-900">Operational alerts</h2>
            {home.attention.length > 0 && (
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-600">
                {home.attention.length}
              </span>
            )}
          </div>

          {home.allClear && (
            <div className="mt-2 rounded-lg border border-[var(--cmp-color-success)] bg-[var(--cmp-surface-success)] p-3">
              <p className="text-[12px] font-bold text-[var(--cmp-text-success)]">Nothing is owed.</p>
              <p className="mt-0.5 text-[11px] text-gray-700">
                Checked across everything you can see &mdash; not a default.
              </p>
            </div>
          )}

          {home.attention.length === 0 && home.blindSpots.length > 0 && (
            <p className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-[11px] text-gray-600">
              Nothing owed in what you can see. You do not hold the capabilities for{" "}
              {home.blindSpots.join(", ")}, so this cannot tell you whether anything is outstanding there.
            </p>
          )}

          <ul className="mt-2 flex flex-col gap-2">
            {home.attention.map(item => {
              const tone = TONE[item.severity] ?? TONE.normal;
              return (
                <li key={item.kind} className={`rounded-lg border p-2 ${tone.border}`}>
                  <div className="flex items-baseline gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${tone.chip}`}>{item.count}</span>
                    <Link href={item.href} className="text-[12px] font-semibold text-gray-900 hover:underline">
                      {item.title}
                    </Link>
                  </div>
                  <p className="mt-0.5 text-[10px] leading-tight text-gray-600">{item.detail}</p>
                  {item.sample.length > 0 && (
                    <ul className="mt-1 flex flex-col gap-0.5">
                      {item.sample.slice(0, 3).map(s => (
                        <li key={s.id} className="truncate text-[10px] text-gray-500">
                          {s.href ? (
                            <Link href={s.href} className="font-semibold text-gray-700 hover:underline">{s.label}</Link>
                          ) : <span className="font-semibold text-gray-700">{s.label}</span>}
                          {s.note && <span> — {s.note}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
          {home.attention.length > 0 && (
            <p className="mt-2 text-[10px] text-gray-400">
              Ordered by what it costs to ignore, not by size or recency.
            </p>
          )}
        </section>
      </div>

      <div className="mt-4 grid xl:grid-cols-3 gap-4">
        {/* Tasks (comp: bottom-left) */}
        <section className={card}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-[13px] font-bold text-gray-900">Tasks &amp; actions</h2>
            <Link href="/practice/tasks" className="text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
              Go to tasks →
            </Link>
          </div>
          {(() => {
            const t = home.attention.filter(i => i.kind === "task_overdue" || i.kind === "task_due");
            const rows = t.flatMap(i => i.sample);
            return rows.length === 0 ? (
              <p className="mt-2 text-[12px] text-gray-400">Nothing due.</p>
            ) : (
              <ul className="mt-2 flex flex-col">
                {rows.slice(0, 6).map(s => (
                  <li key={s.id} className="flex items-baseline gap-2 border-b border-gray-100 py-1.5 last:border-0">
                    <span className="min-w-0 flex-1 truncate text-[12px] text-gray-800">{s.label}</span>
                    <span className="shrink-0 text-[10px] text-gray-500">{s.note}</span>
                  </li>
                ))}
              </ul>
            );
          })()}
        </section>

        {/* Messages (comp: bottom-middle) */}
        <section className={card}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-[13px] font-bold text-gray-900">Messages &amp; inbox</h2>
            <Link href="/practice/messages" className="text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
              Go to inbox →
            </Link>
          </div>
          {(() => {
            const m = home.attention.filter(i => i.kind === "message_unread" || i.kind === "incoming_unreviewed" || i.kind === "notification_unread");
            return m.length === 0 ? (
              <p className="mt-2 text-[12px] text-gray-400">Nothing new.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1.5">
                {m.map(i => (
                  <li key={i.kind}>
                    <Link href={i.href} className="text-[12px] font-semibold text-gray-900 hover:underline">
                      {i.title}
                    </Link>
                    <span className="ml-1.5 text-[11px] text-gray-500">{i.count}</span>
                  </li>
                ))}
              </ul>
            );
          })()}
        </section>

        {/* Quick actions (comp: bottom-right, 3×3 grid) */}
        <section className={card}>
          <h2 className="text-[13px] font-bold text-gray-900">Quick actions</h2>
          {home.quickActions.length === 0 ? (
            <p className="mt-2 text-[12px] text-gray-400">
              Nothing here is available to you in this practice.
            </p>
          ) : (
            <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
              {home.quickActions.map(a => (
                <Link key={a.key} href={a.href}
                  className="rounded-lg border border-gray-200 px-2 py-3 text-center text-[11px] font-semibold text-gray-700 hover:border-[var(--cp-primary)] hover:bg-[var(--cp-primary-soft)]">
                  {a.label}
                </Link>
              ))}
            </div>
          )}
          <p className="mt-2 text-[10px] text-gray-400">
            Only what you hold the capability for. The design&apos;s ninth action opens an AI assistant;
            CPR-210 is not built, and a button that leads nowhere is worse than an absent one.
          </p>
        </section>
      </div>

      {/* Practice + activity (kept from the previous build; the comp has no equivalent, and both are real) */}
      <div className="mt-4 grid lg:grid-cols-2 gap-4">
        <section className={card}>
          <h2 className="text-[13px] font-bold text-gray-900">This practice</h2>
          <dl className="mt-2 grid grid-cols-2 gap-2">
            {[
              ["Locations", String(home.practice.locations)],
              ["Team", String(home.practice.members)],
              ["Plan", home.practice.entitlementStatus === "trial"
                ? `Trial${home.practice.trialDaysLeft !== null ? ` · ${home.practice.trialDaysLeft}d left` : ""}`
                : (home.practice.plan ?? "—")],
              ["Workspace", home.practice.workspaceStatus],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{k}</dt>
                <dd className="text-[13px] font-bold text-gray-900">{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className={card}>
          <h2 className="text-[13px] font-bold text-gray-900">Recent activity</h2>
          {home.recentActivity.length === 0 ? (
            <p className="mt-2 text-[12px] text-gray-400">No activity recorded yet.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1">
              {home.recentActivity.map((e: any, i: number) => (
                <li key={i} className="flex items-baseline justify-between gap-3 text-[11px]">
                  <span className="truncate font-mono text-gray-700">{e.event_type}</span>
                  <span className="shrink-0 text-gray-400" suppressHydrationWarning>
                    {new Date(e.occurred_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[10px] text-gray-400">
            The workspace audit trail. It cannot be edited from the app.
          </p>
        </section>
      </div>
    </div>
  );
}
