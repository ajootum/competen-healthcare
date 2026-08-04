import { redirect } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { availabilityConfig, bookingPreview, WEEKDAYS, hhmm } from "@/lib/practice/availability-config";
import AvailabilityConsole from "./AvailabilityConsole";

// CPR-SET-002 v4 — Locations, Clinics & Availability Configuration.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE SPECIFICATION'S FIVE TABS: My Locations · Regular Week · Dates & Exceptions · Booking Rules ·
// Booking Preview. Server-rendered, with one client console for the writes.
//
// THE PREVIEW IS COMPUTED THE WAY THE BOOKING ENGINE COMPUTES IT, never from a stored answer. A preview
// that used its own logic would eventually disagree with the diary, and the whole point of the tab is
// to see what the engine would do before a patient does.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

const card = "rounded-xl border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

const KIND_HUE: Record<string, string> = {
  clinic: "var(--cp-primary)", telemedicine: "var(--cp-accent)",
  emergency_reserve: "var(--cp-error)", leave: "var(--cp-warning)",
  blocked: "var(--cp-slate-500)", admin: "var(--cp-slate-500)",
};

const EXC_HUE: Record<string, string> = {
  leave: "var(--cp-warning)", closure: "var(--cp-slate-500)",
  extra_session: "var(--cp-success)", extended_hours: "var(--cp-accent)",
};

export default async function AvailabilityConfigPage({ searchParams }: {
  searchParams: Promise<{ from?: string }>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  const { ctx } = shell;
  if (!hasCapability(ctx, "appointment.manage")) redirect("/practice/setup");

  const admin = createAdminClient();
  const cfg = await availabilityConfig(admin, ctx);

  const { from } = await searchParams;
  const previewFrom = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : cfg.today;
  const previewTo = new Date(Date.parse(`${previewFrom}T12:00:00Z`) + 13 * 86400000).toISOString().slice(0, 10);
  const preview = await bookingPreview(admin, ctx, { fromDate: previewFrom, toDate: previewTo });

  const locName = new Map(cfg.locations.map((l: any) => [l.id, l.name]));
  const clinicName = new Map(cfg.clinics.map((c: any) => [c.id, c.name]));

  return (
    <div className="-m-5 min-h-full bg-[var(--cp-canvas)] p-5">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4">

        <div className="flex flex-wrap items-start gap-3">
          <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--cp-info)]/12 text-[20px] text-[var(--cp-info)]">▤</span>
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <Link href="/practice/setup" className="text-[12px] font-semibold text-[var(--cp-primary)] hover:underline">
                Practice Setup
              </Link>
              <span className="text-[12px] text-gray-300">›</span>
            </div>
            <h1 className="text-xl font-bold text-gray-900">Locations &amp; Availability</h1>
            <p className="text-[13px] text-gray-500">
              Your regular week, the dates that differ from it, and the rules that govern booking.
              All times are in {cfg.timezone}.
            </p>
          </div>
          <Link href="/practice/calendar"
            className="ml-auto rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
            Open the calendar →
          </Link>
        </div>

        {/* ── 1. My Locations ───────────────────────────────────────────────────────────────────── */}
        <section className={card}>
          <div className="mb-3 flex items-center gap-2">
            <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--cp-primary)]/12 text-[12px] text-[var(--cp-primary-deep)]">◎</span>
            <h2 className="text-[13px] font-bold text-gray-900">My locations</h2>
            <span className="text-[11px] text-gray-500">{cfg.locations.filter((l: any) => l.active).length} open</span>
            <Link href="/practice/settings" className="ml-auto text-[11px] font-semibold text-[var(--cp-primary)] hover:underline">
              Add or close a location →
            </Link>
          </div>
          {cfg.locations.length === 0 ? (
            <p className="text-[12px] text-gray-400">No location yet.</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {cfg.locations.map((l: any) => {
                const clinics = cfg.clinics.filter((c: any) => c.location_id === l.id && c.active);
                return (
                  <li key={l.id} className={`rounded-lg border px-3 py-2.5 ${l.active ? "border-gray-200" : "border-gray-100 bg-slate-50/60"}`}>
                    <p className={`text-[13px] font-semibold ${l.active ? "text-gray-900" : "text-gray-400 line-through"}`}>{l.name}</p>
                    <p className="text-[10px] text-gray-500">
                      {String(l.type).replace(/_/g, " ")}
                      {l.travel_buffer_minutes != null ? ` · ${l.travel_buffer_minutes} min to reach` : ""}
                    </p>
                    {/* Clinics INSIDE a location -- not second locations, which is why no travel rule
                        applies between two clinics in one hospital. */}
                    {clinics.length > 0 && (
                      <ul className="mt-1.5 flex flex-wrap gap-1">
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

        {/* ── 2. Regular week ───────────────────────────────────────────────────────────────────── */}
        <section className={card}>
          <div className="mb-3 flex items-center gap-2">
            <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-md bg-violet-100 text-[12px] text-violet-700">▤</span>
            <h2 className="text-[13px] font-bold text-gray-900">The regular week</h2>
            <span className="text-[11px] text-gray-500">
              {cfg.templates.length} {cfg.templates.length === 1 ? "session" : "sessions"} · {cfg.generatedSlotCount} slots generated
            </span>
          </div>

          <div className="grid gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {WEEKDAYS.map(([n, label]) => {
              const sessions = cfg.templates.filter((t: any) => t.weekday === n);
              return (
                <div key={n} className="rounded-lg border border-gray-100 bg-[var(--cp-canvas)] p-2">
                  <p className="text-[11px] font-bold text-gray-700">{label}</p>
                  {sessions.length === 0 ? (
                    <p className="mt-1 text-[10px] text-gray-400">—</p>
                  ) : (
                    <ul className="mt-1 space-y-1">
                      {sessions.map((t: any) => (
                        <li key={t.id} className="rounded border-l-2 bg-white px-1.5 py-1"
                          style={{ borderLeftColor: KIND_HUE[t.slot_kind] ?? "var(--cp-slate-300)" }}>
                          <p className="text-[10px] font-semibold text-gray-800">
                            {hhmm(t.starts_minute)}–{hhmm(t.ends_minute)}
                          </p>
                          <p className="truncate text-[9px] text-gray-500">
                            {t.clinic_id ? clinicName.get(t.clinic_id) : t.location_id ? locName.get(t.location_id) : "anywhere"}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[10px] text-gray-400">
            A session is stored as a weekday and a time, not as 52 copies — so changing Tuesday changes
            every Tuesday. Generating turns it into real slots the calendar can book into.
          </p>
        </section>

        {/* ── 3. Dates & exceptions ─────────────────────────────────────────────────────────────── */}
        <section className={card}>
          <div className="mb-3 flex items-center gap-2">
            <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-100 text-[12px] text-amber-700">⚑</span>
            <h2 className="text-[13px] font-bold text-gray-900">Dates that differ</h2>
            <span className="text-[11px] text-gray-500">{cfg.exceptions.length} upcoming</span>
          </div>
          {cfg.exceptions.length === 0 ? (
            <p className="text-[12px] text-gray-400">Nothing recorded. Your regular week applies throughout.</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {cfg.exceptions.map((e: any) => (
                <li key={e.id} className="rounded-lg border-l-[3px] border border-gray-200 px-3 py-2"
                  style={{ borderLeftColor: EXC_HUE[e.kind] ?? "var(--cp-slate-300)" }}>
                  <p className="text-[12px] font-semibold capitalize text-gray-800">
                    {String(e.kind).replace(/_/g, " ")}
                  </p>
                  <p className="text-[11px] text-gray-600">
                    {e.from_date === e.to_date ? e.from_date : `${e.from_date} → ${e.to_date}`}
                    {e.starts_minute != null ? ` · ${hhmm(e.starts_minute)}–${hhmm(e.ends_minute)}` : " · the whole day"}
                  </p>
                  <p className="text-[10px] text-gray-500">
                    {e.location_id ? locName.get(e.location_id) : "everywhere"}
                    {e.reason ? ` · ${e.reason}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── 4 + write actions ─────────────────────────────────────────────────────────────────── */}
        <AvailabilityConsole
          locations={JSON.parse(JSON.stringify(cfg.locations.filter((l: any) => l.active)))}
          clinics={JSON.parse(JSON.stringify(cfg.clinics.filter((c: any) => c.active)))}
          rules={JSON.parse(JSON.stringify(cfg.rules))}
          inert={JSON.parse(JSON.stringify(cfg.inert))}
          today={cfg.today}
          canSetRules={hasCapability(ctx, "practice.settings.manage")}
        />

        {/* ── 5. Booking preview ────────────────────────────────────────────────────────────────── */}
        <section className={card}>
          <div className="mb-3 flex items-center gap-2">
            <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-100 text-[12px] text-emerald-700">◉</span>
            <h2 className="text-[13px] font-bold text-gray-900">Booking preview</h2>
            <span className="text-[11px] text-gray-500">{previewFrom} → {previewTo}</span>
          </div>
          {preview.days.length === 0 ? (
            <p className="text-[12px] text-gray-400">
              Nothing bookable in this fortnight. Add sessions to the regular week and generate.
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
                          {new Date(e.from).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: preview.timezone })}
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
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
            {preview.note}
          </p>
        </section>
      </div>
    </div>
  );
}
