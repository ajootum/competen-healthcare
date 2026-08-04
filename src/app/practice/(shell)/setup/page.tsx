import { redirect } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { practiceSetup } from "@/lib/practice/setup";

// CPR-SETUP-001 v1 PRACTICE SETUP & CONFIGURATION FRAMEWORK -- seventeen modules.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// LAID OUT TO THE COMP: the module grid with its status legend, the progress ring and breakdown, quick
// actions, setup tips, and the recent activity strip.
//
// THE ONE NUMBER ON THIS SCREEN THAT MATTERS IS THE RING, AND THE COMP'S VERSION OF IT IS WRONG. It
// reads "13 of 17 · 76% complete" directly above a legend reading "Not configured 13". Thirteen is the
// count of areas that are NOT set up, drawn as though it were the count that are. Fixed here, and the
// engine's harness asserts the legend sums to the total so it cannot come back.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

const card = "rounded-xl border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

const CHIP: Record<string, { text: string; className: string; dot: string }> = {
  configured: { text: "Configured", className: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500" },
  needs_attention: { text: "Needs attention", className: "bg-amber-100 text-amber-700", dot: "bg-amber-500" },
  not_built: { text: "Not built", className: "bg-slate-100 text-slate-500", dot: "bg-slate-300" },
  no_access: { text: "No access", className: "bg-slate-100 text-slate-400", dot: "bg-slate-300" },
};

/** The ring: an arc drawn from done/of, with the fraction written inside it. Never a percentage. */
function ProgressRing({ done, of }: { done: number; of: number }) {
  const r = 34, c = 2 * Math.PI * r;
  const fraction = of === 0 ? 0 : done / of;
  return (
    <svg viewBox="0 0 84 84" className="h-[84px] w-[84px] shrink-0" role="img"
      aria-label={`${done} of ${of} configurable areas are set up`}>
      <circle cx="42" cy="42" r={r} fill="none" stroke="var(--cp-slate-100)" strokeWidth="8" />
      <circle cx="42" cy="42" r={r} fill="none" stroke="var(--cp-success)" strokeWidth="8"
        strokeLinecap="round" strokeDasharray={`${c * fraction} ${c}`} transform="rotate(-90 42 42)" />
      <text x="42" y="40" textAnchor="middle" className="fill-gray-900 text-[20px] font-bold">{done}</text>
      <text x="42" y="55" textAnchor="middle" className="fill-gray-400 text-[11px] font-semibold">of {of}</text>
    </svg>
  );
}

export default async function PracticeSetupOverview() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  const { ctx } = shell;

  const admin = createAdminClient();
  const s = await practiceSetup(admin, ctx);
  const nextUp = s.checklist.find(i => !i.done);

  return (
    <div className="-m-5 min-h-full bg-[var(--cp-canvas)] p-5">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4">

        {/* ── Title ─────────────────────────────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-start gap-3">
          <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--cp-primary)]/12 text-[20px] text-[var(--cp-primary-deep)]">
            ⚙
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-gray-900">Practice Setup</h1>
            <p className="text-[13px] leading-relaxed text-gray-500">
              Configure your practice settings and preferences. Complete the essential setup steps to
              deliver the best experience for your patients.
            </p>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px] items-start">
          <div className="flex flex-col gap-4">

            {/* ── The seventeen ─────────────────────────────────────────────────────────────────── */}
            <section className={card}>
              <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                <h2 className="text-[14px] font-bold text-gray-900">
                  Practice configuration modules ({s.modules.length})
                </h2>
                {/* The comp's legend. Every chip that appears on a card appears here with its count. */}
                <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">
                  {s.legend.map(l => (
                    <span key={l.key} className="flex items-center gap-1.5 text-[11px] text-gray-600">
                      <span aria-hidden className={`h-2 w-2 rounded-full ${CHIP[l.key]?.dot ?? "bg-slate-300"}`} />
                      {l.label}
                      <span className="font-bold text-gray-800">{l.count}</span>
                    </span>
                  ))}
                </div>
              </div>

              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {s.modules.map(m => {
                  const chip = CHIP[m.state];
                  const openable = !!m.href;
                  const muted = m.state === "not_built" || m.state === "no_access";
                  const Inner = (
                    <>
                      <div className="flex items-start justify-between gap-2">
                        <span aria-hidden
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[17px]"
                          style={{
                            background: muted ? "var(--cp-slate-100)" : `color-mix(in srgb, ${m.hue} 12%, white)`,
                            color: muted ? "var(--cp-slate-300)" : m.hue,
                          }}>
                          {m.icon}
                        </span>
                        {openable && <span aria-hidden className="text-gray-300">›</span>}
                      </div>
                      <p className={`mt-2.5 text-[12px] font-bold ${muted ? "text-gray-500" : "text-gray-900"}`}>
                        {m.n}. {m.title}
                      </p>
                      <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{m.description}</p>
                      <span className={`mt-2.5 inline-block rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${chip.className}`}>
                        {chip.text}
                      </span>
                      {m.detail && <span className="ml-1.5 text-[10px] text-gray-500">{m.detail}</span>}
                      {/* WHY IT CANNOT BE OPENED, in the card. The comp gives these the chip
                          "NOT CONFIGURED", which tells somebody to go and configure something that has
                          no screen -- an instruction they cannot follow. */}
                      {m.unavailableReason && (
                        <p className="mt-1.5 text-[10px] leading-relaxed text-gray-400">{m.unavailableReason}</p>
                      )}
                    </>
                  );
                  return openable ? (
                    <Link key={m.key} href={m.href!}
                      className={`${card} block !p-3 transition hover:border-[var(--cp-primary)]/40 hover:shadow-md`}>
                      {Inner}
                    </Link>
                  ) : (
                    <div key={m.key} className={`${card} !p-3 bg-slate-50/70`}>{Inner}</div>
                  );
                })}
              </div>

              {/* ── Continue setup ───────────────────────────────────────────────────────────────── */}
              {nextUp && (
                <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-[var(--cp-primary)]/20 bg-[var(--cp-primary)]/[0.05] p-3.5">
                  <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--cp-primary)]/12 text-[16px] text-[var(--cp-primary-deep)]">✧</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-bold text-gray-900">Complete your practice setup</p>
                    <p className="text-[11px] leading-relaxed text-gray-600">
                      Next: <span className="font-semibold">{nextUp.label}</span>
                      {nextUp.detail ? ` — ${nextUp.detail}.` : "."}
                    </p>
                  </div>
                  {nextUp.href && (
                    <Link href={nextUp.href}
                      className="rounded-lg bg-[var(--cp-primary)] px-4 py-2 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)]">
                      Continue setup →
                    </Link>
                  )}
                </div>
              )}
            </section>

            {/* ── Recent setup activity ─────────────────────────────────────────────────────────── */}
            <section className={card}>
              <div className="mb-3 flex items-center gap-2">
                <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-100 text-[12px] text-emerald-700">◷</span>
                <h2 className="text-[13px] font-bold text-gray-900">Recent setup activity</h2>
              </div>
              {s.recentActivity.length === 0 ? (
                <p className="text-[12px] text-gray-400">Nothing has been changed yet.</p>
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {s.recentActivity.map((a, i) => (
                    <li key={i} className="border-l-2 border-[var(--cp-primary)]/25 pl-2.5">
                      <p className="text-[12px] font-semibold capitalize text-gray-800">{a.label}</p>
                      <p className="text-[10px] text-gray-500">
                        {new Date(a.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-[10px] text-gray-400">
                From the practice&apos;s own audit trail — every configuration change is recorded.
              </p>
            </section>
          </div>

          {/* ── Right rail ──────────────────────────────────────────────────────────────────────── */}
          <div className="flex flex-col gap-4">
            <section className={card}>
              <h2 className="mb-3 text-[13px] font-bold text-gray-900">Setup progress</h2>
              <div className="flex items-center gap-3">
                <ProgressRing done={s.progress.done} of={s.progress.of} />
                <div className="min-w-0">
                  <p className="text-[13px] font-bold text-gray-900">
                    {s.progress.allDone
                      ? "Everything you can configure is configured."
                      : `${s.progress.of - s.progress.done} still to set up.`}
                  </p>
                  {/* THE COMP SAYS "76% complete". This says what the two numbers are. */}
                  <p className="text-[11px] leading-relaxed text-gray-500">
                    Counted from what is actually configured, out of the {s.progress.of} areas you can
                    change.
                  </p>
                </div>
              </div>

              <ul className="mt-3 space-y-1.5 border-t border-gray-100 pt-3">
                {s.legend.map(l => (
                  <li key={l.key} className="flex items-center gap-2 text-[12px]">
                    <span aria-hidden className={`h-2 w-2 rounded-full ${CHIP[l.key]?.dot ?? "bg-slate-300"}`} />
                    <span className="text-gray-700">{l.label}</span>
                    <span className="ml-auto font-bold text-gray-900">{l.count}</span>
                  </li>
                ))}
                <li className="flex items-center gap-2 border-t border-gray-100 pt-1.5 text-[12px]">
                  <span className="text-gray-500">All modules</span>
                  <span className="ml-auto font-bold text-gray-700">{s.progress.total}</span>
                </li>
              </ul>

              {/* The four counts above sum to this total, which the comp's own panel does not do. */}
              <p className="mt-3 border-t border-gray-100 pt-2 text-[10px] leading-relaxed text-gray-500">
                {s.notBuiltCount} of the {s.progress.total} have no implementation yet, so they are not
                counted above and cannot be completed.
              </p>
            </section>

            <section className={card}>
              <h2 className="mb-3 text-[13px] font-bold text-gray-900">Quick actions</h2>
              {s.quickActions.length === 0 ? (
                <p className="text-[12px] text-gray-400">No setup action is available to you.</p>
              ) : (
                <ul className="space-y-1.5">
                  {s.quickActions.map(a => (
                    <li key={a.key}>
                      <Link href={a.href}
                        className="flex items-center gap-2 rounded-lg border border-gray-200 px-2.5 py-2 text-[12px] font-semibold text-gray-700 hover:border-[var(--cp-primary)]/40 hover:bg-[var(--cp-primary)]/5 hover:text-[var(--cp-primary-deep)]">
                        {a.label}
                        <span aria-hidden className="ml-auto text-gray-300">›</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* ── Where the specification and this codebase disagree ────────────────────────────── */}
            {s.specDisagreements.length > 0 && (
              <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
                <h2 className="text-[13px] font-bold text-amber-900">Already built</h2>
                <p className="mt-1 text-[11px] leading-relaxed text-amber-800">
                  The setup framework lists {s.specDisagreements.length}{" "}
                  {s.specDisagreements.length === 1 ? "area" : "areas"} as still to be built that already
                  work here:
                </p>
                <ul className="mt-1.5 flex flex-wrap gap-1.5">
                  {s.specDisagreements.map(d => (
                    <li key={d.n} className="rounded bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">
                      {d.n}. {d.title}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[10px] leading-relaxed text-amber-700/80">
                  Status on this page is read from the code and your data, never copied from the
                  document — otherwise it would tell you these do not exist.
                </p>
              </section>
            )}

            <section className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
              <h2 className="text-[13px] font-bold text-emerald-900">Setup tips</h2>
              <p className="mt-1 text-[12px] leading-relaxed text-emerald-800">
                Take time over each area. Everything here can be changed later as your practice evolves,
                and every change is recorded in the activity trail.
              </p>
            </section>
          </div>
        </div>

        <p className="text-[11px] text-gray-500">
          Changes made here affect how your practice works across the whole product.
        </p>
      </div>
    </div>
  );
}
