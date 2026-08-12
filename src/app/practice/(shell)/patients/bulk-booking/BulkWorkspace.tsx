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
type Slot = { startsAt: string; time: string; minutes: number };
type Session = { day: string; dayLabel: string; locationId: string | null; locationName: string | null; slots: Slot[] };
type Opt = { id: string; label: string; minutes?: number | null };
type Row = {
  startsAt: string; time: string; minutes: number;
  patientId: string | null; patientLabel: string;
  visitTypeId: string; modeId: string; note: string;
  outcome?: { ok: boolean; message?: string };
};

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

  const commit = async () => {
    const toSend = rows.filter(r => r.patientId && !r.outcome?.ok);
    if (!toSend.length) return;
    setBusy(true); setNotice(null);
    try {
      const res = await fetch("/api/v1/practice/bulk-booking", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rows: toSend.map(r => ({
            clientRowId: r.startsAt, patientId: r.patientId, startsAt: r.startsAt,
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
      setRows(prev => prev.map(r => byRow.has(r.startsAt) ? { ...r, outcome: byRow.get(r.startsAt) } : r));
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
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
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
                <div className="mt-0.5 text-[11px] text-gray-500">
                  {s.slots.length} free {s.slots.length === 1 ? "slot" : "slots"}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* ── 3. The grid ───────────────────────────────────────────────────────────────────────── */}
      {selected && (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_260px]">
          <section className="rounded-xl border border-gray-200 bg-white">
            <div className="border-b border-gray-100 px-4 py-2.5">
              <h2 className="text-[13.5px] font-bold text-gray-900">{selected.dayLabel}</h2>
              <p className="text-[11.5px] text-gray-500">
                {selected.locationName ?? "no location named"} &middot; {selected.slots.length} free slots
              </p>
            </div>
            <div className="overflow-x-auto">
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
                    <tr key={r.startsAt} className={`border-t border-gray-100 ${r.outcome?.ok ? "bg-emerald-50/50" : r.outcome ? "bg-rose-50/50" : ""}`}>
                      <td className="whitespace-nowrap px-3 py-2 text-[13px] font-semibold tabular-nums text-gray-900">{r.time}</td>
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
                        {r.patientId && !r.outcome?.ok && (
                          <button type="button" disabled={busy} title="Clear this row"
                            onClick={() => setRows(p => p.map((x, j) => j === i ? { ...x, patientId: null, patientLabel: "", outcome: undefined } : x))}
                            className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] text-gray-500 hover:bg-gray-50">
                            Clear
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── 4. s11's summary ────────────────────────────────────────────────────────────── */}
          <aside className="h-fit rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-[13px] font-bold text-gray-900">Booking summary</h2>
            <dl className="mt-2 space-y-1.5 text-[12.5px]">
              <Line label="Free slots" value={selected.slots.length} />
              <Line label="Patients added" value={filled.length} />
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
              disabled={busy || filled.filter(r => !r.outcome?.ok).length === 0}
              className="mt-3 w-full rounded-lg bg-[var(--cp-primary)] py-2 text-[12.5px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50">
              {busy ? "Booking..." : `Review & book ${filled.filter(r => !r.outcome?.ok).length} patients`}
            </button>
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
