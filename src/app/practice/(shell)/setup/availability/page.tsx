import { redirect } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { availabilityConfig, bookingPreview } from "@/lib/practice/availability-config";
import { formatDayTime, formatTime, formatMinuteOfDay } from "@/lib/datetime";
import AvailabilityConsole from "./AvailabilityConsole";
import ExpandableCard from "./ExpandableCard";
import WeekBoard from "./WeekBoard";
import StepNav, { type Step } from "./StepNav";
import PatientPreview, { type PreviewDay } from "./PatientPreview";

// CPR-SCH-002 v4 — Availability & Scheduling, redesigned as a guided workflow.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE SPECIFICATION'S FIVE STEPS, its weekly board, and its persistent patient preview:
//   1 My Locations · 2 Weekly Schedule · 3 Schedule Changes · 4 Patient Booking · 5 Preview
//
// "Use practitioner language instead of technical scheduling terms" changed the most here. Templates
// became working days, slot kinds went away, generation is now something that happens rather than a
// button to press. The engine still calls a session a template, because that is what it is to a
// generator; nobody configuring a Tuesday needs to know that.
//
// ---- TWO PLACES THIS DIFFERS FROM THE DESIGN, BOTH SAID ON THE SCREEN -------------------------------
//
// STEP 5 IS "PREVIEW", NOT "PREVIEW & PUBLISH". There is no patient-facing booking page, so publishing
// is not something this build can do -- and a five-step wizard whose last step can never complete is
// one people stop trusting. The same call the setup hub made about its unbuilt modules.
//
// THE FOOTER DOES NOT SAY "SAVE DRAFT". Every action here writes immediately and rebuilds the bookable
// slots before it returns; there IS no draft. A Save button implying unsaved work would invite somebody
// to close the tab believing they had lost something -- or, worse, believing they had kept it.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

const card = "rounded-xl border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

const EXC_HUE: Record<string, string> = {
  leave: "var(--cp-warning)", closure: "var(--cp-slate-500)",
  extra_session: "var(--cp-success)", extended_hours: "var(--cp-accent)",
};

export default async function AvailabilityConfigPage({ searchParams }: {
  searchParams: Promise<{ step?: string }>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  const { ctx } = shell;
  if (!hasCapability(ctx, "appointment.manage")) redirect("/practice/setup");

  const admin = createAdminClient();
  const cfg = await availabilityConfig(admin, ctx);

  const { step } = await searchParams;
  const activeStep = Number(step) >= 1 && Number(step) <= 5 ? Number(step) : 2;

  const fortnightEnd = new Date(Date.parse(`${cfg.today}T12:00:00Z`) + 13 * 86400000).toISOString().slice(0, 10);
  const preview = await bookingPreview(admin, ctx, { fromDate: cfg.today, toDate: fortnightEnd });

  const activeLocations = cfg.locations.filter((l: any) => l.active);
  const liveSessions = cfg.templates.filter((t: any) => t.status !== "suspended");
  const locName = new Map(cfg.locations.map((l: any) => [l.id, l.name]));

  // ── THE PATIENT VIEW, BY WEEKDAY ────────────────────────────────────────────────────────────────
  //
  // Built from the live sessions rather than from generated slots: a patient looking at a booking page
  // sees a weekly PATTERN, and slots only exist for the window that has been generated. A day whose
  // only session is suspended is unavailable, which is the whole difference suspend exists to make.
  const previewDays: PreviewDay[] = [1, 2, 3, 4, 5, 6, 7].map(weekday => {
    const onDay = liveSessions
      .filter((t: any) => t.weekday === weekday)
      .sort((a: any, b: any) => a.starts_minute - b.starts_minute);
    const first = onDay[0];
    return {
      weekday,
      locationName: first?.location_id ? locName.get(first.location_id) ?? null : null,
      from: first?.starts_minute ?? null,
      to: first?.ends_minute ?? null,
      otherSessions: Math.max(0, onDay.length - 1),
      unavailable: onDay.length === 0,
    };
  });

  // NEXT AVAILABLE comes from real slots and real booking rules, never from the pattern above. The
  // pattern says Tuesday; whether next Tuesday is free depends on who is already booked and what notice
  // the rules demand -- which is exactly what bookingPreview computes.
  const nextEntry = preview.days
    .flatMap((d: any) => d.entries)
    .filter((e: any) => e.offerable)
    .sort((a: any, b: any) => Date.parse(a.from) - Date.parse(b.from))[0] ?? null;
  const nextAvailable = nextEntry
    ? {
      whenIso: nextEntry.from as string,
      label: formatDayTime(nextEntry.from, preview.timezone),
      locationName: (nextEntry.locationName ?? null) as string | null,
    }
    : null;
  const offerableCount = preview.days.reduce((n: number, d: any) => n + d.offerable, 0);

  // ── THE FIVE STEPS, with real completion ────────────────────────────────────────────────────────
  const steps: Step[] = [
    {
      n: 1, title: "My locations", purpose: "Where you work", href: "/practice/setup/availability?step=1",
      done: activeLocations.length > 0,
      detail: activeLocations.length > 0 ? `${activeLocations.length} open` : "add a hospital or clinic",
    },
    {
      n: 2, title: "Weekly schedule", purpose: "Your regular week", href: "/practice/setup/availability?step=2",
      done: liveSessions.length > 0,
      detail: liveSessions.length > 0
        ? `${liveSessions.length} session${liveSessions.length === 1 ? "" : "s"}` : "no working days yet",
    },
    {
      // NO TICK, EVER. Leave and extra clinics are optional; an empty circle for ever would nag about
      // something nobody has failed to do.
      n: 3, title: "Schedule changes", purpose: "Holidays, leave, extras", href: "/practice/setup/availability?step=3",
      done: null,
      detail: cfg.exceptions.length > 0 ? `${cfg.exceptions.length} upcoming` : "none — optional",
    },
    {
      n: 4, title: "Patient booking", purpose: "Rules and preferences", href: "/practice/setup/availability?step=4",
      done: cfg.rules.length > 0,
      detail: cfg.rules.length > 0
        ? `${cfg.rules.length} rule${cfg.rules.length === 1 ? "" : "s"}` : "no notice or limits set",
    },
    {
      // NOT "Preview & Publish". Publishing needs a patient-facing page this build does not have.
      n: 5, title: "Preview", purpose: "What would be offered", href: "/practice/setup/availability?step=5",
      done: null,
      detail: "nothing is published yet",
    },
  ];

  const totalHours = liveSessions.reduce(
    (n: number, t: any) => n + (t.ends_minute - t.starts_minute) / 60, 0);
  const workingDays = new Set(liveSessions.map((t: any) => t.weekday)).size;

  return (
    <div className="-m-5 min-h-full bg-[var(--cp-canvas)] p-5 pb-20">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4">

        {/* ── Header ────────────────────────────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-start gap-3">
          <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--cp-primary)]/12 text-[22px] text-[var(--cp-primary-deep)]">▤</span>
          <div className="min-w-0">
            <nav className="flex items-baseline gap-1.5 text-[12px]">
              <Link href="/practice/setup" className="font-semibold text-[var(--cp-primary)] hover:underline">
                Practice Setup
              </Link>
              <span className="text-gray-300">›</span>
              <span className="text-gray-500">Availability &amp; Scheduling</span>
            </nav>
            <h1 className="text-2xl font-bold text-gray-900">Availability &amp; Scheduling</h1>
            <p className="text-[13px] text-gray-500">
              Set when and where you see patients. All times are in {cfg.timezone}.
            </p>
          </div>
          <Link href="/practice/calendar"
            className="ml-auto rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-[13px] font-semibold text-gray-700 hover:bg-gray-50">
            Open my calendar →
          </Link>
        </div>

        <div className="grid items-start gap-4 xl:grid-cols-[250px_minmax(0,1fr)_290px]">
          <StepNav steps={steps} activeStep={activeStep} />

          <div className="flex min-w-0 flex-col gap-4">

            {/* 1. My locations */}
            <section className={card} id="step-1">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-100 text-[12px] text-emerald-700">◎</span>
                <h2 className="text-[13px] font-bold text-gray-900">My locations</h2>
                <span className="text-[11px] text-gray-500">{activeLocations.length} open</span>
                <Link href="/practice/settings" className="ml-auto text-[11px] font-semibold text-[var(--cp-primary)] hover:underline">
                  Add or close a location →
                </Link>
              </div>
              {activeLocations.length === 0 ? (
                <p className="text-[12px] text-amber-700">
                  No location yet. Add one first — a working day needs somewhere to be.
                </p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {activeLocations.map((l: any) => {
                    const clinics = cfg.clinics.filter((c: any) => c.location_id === l.id && c.active);
                    return (
                      <li key={l.id} className="rounded-lg border border-gray-200 px-3 py-2">
                        <p className="text-[13px] font-semibold text-gray-900">{l.name}</p>
                        <p className="text-[10px] text-gray-500">
                          {String(l.type).replace(/_/g, " ")}
                          {l.travel_buffer_minutes != null ? ` · ${l.travel_buffer_minutes} min to reach` : ""}
                        </p>
                        {clinics.length > 0 && (
                          <ul className="mt-1 flex flex-wrap gap-1">
                            {clinics.map((c: any) => (
                              <li key={c.id} className="rounded bg-[var(--cp-primary)]/8 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--cp-primary-deep)]">
                                {c.name}
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* 2. The weekly board */}
            <div id="step-2">
              <WeekBoard
                sessions={JSON.parse(JSON.stringify(cfg.templates))}
                locations={JSON.parse(JSON.stringify(activeLocations))}
                clinics={JSON.parse(JSON.stringify(cfg.clinics.filter((c: any) => c.active)))}
              />
            </div>

            {/* ── 3, 4 and 5 are COLLAPSED CARDS ────────────────────────────────────────────────
                "One clear task per section" only works if the other sections are out of the way. The
                first build stacked all five open and the weekly board — the primary interaction — ended
                up competing with three forms nobody had asked for yet. Each header carries what is
                already configured, so a collapsed card still answers its own question. */}
            <div id="step-3">
              <ExpandableCard
                icon="⚑" iconClass="bg-amber-100 text-amber-700"
                title="Schedule changes" blurb="Holidays, leave, conferences and extra clinics."
                summary={cfg.exceptions.length > 0 ? `${cfg.exceptions.length} upcoming` : null}
                actionLabel="Add change"
                defaultOpen={activeStep === 3}>
                {cfg.exceptions.length > 0 && (
                  <ul className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {cfg.exceptions.map((e: any) => (
                      <li key={e.id} className="rounded-lg border border-l-[3px] border-gray-200 px-3 py-2"
                        style={{ borderLeftColor: EXC_HUE[e.kind] ?? "var(--cp-slate-300)" }}>
                        <p className="text-[12px] font-semibold capitalize text-gray-800">
                          {String(e.kind).replace(/_/g, " ")}
                        </p>
                        <p className="text-[11px] text-gray-600">
                          {e.from_date === e.to_date ? e.from_date : `${e.from_date} → ${e.to_date}`}
                          {e.starts_minute != null
                            ? ` · ${formatMinuteOfDay(e.starts_minute)}–${formatMinuteOfDay(e.ends_minute)}`
                            : " · the whole day"}
                        </p>
                        <p className="text-[10px] text-gray-500">
                          {e.location_id ? locName.get(e.location_id) : "everywhere"}
                          {e.reason ? ` · ${e.reason}` : ""}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
                <AvailabilityConsole
                  locations={JSON.parse(JSON.stringify(activeLocations))}
                  rules={JSON.parse(JSON.stringify(cfg.rules))}
                  inert={JSON.parse(JSON.stringify(cfg.inert))}
                  today={cfg.today}
                  canSetRules={hasCapability(ctx, "practice.settings.manage")}
                  show="changes"
                />
              </ExpandableCard>
            </div>

            <div id="step-4">
              <ExpandableCard
                icon="⚌" iconClass="bg-[var(--cp-info)]/15 text-[var(--cp-info)]"
                title="Patient booking" blurb="Set how patients can book with you."
                summary={cfg.rules.length > 0
                  ? `${cfg.rules.length} rule${cfg.rules.length === 1 ? "" : "s"}` : null}
                actionLabel="Edit rules"
                defaultOpen={activeStep === 4}>
                <AvailabilityConsole
                  locations={JSON.parse(JSON.stringify(activeLocations))}
                  rules={JSON.parse(JSON.stringify(cfg.rules))}
                  inert={JSON.parse(JSON.stringify(cfg.inert))}
                  today={cfg.today}
                  canSetRules={hasCapability(ctx, "practice.settings.manage")}
                  show="booking"
                />
              </ExpandableCard>
            </div>

            {/* 5. Preview */}
            <section className={card} id="step-5">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-md bg-cyan-100 text-[12px] text-cyan-700">◉</span>
                <h2 className="text-[13px] font-bold text-gray-900">What would be offered</h2>
                <span className="text-[11px] text-gray-500">next fortnight</span>
              </div>
              {preview.days.length === 0 ? (
                <p className="text-[12px] text-gray-400">
                  Nothing bookable yet. Add a working day above and it appears here.
                </p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {preview.days.map((d: any) => (
                    <li key={d.date} className="rounded-lg border border-gray-200 px-3 py-2">
                      <p className="text-[12px] font-semibold text-gray-800">{d.date}</p>
                      <p className="text-[11px] text-gray-500">
                        <span className={d.offerable > 0 ? "font-bold text-emerald-700" : "text-gray-400"}>
                          {d.offerable}
                        </span>{" "}
                        of {d.total} offerable
                      </p>
                      <ul className="mt-1 space-y-0.5">
                        {d.entries.map((e: any) => (
                          <li key={e.slotId} className="text-[10px] leading-tight">
                            <span className={e.offerable ? "text-gray-700" : "text-gray-400"}>
                              {formatTime(e.from, preview.timezone)}
                              {e.locationName ? ` · ${e.locationName}` : ""}
                            </span>
                            {/* WHY it is not offerable, not merely that it is not. */}
                            {e.withheldBecause && (
                              <span className="block text-[9px] text-amber-700">{e.withheldBecause}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {/* ── Patient preview, persistent ─────────────────────────────────────────────────────── */}
          <div className="xl:sticky xl:top-4">
            <PatientPreview
              days={previewDays}
              nextAvailable={nextAvailable}
              timezone={cfg.timezone}
              practitionerName={ctx.workspaceName}
              offerableCount={offerableCount}
            />
          </div>
        </div>
      </div>

      {/* ── Sticky footer ─────────────────────────────────────────────────────────────────────────
          The comp has "Save draft" and "Save & Continue". This screen has NO DRAFT: every action writes
          immediately and rebuilds the bookable slots before it returns. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white/95 px-5 py-2.5 backdrop-blur md:left-60">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3">
          <span aria-hidden className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] ${
            liveSessions.length > 0 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
            {liveSessions.length > 0 ? "✓" : "!"}
          </span>
          <p className="text-[12px] text-gray-700">
            {liveSessions.length > 0 ? (
              <>
                Your week is set.{" "}
                <span className="font-semibold">{workingDays} working day{workingDays === 1 ? "" : "s"}</span>
                {" · "}
                <span className="font-semibold">
                  {(totalHours % 1 === 0 ? totalHours : Number(totalHours.toFixed(1)))} hours
                </span>
              </>
            ) : "No working days yet — add one above."}
          </p>
          <span className="text-[11px] text-gray-400">Changes are saved as you make them.</span>
          <Link href="/practice/calendar"
            className="ml-auto rounded-lg bg-[var(--cp-primary)] px-4 py-2 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)]">
            See it in the calendar →
          </Link>
        </div>
      </div>
    </div>
  );
}
