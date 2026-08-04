import { redirect } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { practiceSetup } from "@/lib/practice/setup";

// CPR-SET-000 v4.1 PRACTICE SETUP OVERVIEW.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// LAID OUT TO THE COMP: welcome banner · fourteen module cards in the specification's order and the
// comp's colours · progress ring and checklist · quick actions · recent setup activity.
//
// TWO THINGS ON THIS SCREEN ARE DIFFERENT FROM THE DESIGN, AND BOTH ARE ON THE SCREEN ITSELF.
//
// 1. THE RING IS A COUNT, NOT A PERCENTAGE. The comp reads "85% — Your practice is almost ready!".
//    A setup dashboard is the one place a wrong completion figure does direct harm: somebody reads 85%,
//    concludes they are nearly done, and opens their doors with no way for patients to reach them. So
//    the figure is "9 of 11", every line of it read from the database, and the ring is drawn from those
//    two numbers.
//
// 2. FOUR CARDS LEAD NOWHERE, AND SAY SO. Booking Rules, Self-Booking, Workflow Templates and
//    Integrations have no implementation. They are drawn in their designed position and colour, marked
//    not built, not clickable, and excluded from the denominator -- a hub whose entire job is to say
//    what is left to do must not imply that four of its fourteen entries are merely unfinished.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

const card = "rounded-xl border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

const STATE_CHIP: Record<string, { text: string; className: string }> = {
  ready: { text: "Set up", className: "bg-emerald-100 text-emerald-700" },
  incomplete: { text: "Not done", className: "bg-amber-100 text-amber-700" },
  not_built: { text: "Not built", className: "bg-slate-100 text-slate-500" },
  hidden: { text: "No access", className: "bg-slate-100 text-slate-400" },
};

/** The progress ring: an arc drawn from done/of, with the fraction written inside it. */
function ProgressRing({ done, of }: { done: number; of: number }) {
  const r = 30, c = 2 * Math.PI * r;
  const fraction = of === 0 ? 0 : done / of;
  return (
    <svg viewBox="0 0 76 76" className="h-[76px] w-[76px] shrink-0" role="img"
      aria-label={`${done} of ${of} setup items done`}>
      <circle cx="38" cy="38" r={r} fill="none" stroke="var(--cp-slate-100)" strokeWidth="7" />
      <circle cx="38" cy="38" r={r} fill="none" stroke="var(--cp-success)" strokeWidth="7"
        strokeLinecap="round" strokeDasharray={`${c * fraction} ${c}`}
        transform="rotate(-90 38 38)" />
      {/* THE FRACTION, NOT A PERCENTAGE. "9/11" cannot be mistaken for a score. */}
      <text x="38" y="36" textAnchor="middle" className="fill-gray-900 text-[17px] font-bold">{done}</text>
      <text x="38" y="50" textAnchor="middle" className="fill-gray-400 text-[11px] font-semibold">of {of}</text>
    </svg>
  );
}

export default async function PracticeSetupOverview() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  const { ctx } = shell;

  const admin = createAdminClient();
  const s = await practiceSetup(admin, ctx);

  return (
    <div className="-m-5 min-h-full bg-[var(--cp-canvas)] p-5">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4">

        {/* ── Title ─────────────────────────────────────────────────────────────────────────────── */}
        <div>
          <h1 className="text-xl font-bold text-gray-900">Practice Setup Overview</h1>
          <p className="text-[13px] text-gray-500">
            Configure how your practice operates and how patients book and connect with you.
          </p>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px] items-start">
          <div className="flex flex-col gap-4">

            {/* ── Welcome banner ────────────────────────────────────────────────────────────────── */}
            <section className="flex flex-wrap items-center gap-4 rounded-xl border border-[var(--cp-primary)]/15 bg-gradient-to-r from-[var(--cp-primary)]/[0.08] via-[var(--cp-primary)]/[0.03] to-white p-5">
              <span aria-hidden className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[var(--cp-primary)]/12 text-[26px] text-[var(--cp-primary-deep)]">
                ⚙
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-[17px] font-bold text-gray-900">Welcome to Practice Setup</h2>
                <p className="mt-0.5 text-[13px] leading-relaxed text-gray-600">
                  Configure your practice so patients can book the right appointments, at the right time,
                  in the right place.
                </p>
              </div>
              {/* The comp's "Setup guide" button opens documentation that does not exist. It points at
                  the checklist instead, which is the same job done by something real. */}
              <Link href="#setup-checklist"
                className="rounded-lg bg-[var(--cp-primary)] px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-[var(--cp-primary-deep)]">
                What is left to do
              </Link>
            </section>

            {/* ── The fourteen ──────────────────────────────────────────────────────────────────── */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {s.modules.map(m => {
                const chip = STATE_CHIP[m.state];
                const openable = !!m.href;
                const Inner = (
                  <>
                    <div className="flex items-start gap-3">
                      <span aria-hidden
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[18px]"
                        style={{
                          background: m.state === "not_built" || m.state === "hidden"
                            ? "var(--cp-slate-100)"
                            : `color-mix(in srgb, ${m.hue} 12%, white)`,
                          color: m.state === "not_built" || m.state === "hidden" ? "var(--cp-slate-300)" : m.hue,
                        }}>
                        {m.icon}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className={`text-[13px] font-bold ${openable ? "text-gray-900" : "text-gray-500"}`}>
                          {m.n}. {m.title}
                        </p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">{m.description}</p>
                      </div>
                      {openable && <span aria-hidden className="mt-0.5 shrink-0 text-gray-300">›</span>}
                    </div>

                    <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2">
                      <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${chip.className}`}>
                        {chip.text}
                      </span>
                      {m.detail && <span className="text-[10px] text-gray-500">{m.detail}</span>}
                    </div>

                    {/* WHY IT CANNOT BE OPENED, in the card. A greyed tile with no explanation reads as
                        a bug; one that says what is missing reads as a decision. */}
                    {m.unavailableReason && (
                      <p className="mt-1.5 text-[10px] leading-relaxed text-gray-400">{m.unavailableReason}</p>
                    )}
                  </>
                );

                return openable ? (
                  <Link key={m.key} href={m.href!}
                    className={`${card} block transition hover:border-[var(--cp-primary)]/40 hover:shadow-md`}>
                    {Inner}
                  </Link>
                ) : (
                  <div key={m.key} className={`${card} bg-slate-50/60`}>{Inner}</div>
                );
              })}
            </div>

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
                    <li key={i} className="border-l-2 border-[var(--cp-primary)]/20 pl-2.5">
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
            <section className={card} id="setup-checklist">
              <h2 className="mb-3 text-[13px] font-bold text-gray-900">Practice setup progress</h2>
              <div className="flex items-center gap-3">
                <ProgressRing done={s.progress.done} of={s.progress.of} />
                <div className="min-w-0">
                  <p className="text-[13px] font-bold text-gray-900">
                    {s.progress.allDone ? "Everything on this list is done."
                      : `${s.progress.of - s.progress.done} still to do.`}
                  </p>
                  <p className="text-[11px] leading-relaxed text-gray-500">
                    {/* THE COMP SAYS "Your practice is almost ready!". This says what is counted. */}
                    Counted from what is actually configured, not from how many screens you have opened.
                  </p>
                </div>
              </div>

              <ul className="mt-3 space-y-1.5 border-t border-gray-100 pt-3">
                {s.checklist.map(i => (
                  <li key={i.key}>
                    <Link href={i.href ?? "#"} className="flex items-start gap-2 hover:underline">
                      <span aria-hidden className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${
                        i.done ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                        {i.done ? "✓" : "!"}
                      </span>
                      <span className="min-w-0">
                        <span className={`block text-[12px] ${i.done ? "text-gray-700" : "font-semibold text-amber-800"}`}>
                          {i.label}
                        </span>
                        {i.detail && <span className="block text-[10px] text-gray-400">{i.detail}</span>}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>

              {/* THE FOUR THE COUNT CANNOT INCLUDE. Silently dropping them would let a practice believe
                  it had finished configuring something this product cannot yet do at all. */}
              <p className="mt-3 border-t border-gray-100 pt-2 text-[10px] leading-relaxed text-gray-500">
                {s.notBuiltCount} of the fourteen areas are not built yet, so they are not counted above and
                cannot be completed: booking rules, self-booking, workflow templates and integrations.
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
                        <span aria-hidden className="text-[var(--cp-primary)]">›</span>
                        {a.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* The comp's "AI Setup Assistant". The recommendations it offers are the checklist above --
                arithmetic over configuration, not a model, and labelled accordingly. */}
            <section className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
              <h2 className="text-[13px] font-bold text-emerald-900">What to do next</h2>
              {s.progress.allDone ? (
                <p className="mt-1 text-[12px] leading-relaxed text-emerald-800">
                  Everything countable here is configured.
                </p>
              ) : (
                <p className="mt-1 text-[12px] leading-relaxed text-emerald-800">
                  Start with{" "}
                  <span className="font-semibold">
                    {s.checklist.find(i => !i.done)?.label.toLowerCase()}
                  </span>
                  {" "}— it is the first thing on the list above that is not done.
                </p>
              )}
              <p className="mt-2 text-[10px] leading-relaxed text-emerald-700/80">
                The design labels this an AI assistant. It is the checklist read in order; no model is
                involved and none is needed.
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
