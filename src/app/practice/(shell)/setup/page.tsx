import { redirect } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { practiceSetup } from "@/lib/practice/setup";
import {
  SETUP_DOMAIN_SWATCH, DOMAIN_STATE_CHIP, MODULE_STATE_CHIP, READINESS_SWATCH,
} from "@/lib/practice/practice-session-constants";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-V5-008 PRACTICE SETUP WORKSPACE -- the three-domain landing page.
//
// s6: "Display three domain cards, progress by domain, readiness indicators, contextual quick actions,
// and validation warnings INSTEAD OF A FLAT GRID."
//
// ---- THE RING SAYS TWO NUMBERS, NOT A PERCENTAGE ---------------------------------------------------
//
// The comp draws "72%" in the middle of the ring and "12 of 17 areas configured" beside it. The arc IS
// the fraction, so it is drawn from done/of -- but the LABEL is the two numbers, because a percentage is
// a figure with its denominator thrown away and the denominator is the entire content of this panel.
// The same call the previous version of this page made, and CPR-SETUP-001's harness still asserts it.
//
// ---- COLOUR IS DOING WORK HERE, AND IT IS NOT DECORATION -------------------------------------------
//
// Each domain gets a tinted card, a tinted icon badge, AND ITS FIGURE IN ITS OWN HUE. palette.ts records
// the same note four times because four screens shipped grey; the last one came back with "the colors
// are flat". Three domain cards read at identical weight have to be READ top to bottom; three coloured
// ones are FOUND. The hues are palette.ts's own, for the meanings palette.ts already gives them.
//
// ---- WHAT IS NOT A BUTTON --------------------------------------------------------------------------
//
// The comp's header carries "Preview booking page ↗". THERE IS STILL NO BOOKING PAGE -- CPR-V5-007 makes
// it Phase 4 and only part of it exists -- so it is rendered as a statement of what is missing and which
// phase owns it, not as a control. A button that does nothing is the one failure this codebase refuses
// hardest, and it is worse in the header than anywhere else because that is where people look first.
//
// ⚠ WHAT DID BECOME A CONTROL, AND WHY IT IS A DIFFERENT ONE. Claiming a booking ADDRESS (PIS-000 s3)
// is built: provisioning issues the identity row and the practitioner chooses the handle themselves at
// /practice/setup/identity. So there is a real link beside the disabled chip, labelled for the address
// rather than for the page -- because an address is not a page, and one control doing duty for both
// would be the same overclaim in the other direction.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

const card = "rounded-xl border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

const WARNING_TONE: Record<string, { box: string; text: string; icon: string }> = {
  blocker: { box: "border-rose-300 bg-rose-50", text: "text-rose-900", icon: "!" },
  warning: { box: "border-amber-200 bg-amber-50/70", text: "text-amber-900", icon: "⚑" },
  advisory: { box: "border-sky-200 bg-sky-50/60", text: "text-sky-900", icon: "◔" },
};

/** The arc is the fraction; the words are the counts. */
function ProgressRing({ done, of, hue }: { done: number; of: number; hue: string }) {
  const r = 34, c = 2 * Math.PI * r;
  const fraction = of === 0 ? 0 : done / of;
  return (
    <svg viewBox="0 0 84 84" className="h-[84px] w-[84px] shrink-0" role="img"
      aria-label={`${done} of ${of} configurable areas are set up`}>
      <circle cx="42" cy="42" r={r} fill="none" stroke="var(--cp-slate-100)" strokeWidth="8" />
      <circle cx="42" cy="42" r={r} fill="none" stroke={hue} strokeWidth="8"
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
  const byKey = new Map(s.modules.map(m => [m.key, m]));
  const nextUp = s.checklist.find(i => !i.done && !i.unreadable);
  const bookingAddress = s.availability.parts.find(p => p.key === "booking_address") ?? null;

  return (
    <div className="-m-5 min-h-full bg-[var(--cp-canvas)] p-5">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4">

        {/* ── Header ────────────────────────────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-start gap-3">
          <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--cp-primary)]/12 text-[20px] text-[var(--cp-primary-deep)]">
            ⚙
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Practice Setup</p>
            <h1 className="text-2xl font-bold text-gray-900">Practice Setup</h1>
            <p className="text-[13px] leading-relaxed text-gray-500">
              Configure and manage all aspects of your practice. Follow the setup path or jump to any area.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/practice/documentation"
              className="rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
              Setup guide
            </Link>
            <Link href="/practice/privacy"
              className="rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
              Export setup
            </Link>
            {/* ⚠ A CONTROL NOW, BECAUSE THERE IS SOMETHING BEHIND IT -- AND IT STILL DOES NOT CLAIM A
                BOOKING PAGE. Claiming an address is built; the page is not. The label says which of the
                two this opens, and the chip beside it says whether the address exists. */}
            <Link href="/practice/setup/identity"
              className="rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-[12px] font-semibold text-gray-700 hover:border-[var(--cp-primary)]/40 hover:bg-[var(--cp-primary)]/5 hover:text-[var(--cp-primary-deep)]">
              {bookingAddress?.done === true
                ? `Your booking address · ${bookingAddress.detail}`
                : bookingAddress?.done === null
                  ? "Your booking address · could not be read"
                  : "Claim your booking address"}
            </Link>
            {/* NOT A BUTTON. There is still no booking page to preview -- an address is not a page. */}
            <span className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3.5 py-2 text-[12px] font-semibold text-slate-500"
              title="CPR-V5-007 Phase 4 — the public booking page, OTP verification and the publish state. Not started.">
              No booking page to preview
            </span>
          </div>
        </div>

        {/* ── s2's grouping banner ──────────────────────────────────────────────────────────────── */}
        <section className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--cp-primary)]/20 bg-[var(--cp-primary)]/[0.05] p-4">
          <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--cp-primary)]/12 text-[18px] text-[var(--cp-primary-deep)]">✧</span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-bold text-gray-900">Your practice setup, grouped by what it is for</p>
            <p className="text-[11px] leading-relaxed text-gray-600">
              Three domains instead of a flat list of seventeen. Nothing here has to be done in order —
              the dependencies that do matter are named where they bite.
            </p>
          </div>
          <span className="rounded-lg bg-white px-3 py-1.5 text-[11px] font-semibold text-[var(--cp-primary-deep)] ring-1 ring-[var(--cp-primary)]/20">
            {s.progress.done} of {s.progress.of} areas configured
          </span>
        </section>

        {/* ── Validation warnings (s6) ──────────────────────────────────────────────────────────── */}
        {s.warnings.length > 0 && (
          <ul className="grid gap-2 lg:grid-cols-2">
            {s.warnings.map(w => {
              const tone = WARNING_TONE[w.severity] ?? WARNING_TONE.advisory;
              return (
                <li key={w.key} className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 ${tone.box}`}>
                  <span aria-hidden className={`mt-px text-[13px] font-bold ${tone.text}`}>{tone.icon}</span>
                  <p className={`min-w-0 flex-1 text-[12px] leading-relaxed ${tone.text}`}>{w.text}</p>
                  {w.href && (
                    <Link href={w.href} className={`shrink-0 text-[11px] font-bold underline ${tone.text}`}>Fix</Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_330px] items-start">
          <div className="flex flex-col gap-4">

            {/* ── THE THREE DOMAINS ─────────────────────────────────────────────────────────────── */}
            {s.domains.map(d => {
              const sw = SETUP_DOMAIN_SWATCH[d.key];
              const chip = DOMAIN_STATE_CHIP[d.state] ?? DOMAIN_STATE_CHIP.not_started;
              const cards = d.cardKeys.map(k => byKey.get(k)!).filter(Boolean);
              return (
                <section key={d.key} className={`overflow-hidden rounded-xl border border-gray-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]`}>
                  <div className="grid gap-0 md:grid-cols-[230px_minmax(0,1fr)]">

                    {/* The domain's own panel: tinted box, tinted badge, AND THE FIGURE IN ITS HUE. */}
                    <div className={`relative border-b p-4 md:border-b-0 md:border-r ${sw.box}`}>
                      <span aria-hidden className={`absolute inset-y-0 left-0 w-[3px] ${sw.accent}`} />
                      <span aria-hidden className={`flex h-11 w-11 items-center justify-center rounded-xl text-[19px] ${sw.badge}`}>
                        {sw.icon}
                      </span>
                      <p className="mt-2.5 text-[14px] font-bold text-gray-900">{d.n}. {d.title}</p>
                      <p className={`mt-1 text-[11px] leading-relaxed ${sw.caption}`}>{d.purpose}</p>

                      <p className="mt-3 flex items-baseline gap-1.5">
                        <span className={`text-[26px] font-bold leading-none ${sw.figure}`}>{d.progress.done}</span>
                        <span className="text-[12px] font-semibold text-gray-500">of {d.progress.of} configured</span>
                      </p>
                      {/* The bar is the fraction. The words above it are the counts. */}
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/70">
                        <div className={`h-full rounded-full ${sw.accent}`}
                          style={{ width: `${d.progress.of === 0 ? 0 : (d.progress.done / d.progress.of) * 100}%` }} />
                      </div>

                      <span className={`mt-3 inline-block rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${chip.chip}`}>
                        {chip.label}
                      </span>
                      {d.notBuilt > 0 && (
                        <p className="mt-2 text-[10px] leading-relaxed text-gray-500">
                          {d.notBuilt} area{d.notBuilt === 1 ? "" : "s"} here {d.notBuilt === 1 ? "has" : "have"} no
                          implementation yet and {d.notBuilt === 1 ? "is" : "are"} not counted above.
                        </p>
                      )}
                      <ul className="mt-2 flex flex-wrap gap-1">
                        {d.outputs.map(o => (
                          <li key={o} className="rounded bg-white/70 px-1.5 py-0.5 text-[9px] font-semibold text-gray-600">{o}</li>
                        ))}
                      </ul>
                    </div>

                    {/* The domain's modules. */}
                    <div className="grid gap-2.5 p-4 sm:grid-cols-2 xl:grid-cols-4">
                      {cards.map(m => {
                        const mc = MODULE_STATE_CHIP[m.state] ?? MODULE_STATE_CHIP.needs_attention;
                        const openable = !!m.href;
                        const muted = m.state === "not_built" || m.state === "no_access" || m.state === "unreadable";
                        const parts = m.key === "availability" ? s.availability : null;
                        const Inner = (
                          <>
                            <div className="flex items-start justify-between gap-2">
                              <span aria-hidden
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[16px]"
                                style={{
                                  background: muted ? "var(--cp-slate-100)" : `color-mix(in srgb, ${m.hue} 12%, white)`,
                                  color: muted ? "var(--cp-slate-400)" : m.hue,
                                }}>
                                {m.icon}
                              </span>
                              <span aria-hidden className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold ${mc.chip}`}
                                title={mc.label}>
                                {mc.mark}
                              </span>
                            </div>
                            <p className={`mt-2 text-[12px] font-bold leading-snug ${muted ? "text-gray-500" : "text-gray-900"}`}>
                              {m.title}
                            </p>
                            <p className="mt-1 text-[10.5px] leading-relaxed text-gray-500">{m.description}</p>

                            {/* The primary operations module carries its own parts, as the comp draws it. */}
                            {parts && (
                              <>
                                <p className="mt-2 text-[10px] font-semibold" style={{ color: muted ? undefined : m.hue }}>
                                  {parts.progress.done} of {parts.progress.of} parts configured
                                </p>
                                <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-100">
                                  <div className="h-full rounded-full"
                                    style={{
                                      background: m.hue,
                                      width: `${parts.progress.of === 0 ? 0 : (parts.progress.done / parts.progress.of) * 100}%`,
                                    }} />
                                </div>
                                <ul className="mt-1.5 space-y-0.5">
                                  {parts.parts.map(p => (
                                    <li key={p.key} className="flex items-start gap-1 text-[9.5px] leading-tight">
                                      <span aria-hidden className={
                                        p.notBuilt ? "text-slate-300"
                                          : p.done === null ? "text-slate-400"
                                            : p.done ? "text-emerald-600" : "text-amber-500"}>
                                        {p.notBuilt ? "–" : p.done === null ? "?" : p.done ? "✓" : "○"}
                                      </span>
                                      <span className={p.notBuilt ? "text-slate-400" : "text-gray-600"}>
                                        {p.label}
                                        <span className="text-gray-400"> · {p.detail}</span>
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              </>
                            )}

                            {!parts && m.detail && (
                              <p className="mt-2 text-[10px] font-semibold text-gray-600">{m.detail}</p>
                            )}
                            {m.unavailableReason && (
                              <p className="mt-1.5 text-[9.5px] leading-relaxed text-gray-400">{m.unavailableReason}</p>
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
                  </div>
                </section>
              );
            })}

            {/* ── s8's dependency rules, evaluated ──────────────────────────────────────────────── */}
            <section className={card}>
              <div className="mb-2.5 flex items-center gap-2">
                <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-md bg-violet-100 text-[12px] text-violet-700">⚯</span>
                <h2 className="text-[13px] font-bold text-gray-900">What depends on what</h2>
              </div>
              <ul className="space-y-2">
                {s.dependencies.map(dep => (
                  <li key={dep.key} className="flex items-start gap-2.5 rounded-lg border border-gray-200 px-3 py-2">
                    <span aria-hidden className={`mt-px text-[12px] font-bold ${
                      dep.indeterminate ? "text-slate-400"
                        : dep.unmet.length === 0 ? "text-emerald-600" : "text-amber-600"}`}>
                      {dep.indeterminate ? "?" : dep.unmet.length === 0 ? "✓" : "○"}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold text-gray-800">{dep.statement}</p>
                      <p className="text-[11px] leading-relaxed text-gray-500">
                        {dep.indeterminate
                          ? "Part of this could not be read, so whether it is met is unknown."
                          : dep.unmet.length === 0
                            ? "Met."
                            : `Still needs ${dep.unmet.join(", ")}.`}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            {/* ── Recent setup activity ─────────────────────────────────────────────────────────── */}
            <section className={card}>
              <div className="mb-3 flex items-center gap-2">
                <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-100 text-[12px] text-emerald-700">◷</span>
                <h2 className="text-[13px] font-bold text-gray-900">Recent setup activity</h2>
                <Link href="/practice/privacy" className="ml-auto text-[11px] font-semibold text-[var(--cp-primary)] hover:underline">
                  View activity log →
                </Link>
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
                From the practice&apos;s own audit trail — every configuration change is recorded, and
                changes here save as you make them.
              </p>
            </section>
          </div>

          {/* ── Right rail ──────────────────────────────────────────────────────────────────────── */}
          <div className="flex flex-col gap-4">
            <section className={card}>
              <h2 className="mb-3 text-[13px] font-bold text-gray-900">Setup progress</h2>
              <div className="flex items-center gap-3">
                <ProgressRing done={s.progress.done} of={s.progress.of} hue="var(--cp-success)" />
                <div className="min-w-0">
                  <p className="text-[13px] font-bold text-gray-900">
                    {s.progress.allDone
                      ? "Everything you can configure is configured."
                      : `${s.progress.of - s.progress.done} still to set up.`}
                  </p>
                  {/* THE COMP SAYS "72%". This says what the two numbers are. */}
                  <p className="text-[11px] leading-relaxed text-gray-500">
                    {s.progress.done} of {s.progress.of} areas configured, out of {s.progress.total} in all.
                  </p>
                </div>
              </div>

              <ul className="mt-3 space-y-1.5 border-t border-gray-100 pt-3">
                {s.legend.map(l => (
                  <li key={l.key} className="flex items-center gap-2 text-[12px]">
                    <span aria-hidden className={`h-2 w-2 rounded-full ${MODULE_STATE_CHIP[l.key]?.dot ?? "bg-slate-300"}`} />
                    <span className="text-gray-700">{l.label}</span>
                    <span className="ml-auto font-bold text-gray-900">{l.count}</span>
                  </li>
                ))}
                <li className="flex items-center gap-2 border-t border-gray-100 pt-1.5 text-[12px]">
                  <span className="text-gray-500">All areas</span>
                  <span className="ml-auto font-bold text-gray-700">{s.progress.total}</span>
                </li>
              </ul>

              <p className="mt-3 border-t border-gray-100 pt-2 text-[10px] leading-relaxed text-gray-500">
                {s.notBuiltCount} of the {s.progress.total} have no implementation yet, so they are not
                counted above and cannot be completed.
                {s.unreadableCount > 0 && ` ${s.unreadableCount} could not be read just now and are counted as neither done nor undone.`}
              </p>
            </section>

            {/* ── s2's contextual quick actions ─────────────────────────────────────────────────── */}
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
              <p className="mt-2 text-[10px] leading-relaxed text-gray-400">
                These change with your practice — each one is offered because of what is or is not there
                right now.
              </p>
            </section>

            {/* ── s7's readiness indicators ─────────────────────────────────────────────────────── */}
            <section className={card}>
              <h2 className="mb-3 text-[13px] font-bold text-gray-900">Readiness</h2>
              <ul className="space-y-2">
                {s.readiness.map(r => {
                  const sw = r.indeterminate ? READINESS_SWATCH.unreadable
                    : r.met ? READINESS_SWATCH.met : READINESS_SWATCH.unmet;
                  return (
                    <li key={r.key} className="flex items-start gap-2">
                      <span aria-hidden className={`mt-px text-[13px] font-bold ${sw.ring}`}>{sw.mark}</span>
                      <div className="min-w-0">
                        <p className={`text-[12px] font-semibold ${sw.label}`}>{r.label}</p>
                        <p className="text-[10.5px] leading-relaxed text-gray-500">{r.detail}</p>
                        {/* NOT AN EMPTY CIRCLE WITH NO EXPLANATION. An indicator nobody can satisfy by
                            configuring anything says so, and names the phase that owns it. */}
                        {r.blockedReason && (
                          <p className="mt-0.5 text-[10px] leading-relaxed text-slate-400">{r.blockedReason}</p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
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

            {nextUp && (
              <section className="rounded-xl border border-[var(--cp-primary)]/20 bg-[var(--cp-primary)]/[0.05] p-4">
                <p className="text-[13px] font-bold text-gray-900">Next up</p>
                <p className="mt-1 text-[11px] leading-relaxed text-gray-600">
                  <span className="font-semibold">{nextUp.label}</span>
                  {nextUp.detail ? ` — ${nextUp.detail}.` : "."}
                </p>
                {nextUp.href && (
                  <Link href={nextUp.href}
                    className="mt-2.5 inline-block rounded-lg bg-[var(--cp-primary)] px-4 py-2 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)]">
                    Continue setup →
                  </Link>
                )}
              </section>
            )}
          </div>
        </div>

        <p className="text-[11px] text-gray-500">
          Changes made here affect how your practice works across the whole product.
        </p>
      </div>
    </div>
  );
}
