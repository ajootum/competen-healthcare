"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import SessionCard from "./SessionCard";

/* eslint-disable @typescript-eslint/no-explicit-any */

// CPR-SCH-002 — the weekly schedule board, the module's primary interaction.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// "Replace 'Regular Week' with a large visual Monday–Sunday calendar" and "Use practitioner language
// instead of technical scheduling terms."
//
// So: Your Weekly Schedule, working days, day off. Not templates, not slot kinds, not generation. The
// engine still calls them templates because that is what they are to a generator; nobody configuring a
// Tuesday needs to know that.
//
// COLOUR IS PER LOCATION, NOT PER COLUMN. The comp gives each card a colour, and assigning by position
// would make Monday green because it is first. Keyed on the place, two days at the same hospital carry
// the same colour and a week split across three sites reads as three colours before a word of it does.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

const DAYS = [
  [1, "MON"], [2, "TUE"], [3, "WED"], [4, "THU"], [5, "FRI"], [6, "SAT"], [7, "SUN"],
] as const;

const PLACE_HUES = [
  "var(--cp-primary)", "var(--cp-success)", "var(--cp-accent)",
  "var(--cp-warning)", "var(--cp-info)", "#7C3AED",
];

const toMinutes = (v: string) => {
  const [h, m] = v.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

export default function WeekBoard({ sessions, locations, clinics }: {
  sessions: any[]; locations: any[]; clinics: any[];
}) {
  const router = useRouter();
  const [addingTo, setAddingTo] = useState<number | null>(null);
  const [copyFrom, setCopyFrom] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [draft, setDraft] = useState({ from: "09:00", to: "13:00", locationId: locations[0]?.id ?? "" });

  // Stable per-place colour across the whole board.
  const placeOrder = [...new Set(sessions.map(s => s.location_id).filter(Boolean))] as string[];
  const hueFor = (locationId: string | null) => {
    const i = locationId ? placeOrder.indexOf(locationId) : -1;
    return i === -1 ? "var(--cp-slate-400)" : PLACE_HUES[i % PLACE_HUES.length];
  };

  async function send(payload: Record<string, unknown>, describe: (d: any) => string) {
    setBusy(true); setNotice(null);
    const res = await fetch("/api/v1/practice/availability-config", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setNotice({ kind: "err", text: data?.error?.message ?? "That did not work." }); return; }
    setNotice({ kind: "ok", text: describe(data) });
    setAddingTo(null);
    router.refresh();
  }

  const workingDays = new Set(sessions.map(s => s.weekday));
  const daysWithWork = DAYS.filter(([n]) => workingDays.has(n)).map(([n, l]) => ({ n, l }));

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--cp-primary)]/12 text-[14px] text-[var(--cp-primary-deep)]">▤</span>
        <div className="min-w-0">
          <h2 className="text-[15px] font-bold text-gray-900">Your weekly schedule</h2>
          <p className="text-[11px] text-gray-500">Click a day to add or edit your working hours.</p>
        </div>

        {/* COPY A DAY, which is the comp's "Copy from…". It goes through the same duplicate that the
            card menu uses, so it obeys the same conflict rules -- copying Tuesday onto a day you are
            already at another hospital is refused, and says which. */}
        {daysWithWork.length > 0 && (
          <select value={copyFrom} disabled={busy}
            onChange={e => {
              const [fromDay, toDay] = e.target.value.split(">").map(Number);
              setCopyFrom("");
              if (!fromDay || !toDay) return;
              const source = sessions.find(s => s.weekday === fromDay);
              if (!source) return;
              void send({ action: "duplicate_session", templateId: source.id, toWeekdays: [toDay] },
                d => {
                  const r = d.duplicate?.refused ?? [];
                  return r.length ? `Not copied — ${r[0].reason}` : "Copied.";
                });
            }}
            className="ml-auto rounded-lg border border-gray-200 px-2.5 py-2 text-[12px] text-gray-700"
            aria-label="Copy a day's schedule to another day">
            <option value="">Copy a day to…</option>
            {daysWithWork.map(src => DAYS.filter(([n]) => n !== src.n).map(([n, l]) => (
              <option key={`${src.n}>${n}`} value={`${src.n}>${n}`}>{src.l} → {l}</option>
            )))}
          </select>
        )}
        <button type="button" onClick={() => setAddingTo(addingTo === null ? 1 : null)}
          className="rounded-lg bg-[var(--cp-primary)] px-3 py-2 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)]">
          + Add working day
        </button>
      </div>

      {notice && (
        <p className={`mb-2 rounded-lg px-3 py-2 text-[12px] ${notice.kind === "ok"
          ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-900"}`}>
          {notice.text}
        </p>
      )}

      {/* ── The board ─────────────────────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {DAYS.map(([n, label]) => {
          const onThisDay = sessions.filter(s => s.weekday === n);
          const dayOff = onThisDay.length === 0;
          return (
            <div key={n} className={`min-h-[190px] rounded-xl border p-2 ${
              dayOff ? "border-dashed border-gray-200 bg-[var(--cp-canvas)]" : "border-gray-200 bg-white"}`}>
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">{label}</p>

              {dayOff ? (
                <button type="button" onClick={() => { setAddingTo(n); setNotice(null); }}
                  className="flex h-[130px] w-full flex-col items-center justify-center gap-1 rounded-lg text-gray-400 hover:bg-white hover:text-[var(--cp-primary)]">
                  <span aria-hidden className="text-[18px]">＋</span>
                  <span className="text-[10px]">Day off</span>
                </button>
              ) : (
                <ul className="space-y-1.5">
                  {onThisDay.map((s: any) => (
                    <SessionCard key={s.id} session={s}
                      locations={locations} kindHue={hueFor(s.location_id)} />
                  ))}
                  {/* Multiple sessions per day, which the specification asks for explicitly. */}
                  <li>
                    <button type="button" onClick={() => { setAddingTo(n); setNotice(null); }}
                      className="w-full rounded-lg border border-dashed border-gray-200 py-1 text-[10px] text-gray-400 hover:border-[var(--cp-primary)]/40 hover:text-[var(--cp-primary)]">
                      + Add time
                    </button>
                  </li>
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Adding a working day ───────────────────────────────────────────────────────────────── */}
      {addingTo !== null && (
        <form className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-[var(--cp-primary)]/25 bg-[var(--cp-primary)]/[0.04] p-3"
          onSubmit={e => {
            e.preventDefault();
            void send({
              action: "add_session", weekday: addingTo,
              startsMinute: toMinutes(draft.from), endsMinute: toMinutes(draft.to),
              locationId: draft.locationId || null,
            }, d => `Added.${d.generation?.slotsCreated ? ` ${d.generation.slotsCreated} bookable slot${d.generation.slotsCreated === 1 ? "" : "s"} created.` : ""}`);
          }}>
          <label className="flex flex-col text-[10px] font-semibold text-gray-600">
            Day
            <select value={addingTo} onChange={e => setAddingTo(Number(e.target.value))}
              className="mt-0.5 rounded-lg border border-gray-200 px-2 py-1.5 text-[12px]">
              {DAYS.map(([n, l]) => <option key={n} value={n}>{l}</option>)}
            </select>
          </label>
          <label className="flex flex-col text-[10px] font-semibold text-gray-600">
            From
            <input type="time" required value={draft.from}
              onChange={e => setDraft(d => ({ ...d, from: e.target.value }))}
              className="mt-0.5 rounded-lg border border-gray-200 px-2 py-1.5 text-[12px]" />
          </label>
          <label className="flex flex-col text-[10px] font-semibold text-gray-600">
            To
            <input type="time" required value={draft.to}
              onChange={e => setDraft(d => ({ ...d, to: e.target.value }))}
              className="mt-0.5 rounded-lg border border-gray-200 px-2 py-1.5 text-[12px]" />
          </label>
          <label className="flex min-w-[160px] flex-1 flex-col text-[10px] font-semibold text-gray-600">
            Where
            <select value={draft.locationId} onChange={e => setDraft(d => ({ ...d, locationId: e.target.value }))}
              className="mt-0.5 rounded-lg border border-gray-200 px-2 py-1.5 text-[12px]">
              <option value="">Not said</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <button type="submit" disabled={busy}
            className="rounded-lg bg-[var(--cp-primary)] px-4 py-2 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50">
            {busy ? "Saving…" : "Add"}
          </button>
          <button type="button" onClick={() => setAddingTo(null)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-[12px] text-gray-600">Cancel</button>
        </form>
      )}

      <p className="mt-2.5 text-[10px] leading-relaxed text-gray-400">
        This is your regular week — a day and a time, not fifty-two copies, so changing Tuesday changes
        every Tuesday. Holidays, leave and one-off clinics go in the next step. Changes save as you make
        them and the bookable slots are rebuilt straight away.
      </p>

      {clinics.length > 0 && (
        <p className="mt-1 text-[10px] text-gray-400">
          {clinics.length} clinic{clinics.length === 1 ? "" : "s"} configured inside your locations.
        </p>
      )}
    </section>
  );
}
