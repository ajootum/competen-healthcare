"use client";

import { useState } from "react";
import { ENCOUNTER_MODES, LOCATION_TYPES, APPOINTMENT_MINUTES_BOUNDS } from "@/lib/practice/configuration";

// The settings form, the locations list, and the trail behind both.
//
// CHANGING THE TIMEZONE ASKS FIRST, AND SAYS WHAT IT AFFECTS. Every derived figure in this product --
// what is overdue, what is booked today, what a reporting period covers -- is computed from the
// practice clock at READ time. Correcting the zone therefore changes what those calculations would have
// said about dates already recorded. That is the right thing to allow and the wrong thing to do
// quietly, so the confirmation names the consequence rather than asking "are you sure?".

/* eslint-disable @typescript-eslint/no-explicit-any */

const input = "w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";

export default function SettingsConsole({ workspace, config, today, inertColumns, locations, history, canManageLocations, facilities = [] }: {
  workspace: any; config: any; today: string; inertColumns: string[];
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

      <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
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
      <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
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
      <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
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

      {/* What exists in the schema and is not wired to anything */}
      <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">Not yet wired</h2>
        <p className="mt-0.5 text-[11px] text-gray-500">
          These columns exist in the configuration table and nothing in the product reads them. They are
          listed rather than shown as fields, because a setting you can change and that changes nothing
          is worse than one that is missing.
        </p>
        <ul className="mt-2 flex flex-col gap-0.5">
          {inertColumns.map(c => (
            <li key={c} className="font-mono text-[11px] text-gray-500">{c}</li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-gray-500">
          There is also no personalisation here &mdash; no themes, densities or default landing pages.
          Nothing in this product has a per-user preference worth storing yet, and inventing one to fill
          a heading would be building a feature nobody asked for.
        </p>
      </section>

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
