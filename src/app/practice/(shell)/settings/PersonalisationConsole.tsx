"use client";

import { useState } from "react";
import {
  THEMES, ACCENTS, FONT_SCALES, DENSITIES, DASHBOARD_WIDGETS,
  NOTIFICATION_CATEGORIES, SHORTCUTS, type PreferenceShape,
} from "@/lib/practice/preference-constants";

// CPR-360's personalisation surface, laid out to the comp: appearance, dashboard customisation,
// notification preferences, specialty profile, workflow preferences, shortcuts, sync and devices.
//
// EVERY CONTROL HERE CHANGES SOMETHING. Where the comp draws a control this product cannot honour, it
// renders in its designed position, disabled, saying why -- quiet hours, remappable shortcuts, the
// device register and the AI assistant. A greyed control with a reason is information; a live control
// that does nothing is a lie somebody only catches later.

const input = "w-full rounded-lg border border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 px-2.5 py-2 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";
const card = "rounded-xl border border-gray-200 bg-white p-4";

type Notice = { kind: "ok" | "err" | "locked"; text: string } | null;

export default function PersonalisationConsole({ preferences, locked, practice }: {
  preferences: PreferenceShape & { id: string };
  locked: string[];
  practice: { defaultEncounterMode: string; defaultAppointmentMinutes: number };
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [widgets, setWidgets] = useState(preferences.dashboardWidgets);
  const [subspecialty, setSubspecialty] = useState("");

  const isLocked = (key: string) => locked.includes(key);

  async function save(patch: Record<string, unknown>, { reload = true } = {}) {
    setBusy(true); setNotice(null);
    const res = await fetch("/api/v1/practice/preferences", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNotice({ kind: "err", text: data?.error?.message ?? "That did not work." });
      setBusy(false); return;
    }
    // A partial save is reported as one. Somebody who changed two things and got one must be told which.
    if (data.refused?.length) {
      setNotice({ kind: "locked", text: `Saved, except ${data.refused.join(" and ")} — your practice sets that.` });
      setBusy(false); return;
    }
    if (reload) window.location.reload(); else { setNotice({ kind: "ok", text: "Saved." }); setBusy(false); }
  }

  async function reset() {
    if (!confirm("Put every personal setting back to its default? Practice settings are not affected.")) return;
    setBusy(true);
    await fetch("/api/v1/practice/preferences", { method: "DELETE" });
    window.location.reload();
  }

  function move(index: number, by: number) {
    const next = [...widgets];
    const to = index + by;
    if (to < 0 || to >= next.length) return;
    [next[index], next[to]] = [next[to], next[index]];
    setWidgets(next);
  }

  const visibleCount = widgets.filter(w => w.visible).length;
  const labelOf = Object.fromEntries(DASHBOARD_WIDGETS.map(([k, l]) => [k, l])) as Record<string, string>;

  return (
    <>
      {notice && (
        <p className={`mt-3 rounded-lg px-3 py-2 text-[12px] ${
          notice.kind === "ok" ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]"
            : notice.kind === "locked" ? "bg-amber-50 text-amber-900"
              : "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"}`}>
          {notice.text}
        </p>
      )}

      <div className="mt-4 grid lg:grid-cols-2 gap-4 items-start">
        {/* ── Appearance ───────────────────────────────────────────────────────────────────────── */}
        <section id="appearance" className={card}>
          <h2 className="text-[13px] font-bold text-gray-900">Appearance</h2>

          <p className="mt-2 text-[11px] font-semibold text-gray-500">Theme</p>
          <div className="mt-1 flex gap-2">
            {THEMES.map(([k, l]) => (
              <button key={k} type="button" disabled={busy} onClick={() => save({ theme: k })}
                aria-pressed={preferences.theme === k}
                className={`flex-1 rounded-lg border px-2 py-2 text-[12px] font-semibold ${
                  preferences.theme === k
                    ? "border-[var(--cp-primary)] bg-[var(--cp-primary-soft)] text-[var(--cp-primary-deep)]"
                    : "border-gray-200 text-gray-700 hover:bg-gray-50"}`}>
                {l}
              </button>
            ))}
          </div>

          <p className="mt-3 text-[11px] font-semibold text-gray-500">Accent colour</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {ACCENTS.map(([k, l, hex]) => (
              <button key={k} type="button" disabled={busy} onClick={() => save({ accent: k })}
                aria-label={l} aria-pressed={preferences.accent === k} title={l}
                className={`h-7 w-7 rounded-full border-2 ${preferences.accent === k ? "border-gray-900" : "border-transparent"}`}
                style={{ backgroundColor: hex }} />
            ))}
          </div>
          <p className="mt-1 text-[10px] text-gray-500">
            {/* Not a colour picker, and the reason is worth stating where somebody might expect one. */}
            A fixed set from the design system rather than a free colour: an arbitrary shade walks
            straight out of the contrast this platform has proven.
          </p>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-gray-500">Text and interface size</span>
              <select value={preferences.fontScale} disabled={busy}
                onChange={e => save({ fontScale: e.target.value })} className={input}>
                {FONT_SCALES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              {/* Honest label: it scales the whole interface, because this product's type is in pixels
                  and a font-size setting would not move it. */}
              <span className="text-[10px] text-gray-400">Scales the page, not only the type.</span>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-gray-500">Density</span>
              <select value={preferences.density} disabled={busy}
                onChange={e => save({ density: e.target.value })} className={input}>
                {DENSITIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
          </div>

          <label className="mt-3 flex items-center gap-2 text-[12px] text-gray-700">
            <input type="checkbox" checked={preferences.reduceVisualNoise} disabled={busy}
              onChange={e => save({ reduceVisualNoise: e.target.checked })} />
            Reduce visual noise
          </label>
          <p className="mt-0.5 text-[10px] text-gray-500">
            Removes shadows and background tints. Warning and error colours stay &mdash; that tint is
            information, and removing it would be reducing meaning rather than noise.
          </p>
        </section>

        {/* ── Dashboard customisation ──────────────────────────────────────────────────────────── */}
        <section id="dashboard" className={card}>
          <div className="flex items-baseline justify-between">
            <h2 className="text-[13px] font-bold text-gray-900">Dashboard</h2>
            <span className="text-[11px] text-gray-500">{visibleCount} of {widgets.length} showing</span>
          </div>
          {isLocked("dashboardWidgets") ? (
            <p className="mt-2 text-[12px] text-amber-900">Your practice sets the dashboard layout.</p>
          ) : (
            <>
              <ul className="mt-2 flex flex-col">
                {widgets.map((w, i) => (
                  <li key={w.key} className="flex items-center gap-2 border-b border-gray-100 py-1.5 last:border-0">
                    <input type="checkbox" checked={w.visible} aria-label={labelOf[w.key] ?? w.key}
                      onChange={e => setWidgets(ws => ws.map((x, j) => j === i ? { ...x, visible: e.target.checked } : x))} />
                    <span className="text-[12px] text-gray-800">{labelOf[w.key] ?? w.key}</span>
                    <span className="ml-auto flex gap-1">
                      {/* Buttons rather than drag-and-drop, deliberately: a list that can only be
                          reordered by dragging cannot be reordered with a keyboard at all, which would
                          make the accessibility panel the least accessible thing on the page. */}
                      <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                        aria-label={`Move ${labelOf[w.key]} up`}
                        className="rounded border border-gray-200 px-1.5 text-[11px] text-gray-600 hover:bg-gray-50 disabled:opacity-30">↑</button>
                      <button type="button" onClick={() => move(i, 1)} disabled={i === widgets.length - 1}
                        aria-label={`Move ${labelOf[w.key]} down`}
                        className="rounded border border-gray-200 px-1.5 text-[11px] text-gray-600 hover:bg-gray-50 disabled:opacity-30">↓</button>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex items-center gap-2">
                <button type="button" disabled={busy || visibleCount === 0}
                  onClick={() => save({ dashboardWidgets: widgets })}
                  className="rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40">
                  Save layout
                </button>
                <button type="button" onClick={() => setWidgets(preferences.dashboardWidgets)}
                  className="text-[12px] text-gray-500 hover:underline">Undo changes</button>
              </div>
              {visibleCount === 0 && (
                <p className="mt-1 text-[11px] text-[var(--cmp-text-critical)]">
                  At least one widget has to stay visible &mdash; an empty dashboard cannot be undone
                  from the dashboard.
                </p>
              )}
            </>
          )}
        </section>

        {/* ── Notifications ────────────────────────────────────────────────────────────────────── */}
        <section id="notifications" className={card}>
          <h2 className="text-[13px] font-bold text-gray-900">Notifications</h2>
          <ul className="mt-2 flex flex-col">
            {NOTIFICATION_CATEGORIES.map(([key, label, optional, events]) => {
              const raises = (events as readonly string[]).length > 0;
              const on = preferences.notificationCategories[key] !== false;
              return (
                <li key={key} className="flex items-center gap-2 border-b border-gray-100 py-1.5 last:border-0">
                  <span className="min-w-0">
                    <span className={`block text-[12px] ${raises ? "text-gray-800" : "text-gray-400"}`}>{label}</span>
                    {!raises && (
                      <span className="block text-[10px] text-gray-500">Nothing raises these yet.</span>
                    )}
                    {raises && optional === false && (
                      <span className="block text-[10px] text-gray-500">Always on.</span>
                    )}
                  </span>
                  <input type="checkbox" className="ml-auto" checked={on}
                    disabled={busy || !raises || optional === false || isLocked("notificationCategories")}
                    aria-label={label}
                    onChange={e => save({
                      notificationCategories: { ...preferences.notificationCategories, [key]: e.target.checked },
                    })} />
                </li>
              );
            })}
          </ul>

          {/* THE COMP'S QUIET HOURS, in place and switched off. Worth saying rather than deleting:
              somebody comparing the design to the build should find the reason here. */}
          <div className="mt-3 rounded-lg border border-dashed border-gray-200 bg-gray-50/60 p-2">
            <p className="text-[11px] font-semibold text-gray-500">Quiet hours</p>
            <p className="mt-0.5 text-[10px] text-gray-500">
              Quiet hours silence notifications as they arrive. Nothing in this product pushes one to you
              &mdash; there is no email, no SMS and no device notification, and the list is read when you
              open it. There is nothing here to silence.
            </p>
          </div>
        </section>

        {/* ── Specialty and workflow ───────────────────────────────────────────────────────────── */}
        <section className={card}>
          <h2 className="text-[13px] font-bold text-gray-900">Specialty and workflow</h2>

          <label className="mt-2 flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-gray-500">Primary specialty</span>
            <input defaultValue={preferences.specialty ?? ""} disabled={busy}
              placeholder="Neurosurgery" className={input}
              onBlur={e => e.target.value !== (preferences.specialty ?? "") && save({ specialty: e.target.value })} />
            <span className="text-[10px] text-gray-400">
              Puts templates tagged with your specialty at the top of the library. Nothing is hidden.
            </span>
          </label>

          <div className="mt-2">
            <p className="text-[11px] font-semibold text-gray-500">Subspecialties</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {preferences.subspecialties.map(s => (
                <button key={s} type="button" disabled={busy}
                  onClick={() => save({ subspecialties: preferences.subspecialties.filter(x => x !== s) })}
                  className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-700 hover:bg-gray-200">
                  {s} &times;
                </button>
              ))}
            </div>
            <div className="mt-1 flex gap-2">
              <input value={subspecialty} onChange={e => setSubspecialty(e.target.value)}
                placeholder="Add one" className={input} />
              <button type="button" disabled={busy || !subspecialty.trim()}
                onClick={() => { save({ subspecialties: [...preferences.subspecialties, subspecialty.trim()] }); setSubspecialty(""); }}
                className="rounded-lg border border-gray-200 px-3 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40">
                Add
              </button>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-gray-500">My consultation length</span>
              <input type="number" min={5} max={240} defaultValue={preferences.defaultAppointmentMinutes ?? ""}
                disabled={busy || isLocked("defaultAppointmentMinutes")}
                placeholder={`${practice.defaultAppointmentMinutes} (the practice)`} className={input}
                onBlur={e => {
                  const v = e.target.value.trim();
                  save({ defaultAppointmentMinutes: v === "" ? null : Number(v) });
                }} />
              {/* Blank is a real value here, not a missing one: it means follow the practice. */}
              <span className="text-[10px] text-gray-400">
                {isLocked("defaultAppointmentMinutes")
                  ? "Your practice sets this."
                  : `Leave blank to follow the practice (${practice.defaultAppointmentMinutes} minutes).`}
              </span>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-gray-500">My consultation mode</span>
              <select defaultValue={preferences.defaultEncounterMode ?? ""}
                disabled={busy || isLocked("defaultEncounterMode")}
                onChange={e => save({ defaultEncounterMode: e.target.value || null })} className={input}>
                <option value="">Follow the practice ({practice.defaultEncounterMode.replace(/_/g, " ")})</option>
                <option value="in_person">In person</option>
                <option value="telephone">Telephone</option>
                <option value="video">Video</option>
                <option value="home_visit">Home visit</option>
              </select>
            </label>
          </div>

          <div className="mt-3 rounded-lg border border-dashed border-gray-200 bg-gray-50/60 p-2">
            <p className="text-[11px] font-semibold text-gray-500">Auto-save interval</p>
            <p className="mt-0.5 text-[10px] text-gray-500">
              A two-minute setting was designed for this. Consultation notes are saved when you save them &mdash;
              there is no autosave to set an interval for. It is not built, and this
              setting arrives with it.
            </p>
          </div>
        </section>

        {/* ── Shortcuts ────────────────────────────────────────────────────────────────────────── */}
        <section id="shortcuts" className={card}>
          <div className="flex items-baseline justify-between">
            <h2 className="text-[13px] font-bold text-gray-900">Keyboard shortcuts</h2>
            <label className="flex items-center gap-2 text-[11px] text-gray-600">
              <input type="checkbox" checked={preferences.shortcutsEnabled} disabled={busy}
                onChange={e => save({ shortcutsEnabled: e.target.checked })} />
              On
            </label>
          </div>
          <ul className="mt-2 grid sm:grid-cols-2 gap-x-4">
            {SHORTCUTS.map(([keys, label]) => (
              <li key={keys} className="flex items-baseline gap-2 py-0.5">
                <kbd className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] text-gray-700">{keys}</kbd>
                <span className="text-[11px] text-gray-600">{label}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] text-gray-500">
            {/* The comp offers Customise. This says what it would cost. */}
            Not remappable, deliberately: a remapped shortcut is invisible to everyone else, so
            &ldquo;press g then p&rdquo; stops being true across a practice. Nothing fires while you are
            typing in a field.
          </p>
        </section>

        {/* ── Sync, devices, backup ────────────────────────────────────────────────────────────── */}
        <section id="sync" className={card}>
          <h2 className="text-[13px] font-bold text-gray-900">Sync, devices and backup</h2>
          <p className="mt-1 text-[11px] text-gray-600">
            {/* Cross-device sync is a consequence here, not a feature, and saying so is more useful than
                a sync toggle that toggles nothing. */}
            These settings are stored against you, not against this browser, so they are already the same
            on every device you sign in from. There is no sync to switch on and nothing to conflict.
          </p>
          <div className="mt-2 rounded-lg border border-dashed border-gray-200 bg-gray-50/60 p-2">
            <p className="text-[11px] font-semibold text-gray-500">Your active devices</p>
            <p className="mt-0.5 text-[10px] text-gray-500">
              A device list needs a session register, which is not built. Nothing
              here can tell you what is signed in.
            </p>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {/* A PLAIN ANCHOR, DELIBERATELY. This is a download from an API route, not a navigation to
                a page -- next/link would prefetch it and route it client-side, which is exactly what a
                file download must not do. The rule cannot tell the two apart. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/api/v1/practice/preferences?export=1"
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
              Export my settings
            </a>
            <label className="cursor-pointer rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
              Import
              <input type="file" accept="application/json" className="hidden" onChange={async e => {
                const file = e.target.files?.[0];
                if (!file) return;
                setBusy(true); setNotice(null);
                try {
                  const parsed = JSON.parse(await file.text());
                  const res = await fetch("/api/v1/practice/preferences", {
                    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed),
                  });
                  const data = await res.json().catch(() => ({}));
                  if (!res.ok) { setNotice({ kind: "err", text: data?.error?.message ?? "That file was not accepted." }); setBusy(false); return; }
                  window.location.reload();
                } catch {
                  setNotice({ kind: "err", text: "That file could not be read as JSON." });
                  setBusy(false);
                }
              }} />
            </label>
            <button type="button" onClick={reset} disabled={busy}
              className="ml-auto text-[12px] text-[var(--cmp-text-critical)] hover:underline">
              Reset everything to defaults
            </button>
          </div>
          <p className="mt-1 text-[10px] text-gray-500">
            An exported file carries your choices and no identifiers &mdash; no patient, no practice, no
            account &mdash; so it cannot be imported into the wrong place by accident.
          </p>
        </section>
      </div>

      {/* The comp's AI Configuration Assistant. */}
      <section className="mt-4 rounded-xl border border-dashed border-gray-200 bg-gray-50/60 p-4">
        <h2 className="text-[13px] font-bold text-gray-500">AI configuration assistant</h2>
        <p className="mt-1 text-[11px] text-gray-500">
          Recommended layouts, suggested shortcuts and specialty template suggestions are specified for a future assistant, which is not built. Nothing on this page was chosen for you.
        </p>
      </section>
    </>
  );
}
