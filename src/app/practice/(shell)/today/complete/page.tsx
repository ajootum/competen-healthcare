import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { sessionSummary, sessionClinicalActivity } from "@/lib/practice/activity";
import { formatMinuteOfDay } from "@/lib/datetime";
import SessionLocation from "../../SessionLocation";

// SESSION COMPLETE -- CPR-HFE-001 v1.1 s6: the transition from live operations to closure.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// Ending a session lands HERE, not back on a page that quietly forgot the session existed. One look
// at what it amounted to, what it produced, what it left open -- then Return to Today or the formal
// Session Report. Every figure is sessionSummary's (the engine that sat unrendered since CPR-V5-004)
// plus sessionClinicalActivity's window counts; this page computes nothing.
//
// s6 METRIC SAFETY: duration and wait figures render only through their governed Metric shapes,
// which carry observations, exclusions and reasons -- an unreliable timestamp arrives as a reason,
// never as a number.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

const clock = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone });

export default async function SessionCompletePage({ searchParams }: {
  searchParams: Promise<{ activity?: string }>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "practice.home.view")) redirect("/practice/home");

  const sp = await searchParams;
  if (!sp.activity) redirect("/practice/today");
  const admin = createAdminClient();
  // ⚠ THE LOCATIONS READ IS ITS OWN, AND SMALL, AND NOT operationsHome. The home page gets them free
  // because that engine already runs there; this screen calls neither, and pulling in a whole
  // operations read to populate one picker would be a far larger cost than the four columns it needs.
  // Active only -- the picker offers where a practice works NOW, while setActivityLocation still
  // accepts an inactive one so a session at a closed site stays recordable.
  const [sum, clinical, locRows] = await Promise.all([
    sessionSummary(admin, shell.ctx, sp.activity),
    sessionClinicalActivity(admin, shell.ctx, sp.activity),
    admin.from("practice_location").select("id, name")
      .eq("workspace_id", shell.ctx.workspaceId).eq("active", true).order("name"),
  ]);
  // A failed read yields an empty list, which renders no control at all rather than an empty picker --
  // the same reading SessionLocation gives a practice that has configured no locations.
  const locations = ((locRows as any)?.data ?? []) as { id: string; name: string }[];
  const canPlan = hasCapability(shell.ctx, "appointment.manage");
  if (!sum.ok) {
    if (sum.status === 404) notFound();
    return (
      <div className="max-w-3xl">
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
          {sum.message}
        </p>
        <Link href="/practice/today" className="mt-3 inline-block text-[12px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
          &larr; Current Session
        </Link>
      </div>
    );
  }
  const s = sum.value;
  const { data: wsRow } = await admin.from("practice_workspace")
    .select("timezone").eq("id", shell.ctx.workspaceId).maybeSingle();
  const tz = wsRow?.timezone ?? "UTC";
  const m: any = s.metrics.metrics;
  const c = clinical.available ? clinical.data : null;
  const stillRunning = s.endedAtIso === null;

  return (
    <div className="max-w-3xl">
      {/* ── s6 HEADER ──────────────────────────────────────────────────────────────────────────── */}
      <header className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-700">
          {stillRunning ? "Session summary (still running)" : "Session Complete"}
        </p>
        <h1 className="mt-1 text-xl font-bold text-gray-900">{s.title || s.label}</h1>
        <p className="mt-0.5 text-[12.5px] text-gray-600">
          {s.planDate} &middot; planned {formatMinuteOfDay(s.plannedStartMinute)} – {formatMinuteOfDay(s.plannedEndMinute)}
          &middot; actually {clock(s.startedAtIso, tz)} – {s.endedAtIso ? clock(s.endedAtIso, tz) : "now"}
          {s.overrunMinutes !== null ? ` · ran ${s.overrunMinutes} min past its planned end` : ""}
        </p>
        <p className="mt-0.5 text-[11px] text-gray-500">
          {s.activeMinutes !== null
            ? `${s.activeMinutes} min active, ${s.pausedMinutes} min paused across ${s.pauseCount} pause${s.pauseCount === 1 ? "" : "s"}.`
            : "The pause ledger could not be read, so active time cannot be separated from paused time."}
        </p>

        {/* ── WHERE IT HAPPENED, AND THE LAST PLACE IT CAN BE PUT RIGHT ──────────────────────────
            This summary printed when, how long and how many, and never where -- on the screen a
            practitioner reaches at the moment a clinic ends, which is the last point anyone still
            remembers. startActivity now requires a location, so new sessions arrive with one; the
            sessions that need correcting are exactly the ones that predate that rule, and this is
            where somebody notices.

            The same control as the running card, imported rather than reimplemented (SessionLocation).
            An ended session is amendable by design -- setActivityLocation refuses only a cancelled
            one -- because correcting the past is the whole reason that engine exists. */}
        {/* The absent case is a SENTENCE, not silence: a session with no place recorded should say so
            where somebody can still act on it, rather than omitting the line and looking complete. */}
        <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-[12px] text-gray-600">
            {s.locationName
              ? <>Held at <span className="font-semibold text-gray-800">{s.locationName}</span></>
              : <span className="text-gray-500">No location was recorded for this session.</span>}
          </span>
          <SessionLocation activityId={s.activityId} locationId={s.locationId}
            locationName={s.locationName} locations={locations} canEdit={canPlan} />
        </div>
      </header>

      {/* ── s6 ACTIVITY SUMMARY -- the governed metrics, each with its reason when absent ───────── */}
      <section className="mt-4 rounded-2xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">Activity summary</h2>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ["Booked", m?.booked], ["Seen", m?.patients_seen], ["Walk-ins", m?.walk_in], ["No-shows", m?.no_show],
          ].map(([label, metric]: any[]) => (
            <div key={label} className="rounded-lg bg-gray-50 px-2.5 py-2" title={metric?.value === null ? metric?.reason ?? "" : metric?.formula ?? ""}>
              <p className="text-[19px] font-bold leading-none tabular-nums text-gray-900">
                {metric?.value ?? "—"}
              </p>
              <p className="mt-1 text-[10.5px] text-gray-600">{label}</p>
              {metric?.value === null && metric?.reason && (
                <p className="text-[9px] leading-tight text-gray-400">{metric.reason}</p>
              )}
            </div>
          ))}
        </div>
        {/* s6 metric safety: durations only through the governed shapes, denominators named. */}
        <div className="mt-2 grid grid-cols-2 gap-2">
          {[["Average consult time", m?.average_consult_time], ["Average wait", m?.average_wait_time]].map(([label, metric]: any[]) => (
            <div key={label} className="rounded-lg bg-gray-50 px-2.5 py-2">
              {metric?.value !== null && metric !== undefined ? (
                <>
                  <p className="text-[15px] font-bold leading-none tabular-nums text-gray-900">{metric.value} min</p>
                  <p className="mt-0.5 text-[10.5px] text-gray-600">{label}</p>
                  {metric.observations !== null && (
                    <p className="text-[9px] text-gray-400">
                      over {metric.observations} measurement{metric.observations === 1 ? "" : "s"}
                      {metric.excluded > 0 ? `, ${metric.excluded} excluded` : ""}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="text-[15px] font-bold leading-none text-gray-300">—</p>
                  <p className="mt-0.5 text-[10.5px] text-gray-500">{label}</p>
                  <p className="text-[9px] leading-tight text-gray-400">{metric?.reason ?? "Could not be read."}</p>
                </>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── s6 CLINICAL ACTIVITY -- what the window produced, where reliably recorded ───────────── */}
      <section className="mt-4 rounded-2xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">Clinical activity</h2>
        {!c ? (
          <p className="mt-1 text-[12px] text-gray-600">{clinical.reason}</p>
        ) : (
          <ul className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-2">
            {[
              ["Consultations started", c.encountersStarted],
              ["Follow-ups created", c.followUpsCreated],
              ["Investigations requested", c.investigationsRequested],
              ["Procedures performed", c.proceduresPerformed],
              ["Documents signed", c.documentsSigned],
            ].map(([k, v]) => (
              <li key={String(k)} className="flex items-baseline gap-2 text-[12.5px]">
                <span className="text-gray-700">{k}</span>
                <span className="ml-auto font-bold tabular-nums text-gray-900">{v}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[10px] text-gray-400">
          Counted by when each row was recorded, inside this session&apos;s own window. Work recorded
          later belongs to the day, not to this session, and is not guessed back in.
        </p>
      </section>

      {/* ── s6 OUTSTANDING ITEMS ──────────────────────────────────────────────────────────────── */}
      <section className="mt-4 rounded-2xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">Outstanding from this session</h2>
        {!c ? (
          <p className="mt-1 text-[12px] text-gray-600">{clinical.reason}</p>
        ) : c.encountersUnsigned === 0 && c.followUpsNeedingBooking === 0 ? (
          <p className="mt-1 text-[12px] text-emerald-700">Nothing left open. Every consultation from this session is signed and its follow-ups are booked or closed.</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1">
            {c.encountersUnsigned > 0 && (
              <li>
                <Link href="/practice/encounters"
                  className="flex items-baseline gap-2 rounded-lg border border-gray-100 px-2.5 py-1.5 text-[12px] hover:bg-gray-50">
                  <span className="text-gray-800">Unsigned consultations from this session</span>
                  <span className="ml-auto font-bold text-gray-900">{c.encountersUnsigned}</span>
                  <span aria-hidden className="text-gray-400">&rarr;</span>
                </Link>
              </li>
            )}
            {c.followUpsNeedingBooking > 0 && (
              <li>
                <Link href="/practice/follow-ups"
                  className="flex items-baseline gap-2 rounded-lg border border-gray-100 px-2.5 py-1.5 text-[12px] hover:bg-gray-50">
                  <span className="text-gray-800">Follow-ups raised here, not yet booked</span>
                  <span className="ml-auto font-bold text-gray-900">{c.followUpsNeedingBooking}</span>
                  <span aria-hidden className="text-gray-400">&rarr;</span>
                </Link>
              </li>
            )}
          </ul>
        )}
      </section>

      {/* ── s6 PRIMARY ACTIONS + s12 routing ─────────────────────────────────────────────────── */}
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href="/practice/home"
          className="rounded-lg bg-[var(--cp-primary)] px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90">
          Return to Today
        </Link>
        <Link href={`/practice/reports/view?template=session_report&activity=${s.activityId}&from=${s.planDate}&to=${s.planDate}`}
          className="rounded-lg border border-gray-200 px-4 py-2 text-[13px] font-semibold text-gray-700 hover:bg-gray-50">
          View Session Report
        </Link>
      </div>
      <p className="mt-2 text-[10px] text-gray-400">
        The report is the formal, governed account of this session -- same figures, packaged with
        definitions and provenance, printable from the report view.
      </p>
    </div>
  );
}
