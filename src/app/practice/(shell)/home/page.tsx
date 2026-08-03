import { redirect } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { operationsHome } from "@/lib/practice/operations-home";

// CPR-300 OPERATIONS HOME -- the default authorised landing (SHELL-001 s8), and what CPR-V2-001's
// "Practice Command Centre" has become now that there is a product behind it.
//
// EVERY FIGURE ON THIS PAGE IS THE LENGTH OF A LIST YOU CAN OPEN. That rule is enforced by the shape of
// the data: operationsHome returns attention items, each carrying a count, a link and real sample rows,
// and this page has no other source of numbers. There is nowhere for a decorative statistic to come
// from, which is the point -- see the module header for what the comps wanted here instead.
//
// THE ORDER IS THE ENGINE'S, NOT THIS FILE'S. `attention` arrives sorted by what it costs to ignore, so
// the page renders it in sequence and cannot quietly re-sort itself on aesthetics.
//
// AN EMPTY PAGE SAYS WHY IT IS EMPTY. Nothing owed and nothing hidden is "you are clear"; nothing owed
// but blocks the caller cannot see is a different sentence, and blindSpots names them.

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

export default async function PracticeHome() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  const { ctx } = shell;

  const home = await operationsHome(createAdminClient(), ctx);

  return (
    <div className="max-w-5xl">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-gray-900">{ctx.workspaceName}</h1>
        <p className="text-[12px] text-gray-400">
          {home.today} · {home.timezone}
        </p>
      </div>
      <p className="mt-0.5 text-[13px] text-gray-500">
        What is owed, in the order it costs to ignore. Every number here opens the list behind it.
      </p>

      {home.allClear && (
        <section className="mt-4 rounded-xl border border-[var(--cmp-color-success)] bg-[var(--cmp-surface-success)] p-5">
          <p className="text-[13px] font-bold text-[var(--cmp-text-success)]">Nothing is owed.</p>
          <p className="mt-1 text-[12px] text-gray-700">
            No overdue follow-ups, no unsigned encounters, no unissued documents, nobody waiting. This is
            checked across everything you can see &mdash; not a default.
          </p>
        </section>
      )}

      {home.attention.length === 0 && home.blindSpots.length > 0 && (
        <section className="mt-4 rounded-xl border border-gray-200 bg-white p-5">
          <p className="text-[13px] font-semibold text-gray-700">Nothing is owed in what you can see.</p>
          <p className="mt-1 text-[12px] text-gray-500">
            You do not hold the capabilities for {home.blindSpots.join(", ")}, so this page cannot tell
            you whether anything is outstanding there. That is a different statement from &ldquo;nothing
            is outstanding&rdquo;.
          </p>
        </section>
      )}

      {/* The attention list. Each tile is a count, a sentence about what it means, and real rows. */}
      <div className="mt-4 flex flex-col gap-3">
        {home.attention.map(item => {
          const tone = TONE[item.severity] ?? TONE.normal;
          return (
            <section key={item.kind} className={`rounded-xl border bg-white p-4 ${tone.border}`}>
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className={`rounded px-2 py-0.5 text-[13px] font-bold ${tone.chip}`}>{item.count}</span>
                <h2 className="text-[13px] font-bold text-gray-900">{item.title}</h2>
                <Link href={item.href} className="ml-auto text-[12px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
                  Open →
                </Link>
              </div>
              <p className="mt-1 text-[12px] text-gray-600">{item.detail}</p>
              {item.sample.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1">
                  {item.sample.map(s => (
                    <li key={s.id} className="flex items-baseline gap-2 text-[12px]">
                      {s.href ? (
                        <Link href={s.href} className="font-semibold text-gray-800 hover:underline">{s.label}</Link>
                      ) : (
                        <span className="font-semibold text-gray-800">{s.label}</span>
                      )}
                      {s.note && <span className="text-gray-500 truncate">{s.note}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {item.count > item.sample.length && (
                <p className="mt-1 text-[10px] text-gray-400">
                  Showing {item.sample.length} of {item.count}. The rest are behind the link.
                </p>
              )}
            </section>
          );
        })}
      </div>

      {/* Today's diary in full, below the attention list rather than above it: it is context for the
          work, not the work itself. */}
      {home.appointments.length > 0 && (
        <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[13px] font-bold text-gray-900">Today in full</h2>
            <Link href="/practice/calendar" className="text-[12px] font-semibold text-[var(--cp-primary-deep)] hover:underline">Calendar →</Link>
          </div>
          <ul className="mt-2 flex flex-col gap-1">
            {home.appointments.map((a: any) => (
              <li key={a.id} className="flex items-center gap-2 text-[12px]">
                <span className="font-mono text-gray-500">{new Date(a.scheduled_at).toISOString().slice(11, 16)}</span>
                <span className="font-semibold text-gray-800">{a.patient_name}</span>
                <span className="text-gray-400">{String(a.appointment_type).replace(/_/g, " ")}</span>
                <span className="ml-auto text-gray-500">{a.status}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] text-gray-400">
            The day runs on {home.timezone}, not on the server&apos;s clock.
          </p>
        </section>
      )}

      <div className="mt-4 grid lg:grid-cols-2 gap-4">
        <section className="rounded-xl border border-gray-200 bg-white p-4">
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
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{k}</dt>
                <dd className="text-[13px] font-bold text-gray-900">{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-[13px] font-bold text-gray-900">Recent activity</h2>
          {home.recentActivity.length === 0 ? (
            <p className="mt-2 text-[12px] text-gray-400">No activity recorded yet.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1.5">
              {home.recentActivity.map((e: any, i: number) => (
                <li key={i} className="flex items-baseline justify-between gap-3 text-[12px]">
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
