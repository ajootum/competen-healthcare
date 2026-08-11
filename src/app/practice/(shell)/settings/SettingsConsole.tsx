"use client";

import { useState } from "react";
import { ENCOUNTER_MODES, LOCATION_TYPES, APPOINTMENT_MINUTES_BOUNDS } from "@/lib/practice/configuration";
import { LOCATION_COLOR_SLOTS } from "@/lib/practice/planner-constants";
import { FACILITY_TYPES } from "@/lib/practice/facilities";

// The settings form, the locations list, and the trail behind both.
//
// CHANGING THE TIMEZONE ASKS FIRST, AND SAYS WHAT IT AFFECTS. Every derived figure in this product --
// what is overdue, what is booked today, what a reporting period covers -- is computed from the
// practice clock at READ time. Correcting the zone therefore changes what those calculations would have
// said about dates already recorded. That is the right thing to allow and the wrong thing to do
// quietly, so the confirmation names the consequence rather than asking "are you sure?".

/* eslint-disable @typescript-eslint/no-explicit-any */

const input = "w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";

export default function SettingsConsole({ workspace, config, today, locations, history, canManageLocations, facilities = [] }: {
  workspace: any; config: any; today: string;
  locations: any[]; history: any[]; canManageLocations: boolean;
  /** The institutions a location can BE. Empty until the practice records one. */
  facilities?: any[];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState({
    practiceName: workspace.name ?? "",
    timezone: workspace.timezone ?? "",
    defaultEncounterMode: config.default_encounter_mode ?? "in_person",
    defaultAppointmentMinutes: config.default_appointment_minutes ?? 20,
  });
  // Kept apart from the settings form above so saving one does not resubmit the other -- a PATCH that
  // carried both would make correcting an address look like a timezone change in the audit trail.
  const [letterhead, setLetterhead] = useState({
    letterheadName: config.letterhead_name ?? "",
    letterheadRegistration: config.letterhead_registration ?? "",
    letterheadAddress: config.letterhead_address ?? "",
    letterheadContact: config.letterhead_contact ?? "",
  });
  const [newLocation, setNewLocation] = useState({ name: "", type: "clinic" });
  const [newFacility, setNewFacility] = useState({ name: "", facilityType: "hospital" });

  async function send(method: string, payload: unknown) {
    setBusy(true); setError(null);
    const res = await fetch("/api/v1/practice/configuration", {
      method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data?.error?.message ?? data?.error ?? "That did not work.");
      setBusy(false); return;
    }
    window.location.reload();
  }

  const timezoneChanging = settings.timezone !== workspace.timezone;

  return (
    <>
      {error && <p className="mt-3 rounded-lg bg-[var(--cmp-surface-critical)] px-3 py-2 text-[12px] text-[var(--cmp-text-critical)]">{error}</p>}

      <section id="practice-profile" className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">The practice</h2>
        <form className="mt-2 flex flex-col gap-3" onSubmit={e => {
          e.preventDefault();
          if (timezoneChanging && !confirm(
            `Change the practice clock from ${workspace.timezone} to ${settings.timezone}?\n\n` +
            "This is not only about the future. What counts as overdue, what appears in today's diary, " +
            "and what a reporting period covers are all worked out from this clock every time they are " +
            "read — so those answers will change for dates already recorded.\n\n" +
            "The change is recorded with both values so it can be explained later.",
          )) return;
          send("PATCH", { settings });
        }}>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-gray-500">Practice name</span>
            <input required value={settings.practiceName}
              onChange={e => setSettings(s => ({ ...s, practiceName: e.target.value }))} className={input} />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-gray-500">Timezone</span>
            <input required value={settings.timezone} placeholder="Africa/Kampala"
              onChange={e => setSettings(s => ({ ...s, timezone: e.target.value }))} className={input} />
            <span className="text-[10px] text-gray-400">
              An IANA name such as Africa/Kampala or Africa/Nairobi. A name the platform does not know is
              refused rather than accepted &mdash; the clock would otherwise fall back to UTC silently.
              Today here is currently {today}.
            </span>
          </label>

          {timezoneChanging && (
            <p className="rounded-lg bg-[var(--cmp-surface-warning)] px-3 py-2 text-[11px] text-[var(--cmp-text-warning)]">
              Changing the clock changes what &ldquo;overdue&rdquo;, &ldquo;today&rdquo; and every
              reporting period mean &mdash; including for dates already recorded, because all of them are
              worked out at the moment they are read.
            </p>
          )}

          <div className="grid sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-gray-500">Default appointment length</span>
              <input type="number" min={APPOINTMENT_MINUTES_BOUNDS.min} max={APPOINTMENT_MINUTES_BOUNDS.max}
                value={settings.defaultAppointmentMinutes}
                onChange={e => setSettings(s => ({ ...s, defaultAppointmentMinutes: Number(e.target.value) }))}
                className={input} />
              <span className="text-[10px] text-gray-400">
                Minutes. Used when a booking does not name its own length, and by the double-booking check.
              </span>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-gray-500">Default consultation mode</span>
              <select value={settings.defaultEncounterMode}
                onChange={e => setSettings(s => ({ ...s, defaultEncounterMode: e.target.value }))} className={input}>
                {ENCOUNTER_MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
          </div>

          <button type="submit" disabled={busy}
            className="self-start rounded-lg bg-[var(--cp-primary)] px-4 py-2 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50">
            Save
          </button>
        </form>
      </section>

      {/* ── Letterhead (CPR-330 practice branding) ────────────────────────────────────────────────
          EVERY FIELD OPTIONAL, and an unsupplied field prints NOTHING. This is why CPR-130 was right
          to refuse a letterhead at the time: there was no source for these facts, and a certificate
          reading "[PRACTICE ADDRESS]" is worse than one with no address at all. The practice supplies
          them here, or it does not and its documents print without a header. */}
      <section id="letterhead" className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">Letterhead</h2>
        <p className="mt-0.5 text-[11px] text-gray-500">
          Printed at the top of generated letters and certificates. Nothing here is required &mdash; a
          field left blank prints nothing rather than a placeholder, and a letterhead with only a name
          is not printed at all.
        </p>
        <form className="mt-2 flex flex-col gap-3" onSubmit={e => { e.preventDefault(); send("PATCH", { settings: letterhead }); }}>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-gray-500">Name on the letterhead</span>
              <input value={letterhead.letterheadName} placeholder={workspace.name ?? ""}
                onChange={e => setLetterhead(s => ({ ...s, letterheadName: e.target.value }))} className={input} />
              <span className="text-[10px] text-gray-400">Defaults to the practice name above.</span>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-gray-500">Registration or licence number</span>
              <input value={letterhead.letterheadRegistration}
                onChange={e => setLetterhead(s => ({ ...s, letterheadRegistration: e.target.value }))} className={input} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-gray-500">Address</span>
              <input value={letterhead.letterheadAddress}
                onChange={e => setLetterhead(s => ({ ...s, letterheadAddress: e.target.value }))} className={input} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-gray-500">Telephone or email</span>
              <input value={letterhead.letterheadContact}
                onChange={e => setLetterhead(s => ({ ...s, letterheadContact: e.target.value }))} className={input} />
            </label>
          </div>
          <button type="submit" disabled={busy}
            className="self-start rounded-lg bg-[var(--cp-primary)] px-4 py-2 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50">
            Save letterhead
          </button>
        </form>
      </section>

      {/* Locations */}
      <section id="locations" className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">Locations</h2>
        {locations.length === 0 ? (
          <p className="mt-2 text-[12px] text-gray-400">None yet.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {locations.map(l => (
              <li key={l.id} className="rounded-lg border border-gray-100 px-2.5 py-2 text-[12px]">
                <div className="flex items-center gap-2">
                  <span className={l.active ? "font-semibold text-gray-800" : "text-gray-400 line-through"}>{l.name}</span>
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
                    {String(l.type).replace(/_/g, " ")}
                  </span>
                  {!l.active && <span className="text-[10px] text-gray-400">closed</span>}
                  {canManageLocations && (
                    <button type="button" disabled={busy}
                      onClick={() => send("PUT", { locationId: l.id, active: !l.active })}
                      className="ml-auto rounded border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                      {l.active ? "Close" : "Reopen"}
                    </button>
                  )}
                </div>

                {/* ── MULTI-HOSPITAL: which institution this place IS, and how long it takes to reach ──
                    The facility link is what lets a booking screen show this patient's number AT THIS
                    HOSPITAL rather than whichever MRN happens to sit first on their record. */}
                {canManageLocations && l.active && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-1.5">
                    <label className="text-[11px] text-gray-500" htmlFor={`fac-${l.id}`}>Is</label>
                    <select id={`fac-${l.id}`} disabled={busy} value={l.facility_id ?? ""}
                      onChange={e => send("PUT", { locationId: l.id, facilityId: e.target.value || null })}
                      className="rounded border border-gray-200 px-1.5 py-1 text-[11px] text-gray-700">
                      <option value="">no facility</option>
                      {facilities.map((f: any) => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>

                    <label className="ml-2 text-[11px] text-gray-500" htmlFor={`trv-${l.id}`}>Travel here</label>
                    <input id={`trv-${l.id}`} type="number" min={0} max={480} step={5} disabled={busy}
                      defaultValue={l.travel_buffer_minutes ?? 30}
                      onBlur={e => {
                        const v = Number(e.target.value);
                        if (v !== (l.travel_buffer_minutes ?? 30)) send("PUT", { locationId: l.id, travelBufferMinutes: v });
                      }}
                      className="w-16 rounded border border-gray-200 px-1.5 py-1 text-[11px] text-gray-700" />
                    <span className="text-[11px] text-gray-400">min</span>

                    {l.type === "hospital" && !l.facility_id && (
                      <span className="text-[10px] text-amber-700">
                        a patient&apos;s number here cannot be shown until this is linked
                      </span>
                    )}
                  </div>
                )}

                {/* ── THE PLANNER COLOUR (the owner, 2026-08-12) ─────────────────────────────────
                    One hue per clinic across the month, week and day views. "Auto" returns this
                    clinic to the hashed palette; a chosen swatch wins everywhere at once. */}
                {canManageLocations && l.active && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 border-t border-gray-100 pt-1.5">
                    <span className="mr-0.5 text-[11px] text-gray-500">Planner colour</span>
                    {LOCATION_COLOR_SLOTS.map(([slot, label, dot]) => (
                      <button key={slot} type="button" disabled={busy} title={label}
                        aria-label={`Colour ${l.name} ${label}`}
                        aria-pressed={l.color_slot === slot}
                        onClick={() => send("PUT", { locationId: l.id, colorSlot: slot })}
                        className={`h-5 w-5 rounded-full ${dot} ${l.color_slot === slot
                          ? "ring-2 ring-gray-700 ring-offset-1"
                          : "opacity-70 hover:opacity-100"} disabled:opacity-40`} />
                    ))}
                    <button type="button" disabled={busy}
                      aria-pressed={!l.color_slot}
                      onClick={() => send("PUT", { locationId: l.id, colorSlot: null })}
                      className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${!l.color_slot
                        ? "border-gray-700 text-gray-800"
                        : "border-gray-200 text-gray-500 hover:bg-gray-50"} disabled:opacity-40`}>
                      Auto
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {canManageLocations && (
          <form className="mt-3 flex gap-2 flex-wrap" onSubmit={e => {
            e.preventDefault();
            send("POST", { location: newLocation });
          }}>
            <input required placeholder="Name" value={newLocation.name}
              onChange={e => setNewLocation(l => ({ ...l, name: e.target.value }))} className={`${input} flex-1 min-w-[160px]`} />
            <select value={newLocation.type} onChange={e => setNewLocation(l => ({ ...l, type: e.target.value }))}
              className={`${input} w-44`} aria-label="Location type">
              {LOCATION_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <button type="submit" disabled={busy || !newLocation.name.trim()}
              className="rounded-lg border border-gray-200 px-3 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              Add
            </button>
          </form>
        )}
        <p className="mt-2 text-[10px] text-gray-400">
          A closed location stops being offered and keeps explaining where past consultations happened.
          Locations are never deleted, because appointments and encounters point at them.
        </p>
      </section>

      {/* ── Institutions ───────────────────────────────────────────────────────────────────────────
          A location is somewhere YOU work. A facility is an institution whose NUMBERING a patient
          carries. For a hospital they are the same building, which is why one can be linked to the
          other above — and why a hospital needs to exist here before that link can be made. */}
      {canManageLocations && (
        <section id="institutions" className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-[13px] font-bold text-gray-900">Institutions</h2>
          <p className="mt-0.5 text-[11px] text-gray-500">
            Hospitals and laboratories whose own patient numbers you record. Link one to a location above
            and a booking there will show that patient&apos;s number at that hospital.
          </p>

          {facilities.length === 0 ? (
            <p className="mt-2 text-[12px] text-gray-400">None yet.</p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {facilities.map((f: any) => {
                const linkedTo = locations.find(l => l.facility_id === f.id);
                return (
                  <li key={f.id} className="rounded-lg border border-gray-100 px-2.5 py-1.5">
                    <p className="text-[12px] font-semibold text-gray-800">{f.name}</p>
                    <p className="text-[10px] text-gray-500">
                      {String(f.facility_type).replace(/_/g, " ")}
                      {linkedTo ? ` · you work here as “${linkedTo.name}”` : " · not one of your locations"}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}

          <form className="mt-3 flex flex-wrap gap-2" onSubmit={e => {
            e.preventDefault();
            send("POST", { facility: newFacility });
          }}>
            <input required placeholder="Name, e.g. Mulago Hospital" value={newFacility.name}
              onChange={e => setNewFacility(f => ({ ...f, name: e.target.value }))}
              className={`${input} min-w-[180px] flex-1`} />
            <select value={newFacility.facilityType} onChange={e => setNewFacility(f => ({ ...f, facilityType: e.target.value }))}
              className={`${input} w-44`} aria-label="Institution type">
              {FACILITY_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <button type="submit" disabled={busy || newFacility.name.trim().length < 2}
              className="rounded-lg border border-gray-200 px-3 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              Add
            </button>
          </form>

          <p className="mt-2 text-[10px] text-gray-400">
            Names are matched loosely, so “Mulago Hospital” and “mulago  hospital” cannot both exist and
            split one hospital&apos;s numbering in two. This is your own list — there is no national
            facility register in this product, and inventing one would be a claim about somebody
            else&apos;s numbering.
          </p>
        </section>
      )}

      {/* The trail */}
      {history.length > 0 && (
        <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-[13px] font-bold text-gray-900">What has been changed</h2>
          <ul className="mt-2 flex flex-col gap-1">
            {history.map((h: any, i: number) => (
              <li key={i} className="flex items-baseline gap-2 text-[11px]">
                <span className="font-mono text-gray-400">{String(h.occurred_at).slice(0, 16).replace("T", " ")}</span>
                <span className="text-gray-700">
                  {h.actor_name ?? "Somebody"} changed {(h.payload?.changed ?? []).join(", ")}
                </span>
                {h.payload?.timezoneFrom && (
                  <span className="font-semibold text-[var(--cmp-text-warning)]">
                    {h.payload.timezoneFrom} → {h.payload.timezoneTo}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] text-gray-400">
            From the workspace audit log. A timezone change records both values, because &ldquo;the clock
            is Africa/Kampala&rdquo; does not explain why last month&apos;s report moved.
          </p>
        </section>
      )}
    </>
  );
}
