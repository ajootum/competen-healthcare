"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { locationTone } from "@/app/practice/(shell)/calendar/planner-ui";

// CP-BULK-BOOKING-001 s5, s6 and s11: pick a session, fill its free slots, review, book.
//
// ⚠ EVERY ROW IS A SLOT THAT WAS ACTUALLY FREE WHEN THE PAGE LOADED, and none of them is a reservation.
// s10: "do not assume an available slot remains available merely because it was shown when the page
// loaded." The engine re-checks each one at commit and the outcome is reported per row, so a slot taken
// by the desk while this grid was being filled fails THAT row and no other.
//
// ⚠ AND NOTHING IS SILENTLY DROPPED (s12). A row that fails keeps its place, keeps its patient, and says
// why -- so the clinic list on screen never quietly becomes shorter than the one that was reviewed.

type Outcome = { clientRowId: string; ok: boolean; message?: string };
type Hit = { patientId?: string; id?: string; displayName?: string; display_name?: string; patientNumber?: string };
type Closed = { day: string; dayLabel: string; locationId: string | null; locationName: string | null; locationSlot: string | null; reason: string };
type Slot = { startsAt: string; time: string; minutes: number };
type Session = {
  day: string; dayLabel: string; locationId: string | null; locationName: string | null; slots: Slot[];
  /** #10: an open clinic with nothing free -- offered for the beyond-schedule row alone. */
  fullyBooked?: boolean;
  /** #10c: what the diary already holds for this day and place, read-only. */
  booked: { time: string; patientName: string }[];
};
type Opt = { id: string; label: string; minutes?: number | null };
type Row = {
  /** Stable row identity. A slot row uses its startsAt; a beyond-schedule row mints its own. */
  rowId: string;
  startsAt: string; time: string; minutes: number;
  patientId: string | null; patientLabel: string;
  visitTypeId: string; modeId: string; note: string;
  /**
   * Walkthrough 2026-08-17 #10 -- a row ADDED BEYOND THE SCHEDULE. The owner: "we have space for 4
   * but imagining an emergency comes, need to be able to add". Its time is typed, not a slot, and
   * it books through the SAME engine door as every other row -- checkPlacement still refuses a
   * closed practice and still warns on the diary's terms. The 2026-08-12 decision stands: a staff
   * booking outside the schedule is a practitioner saying they will see somebody then, and the
   * product does not argue with the person who knows.
   */
  extra?: boolean;
  outcome?: { ok: boolean; message?: string };
};

/** The 24-hour clock, as text -- the owner's decision of record; no native time input. */
const TIME_PATTERN = /^([01]?\d|2[0-3]):[0-5]\d$/;

/**
 * The practice-zone instant for a typed day + time. Same technique as practice-time.ts server-side:
 * take the naive UTC reading, measure the zone's offset at that instant, subtract. Kampala carries a
 * fixed offset, and for DST zones the one-step correction is exact everywhere outside the changeover
 * hour itself.
 */
function zoneOffsetMinutes(tz: string, at: Date): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(at).map(x => [x.type, x.value]));
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +(p.hour === "24" ? "0" : p.hour), +p.minute, +p.second);
  return (asUTC - at.getTime()) / 60000;
}
function startsAtFor(day: string, time: string, tz: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const naive = new Date(Date.UTC(y, m - 1, d, hh, mm));
  return new Date(naive.getTime() - zoneOffsetMinutes(tz, naive) * 60000).toISOString();
}

const PRESETS: { key: string; label: string }[] = [
  { key: "today", label: "Today" }, { key: "tomorrow", label: "Tomorrow" },
  { key: "this_week", label: "This week" }, { key: "next_week", label: "Next week" },
  { key: "custom", label: "Custom" },
];

export default function BulkWorkspace(props: {
  preset: string; fromDate: string; toDate: string; timezone: string;
  locationId: string | null;
  locations: { id: string; name: string; colorSlot: string | null }[];
  sessions: Session[];
  closed: Closed[];
  totalSlots: number;
  visitTypes: Opt[];
  modes: Opt[];
  defaultVisitTypeId: string | null;
  defaultModeId: string | null;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Session | null>(props.sessions[0] ?? null);
  const [rows, setRows] = useState<Row[]>(() => seed(props.sessions[0] ?? null, props));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function seedFor(s: Session | null) { setSelected(s); setRows(seed(s, props)); setNotice(null); }

  const filled = rows.filter(r => r.patientId);
  const failed = rows.filter(r => r.outcome && !r.outcome.ok);
  const booked = rows.filter(r => r.outcome?.ok);
  const extras = rows.filter(r => r.extra && r.patientId && !r.outcome?.ok);
  // A beyond-schedule row is sendable only once its typed time parses -- an unparseable time is worn
  // by the row (amber), never silently dropped at commit.
  const sendable = rows.filter(r => r.patientId && !r.outcome?.ok && (!r.extra || TIME_PATTERN.test(r.time)));

  const addExtraRow = () => {
    setRows(p => [...p, {
      rowId: `extra-${Date.now()}-${p.length}`,
      startsAt: "", time: "", minutes: 0,
      patientId: null, patientLabel: "",
      visitTypeId: props.defaultVisitTypeId ?? "", modeId: props.defaultModeId ?? "", note: "",
      extra: true,
    }]);
  };

  const commit = async () => {
    const toSend = sendable;
    if (!toSend.length) return;
    setBusy(true); setNotice(null);
    try {
      const res = await fetch("/api/v1/practice/bulk-booking", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rows: toSend.map(r => ({
            clientRowId: r.rowId, patientId: r.patientId,
            // #10: a typed time becomes the practice-zone instant here; a slot row keeps the
            // engine-issued one untouched.
            startsAt: r.extra ? startsAtFor(selected?.day ?? "", r.time, props.timezone) : r.startsAt,
            visitTypeId: r.visitTypeId, consultationModeId: r.modeId,
            locationId: selected?.locationId ?? null, note: r.note || null,
          })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ kind: "err", text: json?.error?.message ?? "Nothing was booked." });
        return;
      }
      const outs = (json.outcomes ?? []) as Outcome[];
      const byRow = new Map<string, { ok: boolean; message?: string }>(
        outs.map(o => [o.clientRowId, { ok: o.ok, message: o.message }]));
      setRows(prev => prev.map(r => byRow.has(r.rowId) ? { ...r, outcome: byRow.get(r.rowId) } : r));
      const okCount = outs.filter(o => o.ok).length;
      const badCount = outs.length - okCount;
      setNotice({
        kind: badCount ? "err" : "ok",
        text: badCount
          ? `${okCount} booked, ${badCount} could not be. Each row below says why -- nothing was skipped silently.`
          : `${okCount} ${okCount === 1 ? "patient" : "patients"} booked.`,
      });
      router.refresh();
    } catch {
      setNotice({ kind: "err", text: "That did not reach the server, so nothing was booked." });
    } finally { setBusy(false); }
  };

  const input = "rounded-lg border border-gray-200 px-2 py-1 text-[12.5px]";

  return (
    <div className="mt-4">
      {/* ── 1. When and where ─────────────────────────────────────────────────────────────────── */}
      <form method="get" className="flex flex-wrap items-end gap-2 rounded-xl border border-gray-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-1">
          {PRESETS.map(p => (
            <button key={p.key} type="submit" name="preset" value={p.key}
              className={`rounded-lg px-2.5 py-1.5 text-[12px] font-semibold ${props.preset === p.key
                ? "bg-[var(--cp-primary)] text-white"
                : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"}`}>
              {p.label}
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-[10.5px] font-semibold text-gray-500">From</span>
          <input type="date" name="from" defaultValue={props.fromDate} className={input} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10.5px] font-semibold text-gray-500">To</span>
          <input type="date" name="to" defaultValue={props.toDate} className={input} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10.5px] font-semibold text-gray-500">Location</span>
          <select name="location" defaultValue={props.locationId ?? ""} className={input}>
            <option value="">All locations</option>
            {props.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <button type="submit" className="rounded-lg bg-[var(--cp-primary)] px-3.5 py-1.5 text-[12.5px] font-semibold text-white hover:bg-[var(--cp-primary-deep)]">
          Apply
        </button>
        <span className="ml-auto text-[11.5px] text-gray-500">Times in {props.timezone}</span>
      </form>

      {/* ── 2. The sessions that period actually holds ────────────────────────────────────────── */}
      {props.sessions.length === 0 ? (
        <p className="mt-3 rounded-xl border border-gray-200 bg-white p-4 text-[13px] text-gray-600">
          No sessions with free appointments in this period{props.locationId ? " at that location" : ""}.
          This period was read successfully &mdash; widen the dates, choose another location, or open the
          Practice Planner to add a session.
          {props.closed.length > 0 && " Some clinics below exist but are not open to booking."}
        </p>
      ) : null}

      {/* ── One grid for EVERY card -- bookable, full, and closed (#12: "spread this out into 5
          columns rather than 3 and 2"). Two stacked flex rows drew a week as two shelves; a single
          grid draws it as one week. The closed cards keep their inert dashed style INSIDE the same
          grid -- sharing a container adds no bookability. */}
      {(props.sessions.length > 0 || props.closed.length > 0) && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          {props.sessions.map(s => {
            const tone = locationTone(s.locationId, props.locations.find(l => l.id === s.locationId)?.colorSlot ?? null);
            const active = selected?.day === s.day && selected?.locationId === s.locationId;
            return (
              <button key={`${s.day}|${s.locationId}`} type="button" onClick={() => seedFor(s)}
                className={`rounded-xl border px-3 py-2 text-left ${active ? "border-[var(--cp-primary)] ring-1 ring-[var(--cp-primary)]" : "border-gray-200 hover:border-gray-300"} bg-white`}>
                <div className="text-[12.5px] font-bold text-gray-900">{s.dayLabel}</div>
                <div className={`mt-0.5 flex items-center gap-1.5 text-[11.5px] font-semibold ${tone.place}`}>
                  <span aria-hidden="true" className={`h-2 w-2 rounded-full ${tone.dot}`} />
                  {s.locationName ?? "no location named"}
                </div>
                <div className={`mt-0.5 text-[11px] ${s.fullyBooked ? "font-semibold text-amber-700" : "text-gray-500"}`}>
                  {s.fullyBooked
                    ? `Fully booked (${s.booked.length}) -- beyond-schedule only`
                    : `${s.slots.length} free ${s.slots.length === 1 ? "slot" : "slots"}${s.booked.length ? ` · ${s.booked.length} booked` : ""}`}
                </div>
              </button>
            );
          })}

      {/* ── 2b. CLINICS THAT EXIST AND ARE NOT OPEN TO BOOKING ────────────────────────────────────
          The owner, 2026-08-12: Friday and Saturday at TMR were simply absent, which reads as "no clinic
          that day". They exist -- their sessions carry booking_mode `none`, which the practitioner set.
          A closed clinic and an absent clinic are different facts and were being drawn identically.

          ⚠ INERT ON PURPOSE. These are not buttons and nothing here becomes bookable: the engine's
          decision is unchanged and only the silence about it is. Making them selectable would put the
          screen back to offering times the control would then refuse -- which is the failure the
          availability engine's own header warns about. */}
          {props.closed.map(c => {
            const tone = locationTone(c.locationId, c.locationSlot);
            return (
              <div key={`${c.day}|${c.locationId}`}
                className="rounded-xl border border-dashed border-gray-300 bg-gray-50/70 px-3 py-2">
                <div className="text-[12.5px] font-bold text-gray-500">{c.dayLabel}</div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-gray-500">
                  <span aria-hidden="true" className={`h-2 w-2 rounded-full ${tone.dot} opacity-40`} />
                  {c.locationName ?? "no location named"}
                </div>
                <div className="mt-0.5 text-[11px] italic text-gray-500">{c.reason}</div>
              </div>
            );
          })}
        </div>
      )}
      {props.closed.length > 0 && (
        <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
          These clinics are in the diary and closed to booking. Change that on the session itself in
          the Practice Planner &mdash; nothing on this screen can book into them.
        </p>
      )}

      {/* ── 3. The grid ───────────────────────────────────────────────────────────────────────── */}
      {selected && (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_260px]">
          {/* min-w-0 -- see PathwaysWorkspace: the inner overflow-x-auto cannot engage without it. */}
          <section className="min-w-0 rounded-xl border border-gray-200 bg-white">
            <div className="border-b border-gray-100 px-4 py-2.5">
              <h2 className="text-[13.5px] font-bold text-gray-900">{selected.dayLabel}</h2>
              <p className="text-[11.5px] text-gray-500">
                {selected.locationName ?? "no location named"} &middot;{" "}
                {selected.fullyBooked ? "fully booked -- add beyond the schedule below" : `${selected.slots.length} free slots`}
              </p>
            </div>
            {/* ── #10c: WHAT THE DIARY ALREADY HOLDS, read-only, above the input rows -- a
                squeeze-in decision is made looking at the day, not beside it. */}
            {selected.booked.length > 0 && (
              <div className="border-b border-gray-100 bg-gray-50/60 px-4 py-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.06em] text-gray-500">Already booked</p>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
                  {selected.booked.map((b, i) => (
                    <span key={i} className="text-[11.5px] text-gray-600">
                      <span className="font-semibold tabular-nums text-gray-800">{b.time}</span> {b.patientName}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {rows.length === 0 && (
              <p className="px-4 py-3 text-[12.5px] text-gray-600">
                Every scheduled time is taken. The day is not closed &mdash; add an emergency or a
                squeeze-in beyond the schedule below.
              </p>
            )}
            <div className={`overflow-x-auto ${rows.length === 0 ? "hidden" : ""}`}>
              <table className="w-full border-collapse">
                <thead className="bg-gray-50/80">
                  <tr>
                    {["Time", "Patient", "Visit type", "Mode", "Note", ""].map(h => (
                      <th key={h} className="px-3 py-2 text-left text-[10.5px] font-bold uppercase tracking-[0.06em] text-gray-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.rowId} className={`border-t border-gray-100 ${r.outcome?.ok ? "bg-emerald-50/50" : r.outcome ? "bg-rose-50/50" : r.extra ? "bg-amber-50/40" : ""}`}>
                      <td className="whitespace-nowrap px-3 py-2 text-[13px] font-semibold tabular-nums text-gray-900">
                        {r.extra ? (
                          <>
                            <input value={r.time} disabled={busy || r.outcome?.ok === true}
                              aria-label="Time (24-hour)" placeholder="e.g. 13:15" inputMode="numeric"
                              onChange={e => setRows(p => p.map((x, j) => j === i ? { ...x, time: e.target.value } : x))}
                              className={`${input} w-20 ${TIME_PATTERN.test(r.time) ? "" : "border-amber-300 bg-[var(--cmp-surface-warning)]"}`} />
                            <span className="mt-0.5 block text-[9.5px] font-normal uppercase tracking-wide text-amber-700">beyond schedule</span>
                          </>
                        ) : r.time}
                      </td>
                      <td className="px-3 py-2">
                        <PatientPicker value={r.patientLabel} disabled={busy || r.outcome?.ok === true}
                          onPick={(id, label) => setRows(p => p.map((x, j) => j === i ? { ...x, patientId: id, patientLabel: label } : x))} />
                        {r.outcome && !r.outcome.ok && (
                          <p className="mt-1 text-[11px] font-semibold text-[var(--cmp-text-critical)]">{r.outcome.message}</p>
                        )}
                        {r.outcome?.ok && <p className="mt-1 text-[11px] font-semibold text-emerald-700">booked</p>}
                      </td>
                      <td className="px-3 py-2">
                        <select value={r.visitTypeId} disabled={busy || r.outcome?.ok === true} className={input}
                          onChange={e => setRows(p => p.map((x, j) => j === i ? { ...x, visitTypeId: e.target.value } : x))}>
                          {props.visitTypes.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <select value={r.modeId} disabled={busy || r.outcome?.ok === true} className={input}
                          onChange={e => setRows(p => p.map((x, j) => j === i ? { ...x, modeId: e.target.value } : x))}>
                          {props.modes.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input value={r.note} disabled={busy || r.outcome?.ok === true} placeholder="Optional"
                          onChange={e => setRows(p => p.map((x, j) => j === i ? { ...x, note: e.target.value } : x))}
                          className={`${input} w-full`} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        {r.extra && !r.outcome?.ok ? (
                          <button type="button" disabled={busy} title="Remove this beyond-schedule row"
                            onClick={() => setRows(p => p.filter((_, j) => j !== i))}
                            className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] text-gray-500 hover:bg-gray-50">
                            Remove
                          </button>
                        ) : r.patientId && !r.outcome?.ok ? (
                          <button type="button" disabled={busy} title="Clear this row"
                            onClick={() => setRows(p => p.map((x, j) => j === i ? { ...x, patientId: null, patientLabel: "", outcome: undefined } : x))}
                            className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] text-gray-500 hover:bg-gray-50">
                            Clear
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* ── #10: THE DOOR BEYOND THE SCHEDULE ─────────────────────────────────────────────
                Drawn on every selected session -- including a fully-booked one, which is the day
                this exists for. The row it adds books through the same engine as every slot row:
                nothing here bypasses checkPlacement, and a refusal lands on the row and says why. */}
            <div className="border-t border-gray-100 px-4 py-2.5">
              <button type="button" disabled={busy} onClick={addExtraRow}
                className="rounded-lg border border-dashed border-amber-300 px-3 py-1.5 text-[12px] font-semibold text-amber-800 hover:bg-amber-50">
                + Add beyond the schedule
              </button>
              <span className="ml-2 text-[11px] text-gray-500">
                For an emergency or a squeeze-in: type the time yourself, outside or between the slots.
              </span>
            </div>
          </section>

          {/* ── 4. s11's summary ────────────────────────────────────────────────────────────── */}
          <aside className="h-fit rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-[13px] font-bold text-gray-900">Booking summary</h2>
            <dl className="mt-2 space-y-1.5 text-[12.5px]">
              <Line label="Free slots" value={selected.slots.length} />
              <Line label="Patients added" value={filled.length} />
              {/* #10: counted apart from the slots on purpose -- a squeeze-in must never make the
                  free-slot arithmetic above claim capacity the schedule does not have. */}
              {extras.length > 0 && <Line label="Beyond schedule" value={extras.length} tone="text-amber-700" />}
              <Line label="Booked" value={booked.length} tone="text-emerald-700" />
              <Line label="Need attention" value={failed.length} tone={failed.length ? "text-[var(--cmp-text-critical)]" : undefined} />
            </dl>
            {notice && (
              <p role="status" className={`mt-3 rounded-lg px-2.5 py-2 text-[12px] ${notice.kind === "ok"
                ? "bg-emerald-50 text-emerald-800" : "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"}`}>
                {notice.text}
              </p>
            )}
            <button type="button" onClick={commit}
              disabled={busy || sendable.length === 0}
              className="mt-3 w-full rounded-lg bg-[var(--cp-primary)] py-2 text-[12.5px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50">
              {busy ? "Booking..." : `Review & book ${sendable.length} ${sendable.length === 1 ? "patient" : "patients"}`}
            </button>
            {filled.filter(r => !r.outcome?.ok).length > sendable.length && (
              <p className="mt-1.5 text-[11px] font-semibold text-[var(--cmp-text-warning)]">
                A beyond-schedule row needs its time (24-hour, e.g. 13:15) before it can book.
              </p>
            )}
            <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
              Each booking is its own appointment record. A slot taken by somebody else in the meantime
              fails that row alone and says so.
            </p>
          </aside>
        </div>
      )}
    </div>
  );
}

function Line({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-gray-600">{label}</dt>
      <dd className={`font-bold ${tone ?? "text-gray-900"}`}>{value}</dd>
    </div>
  );
}

function seed(s: Session | null, props: { defaultVisitTypeId: string | null; defaultModeId: string | null }): Row[] {
  if (!s) return [];
  return s.slots.map(slot => ({
    rowId: slot.startsAt,
    startsAt: slot.startsAt, time: slot.time, minutes: slot.minutes,
    patientId: null, patientLabel: "",
    visitTypeId: props.defaultVisitTypeId ?? "", modeId: props.defaultModeId ?? "", note: "",
  }));
}

/**
 * s7: search by name and patient number, scoped to the practice and the caller's permissions.
 *
 * ⚠ IT CALLS THE EXISTING /patients ENDPOINT rather than adding a bulk-specific search. That endpoint
 * already returns `complete`, which says whether the identifier probe succeeded -- a second search
 * implementation would be a second place for that distinction to be lost.
 */
function PatientPicker({ value, disabled, onPick }: {
  value: string; disabled?: boolean; onPick: (id: string, label: string) => void;
}) {
  const [q, setQ] = useState(value);
  const [hits, setHits] = useState<{ id: string; label: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [incomplete, setIncomplete] = useState(false);

  const search = async (text: string) => {
    setQ(text); setOpen(true);
    if (text.trim().length < 2) { setHits([]); return; }
    try {
      const res = await fetch(`/api/v1/practice/patients?q=${encodeURIComponent(text.trim())}`);
      const json = await res.json().catch(() => ({}));
      setIncomplete(json?.complete === false);
      setHits(((json?.results ?? []) as Hit[]).slice(0, 8).map(r => ({
        id: String(r.patientId ?? r.id ?? ""),
        label: `${r.displayName ?? r.display_name ?? "unnamed"}${r.patientNumber ? ` (${r.patientNumber})` : ""}`,
      })));
    } catch { setHits([]); }
  };

  if (value && !open)
    return <span className="text-[12.5px] font-semibold text-gray-900">{value}</span>;

  return (
    <div className="relative">
      <input value={q} disabled={disabled} placeholder="Search patient..."
        onChange={e => search(e.target.value)} onFocus={() => setOpen(true)}
        className="w-full rounded-lg border border-gray-200 px-2 py-1 text-[12.5px]" />
      {open && hits.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          {hits.map(h => (
            <li key={h.id}>
              <button type="button" className="block w-full px-2 py-1.5 text-left text-[12px] hover:bg-gray-50"
                onClick={() => { onPick(h.id, h.label); setOpen(false); setQ(h.label); }}>
                {h.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {/* ⚠ AN INCOMPLETE SEARCH SAYS SO. Otherwise "no results" reads as "not registered", and somebody
          registers a patient who already exists. */}
      {open && incomplete && (
        <p className="mt-0.5 text-[10.5px] text-[var(--cmp-text-warning)]">
          This search was incomplete &mdash; absence here is not proof the patient is unregistered.
        </p>
      )}
    </div>
  );
}
