"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type {
  HqAppointmentBoard, HqHolderView, HqPositionView, HqSpaceView, Read,
} from "@/lib/hq/appointments";
import { HQ_END_STATUSES, STATUS_LABEL, STATUS_MEANING } from "@/lib/hq/appointments";

/**
 * The HQ appointment board.
 *
 * ⚠ THREE STATES, EVERY TIME. Each section is a Read<T>: it has rows, it is genuinely empty, or it could
 * not be read — and the third one never renders as the second. `Unreadable` is the component that says so.
 *
 * ⚠ EVERY FIGURE IS THE LENGTH OF A LIST YOU CAN OPEN. There is no count on this screen that is not the
 * summary line of a <details> containing the rows it counted.
 *
 * ⚠ SUSPENDED AND NOMINATED HOLDERS ARE SHOWN, MARKED. Suspension is a fact about a named person that the
 * people running this platform need to see; hiding it would make the roster disagree with the database.
 * What suspension changes is ACCESS, and that is what the badge says.
 */

export type PersonOption = { id: string; name: string | null; email: string | null; role: string | null };

type Props = {
  board: HqAppointmentBoard;
  people: Read<PersonOption[]>;
  canAppoint: boolean;
  viewerId: string;
  viewerName: string | null;
  holdingNow: number | null;
  onRosterOnly: number | null;
};

const Unreadable = ({ what, error }: { what: string; error: string }) => (
  <p className="text-sm rounded-lg px-3 py-2 bg-[var(--cmp-surface-warning)] text-amber-900">
    <span className="font-semibold">{what} could not be read.</span>{" "}
    This is not a zero — nothing here is a count of anything. <span className="text-amber-800/80">({error})</span>
  </p>
);

const StatusBadge = ({ status, grantsAccess }: { status: string; grantsAccess: boolean }) => (
  <span
    title={STATUS_MEANING[status] ?? "This status is not one the platform recognises, and it grants nothing."}
    className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
      grantsAccess ? "bg-[var(--cmp-surface-success)] text-green-800" : "bg-gray-100 text-gray-600"
    }`}
  >
    {STATUS_LABEL[status] ?? status}
  </span>
);

function HolderRow({ h, canAppoint, onEnd, busy }: {
  h: HqHolderView; canAppoint: boolean; busy: string | null;
  onEnd: (h: HqHolderView, status: string) => void;
}) {
  const [status, setStatus] = useState<string>("removed");
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-t border-gray-50 first:border-0">
      <span className="font-medium text-gray-900 text-sm">{h.personName ?? <span className="text-gray-400">Name not recorded</span>}</span>
      <StatusBadge status={h.status} grantsAccess={h.grantsAccess} />
      <span className="text-[11px] text-gray-400">
        {h.termStart ? `from ${h.termStart}` : "no start date recorded"}
        {h.termEnd ? ` to ${h.termEnd}` : ""}
        {h.appointedBy ? ` · appointed by ${h.appointedBy}` : ""}
      </span>
      {canAppoint && h.status !== "removed" && (
        <span className="ml-auto flex items-center gap-1.5">
          <select
            value={status} onChange={e => setStatus(e.target.value)} aria-label="End status"
            className="border border-gray-300 rounded-lg px-2 py-1 text-[11px]"
          >
            {HQ_END_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s] ?? s}</option>)}
          </select>
          <button
            onClick={() => onEnd(h, status)} disabled={busy === h.appointmentId}
            className="text-[11px] font-medium rounded-lg border border-[var(--cmp-color-error)] text-[var(--cmp-text-error)] hover:bg-[var(--cmp-surface-error)] px-2.5 py-1 disabled:opacity-40"
          >
            Set status
          </button>
        </span>
      )}
    </div>
  );
}

function PositionCard({ p, canAppoint, people, busy, onAppoint, onEnd, spaceStaffable }: {
  p: HqPositionView; canAppoint: boolean; people: Read<PersonOption[]>; busy: string | null;
  spaceStaffable: boolean;
  onAppoint: (positionCode: string, personId: string, termEnd: string) => void;
  onEnd: (h: HqHolderView, status: string) => void;
}) {
  const [person, setPerson] = useState("");
  const [termEnd, setTermEnd] = useState("");
  const holders = p.holders;
  const live = holders.ok ? holders.value.filter(h => h.grantsAccess) : [];
  const other = holders.ok ? holders.value.filter(h => !h.grantsAccess) : [];

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-100">
        <span className="font-semibold text-gray-900">{p.name}</span>
        <code className="text-[10px] text-gray-500 bg-gray-50 rounded px-1.5 py-0.5">{p.code}</code>
        {!p.isActive && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[var(--cmp-surface-warning)] text-amber-900">
            Deactivated — grants nothing while it stays this way
          </span>
        )}
        {holders.ok && (
          <span className="ml-auto text-[11px] text-gray-500">
            {live.length} holding now{other.length ? ` · ${other.length} on the roster without access` : ""}
          </span>
        )}
      </div>

      {p.description && <p className="px-4 pt-3 text-[12px] text-gray-500">{p.description}</p>}

      {/* What the position actually grants. The figure is the summary of the list it counts. */}
      <div className="px-4 py-3">
        {p.capabilities.ok ? (
          <details className="group">
            <summary className="cursor-pointer text-[12px] text-teal-700 hover:underline">
              {p.capabilities.value.length === 0
                ? "This position grants no capability at all — appointing to it opens nothing"
                : `Grants ${p.capabilities.value.filter(c => c.inWindow).length} capabilit${p.capabilities.value.filter(c => c.inWindow).length === 1 ? "y" : "ies"} today${
                    p.capabilities.value.some(c => !c.inWindow) ? ` (${p.capabilities.value.filter(c => !c.inWindow).length} out of date window)` : ""
                  } — open the list`}
            </summary>
            <ul className="mt-2 space-y-1">
              {p.capabilities.value.map(c => (
                <li key={c.code} className="flex flex-wrap items-baseline gap-2 text-[12px]">
                  <code className={c.inWindow ? "text-gray-800" : "text-gray-400 line-through"}>{c.code}</code>
                  {c.label && <span className="text-gray-500">{c.label}</span>}
                  {!c.inWindow && (
                    <span className="text-[10px] text-amber-800">
                      outside its window{c.effectiveFrom ? ` (from ${c.effectiveFrom.slice(0, 10)}` : ""}{c.effectiveTo ? ` to ${c.effectiveTo.slice(0, 10)})` : c.effectiveFrom ? ")" : ""}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </details>
        ) : <Unreadable what="What this position grants" error={p.capabilities.error} />}
      </div>

      {/* Who holds it. */}
      <div className="border-t border-gray-100">
        {!holders.ok ? <div className="p-3"><Unreadable what="Who holds this position" error={holders.error} /></div>
          : holders.value.length === 0
            ? <p className="px-4 py-3 text-[12px] text-gray-400">Nobody has ever been appointed to this position.</p>
            : <div>{holders.value.map(h => <HolderRow key={h.appointmentId} h={h} canAppoint={canAppoint} busy={busy} onEnd={onEnd} />)}</div>}
      </div>

      {canAppoint && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-gray-100 bg-gray-50/60 rounded-b-xl">
          {!people.ok ? <Unreadable what="The list of people" error={people.error} /> : (
            <>
              <select
                value={person} onChange={e => setPerson(e.target.value)} aria-label={`Person to appoint as ${p.name}`}
                className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm min-w-56"
              >
                <option value="">Choose a person…</option>
                {people.value.map(pe => (
                  <option key={pe.id} value={pe.id}>
                    {pe.name ?? pe.email ?? pe.id}{pe.role ? ` — ${pe.role}` : ""}
                  </option>
                ))}
              </select>
              <label className="text-[11px] text-gray-500 flex items-center gap-1">
                Term ends
                <input
                  type="date" value={termEnd} onChange={e => setTermEnd(e.target.value)}
                  className="border border-gray-300 rounded-lg px-2 py-1 text-[11px]"
                />
                <span className="text-gray-400">(optional)</span>
              </label>
              <button
                onClick={() => onAppoint(p.code, person, termEnd)}
                disabled={!person || busy === p.code || !p.isActive || !spaceStaffable}
                className="text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white rounded-lg px-3 py-1.5 disabled:opacity-40"
              >
                Appoint
              </button>
              {!p.isActive && <span className="text-[11px] text-amber-800">This position is deactivated, so it cannot be filled.</span>}
              {p.isActive && !spaceStaffable && <span className="text-[11px] text-amber-800">This space has no usable office row, so it cannot be staffed.</span>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

type FlatHolder = { h: HqHolderView; position: string; space: string };

/**
 * A figure and the list it counts, in one component — so there is no way to render the number without
 * rendering the rows behind it. ⚠ n === null means UNREADABLE, and it never renders as 0.
 */
function Figure({ n, one, many, rows }: { n: number | null; one: string; many: string; rows: FlatHolder[] }) {
  if (n === null) return <p className="text-sm text-amber-900">Some of this could not be read, so there is no figure to give.</p>;
  return (
    <details>
      <summary className="cursor-pointer text-sm text-gray-800">
        <span className="font-bold text-lg text-gray-900">{n}</span>{" "}
        <span className="text-gray-600">{n === 1 ? one : many}</span>
      </summary>
      {rows.length === 0 ? <p className="mt-2 text-[12px] text-gray-400">The list is empty.</p> : (
        <ul className="mt-2 space-y-1">
          {rows.map(r => (
            <li key={r.h.appointmentId} className="text-[12px] text-gray-700 flex flex-wrap items-center gap-2">
              <span className="font-medium">{r.h.personName ?? "Name not recorded"}</span>
              <span className="text-gray-400">{r.position} · {r.space}</span>
              <StatusBadge status={r.h.status} grantsAccess={r.h.grantsAccess} />
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

function SpaceSection({ s, ...rest }:{ s: HqSpaceView } & Omit<Parameters<typeof PositionCard>[0], "p" | "spaceStaffable">) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-base font-bold text-gray-900">{s.label} space</h2>
        <span className="text-[11px] text-gray-400">
          {s.officeId ? `${s.officeName ?? "office"} · ${s.officeStatus ?? "status not recorded"}` : "no office row"}
        </span>
        {!s.officeUsable && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[var(--cmp-surface-warning)] text-amber-900">
            Not staffable
          </span>
        )}
      </div>
      {s.officeNote && <p className="text-[12px] text-amber-900 bg-[var(--cmp-surface-warning)] rounded-lg px-3 py-2">{s.officeNote}</p>}
      {!s.positions.ok ? <Unreadable what={`Positions in the ${s.label} space`} error={s.positions.error} />
        : s.positions.value.length === 0
          ? <p className="text-[12px] text-gray-400">No position is defined in this space.</p>
          : <div className="space-y-3">
              {s.positions.value.map(p => <PositionCard key={p.code} p={p} spaceStaffable={s.officeUsable} {...rest} />)}
            </div>}
    </section>
  );
}

export default function AppointmentsBoard({ board, people, canAppoint, viewerId, viewerName, holdingNow, onRosterOnly }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const say = (k: "ok" | "err", t: string) => { setMsg({ k, t }); };

  // Flattened for the summary lists. Only ever built from sections that READ — an unreadable section
  // makes the corresponding figure null, which renders as "could not be read" rather than as 0.
  const flat: FlatHolder[] = [];
  let anyUnreadable = false;
  if (board.spaces.ok) {
    for (const s of board.spaces.value) {
      if (!s.positions.ok) { anyUnreadable = true; continue; }
      for (const p of s.positions.value) {
        if (!p.holders.ok) { anyUnreadable = true; continue; }
        for (const h of p.holders.value) flat.push({ h, position: p.name, space: s.label });
      }
    }
  } else anyUnreadable = true;

  async function call(body: Record<string, unknown>, method: "POST" | "PATCH", key: string, okText: string) {
    setBusy(key); setMsg(null);
    try {
      const r = await fetch("/api/hq/appointments", {
        method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) {
        say("ok", j.audit_error ? `${okText} — but the audit entry failed to write (${j.audit_error}).` : okText);
        router.refresh();
      } else say("err", j.error ?? `The request failed (HTTP ${r.status}).`);
    } catch {
      say("err", "The request did not reach the server, so nothing was changed.");
    }
    setBusy(null);
  }

  const appoint = (position_code: string, person_id: string, term_end: string) =>
    call({ position_code, person_id, term_end: term_end || undefined }, "POST", position_code, "Appointed. They can open Competen HQ now.");
  const end = (h: HqHolderView, status: string) =>
    call({ appointment_id: h.appointmentId, status }, "PATCH", h.appointmentId,
      `Set to ${STATUS_LABEL[status] ?? status}. The row is kept as the record that the appointment happened.`);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold text-gray-900">HQ position appointments</h1>
        <p className="text-gray-500 text-sm mt-1 max-w-3xl">
          Appointing somebody to a position here writes the row that <code className="text-[11px] bg-gray-50 px-1 rounded">resolveHqPositions</code> reads,
          which is what opens Competen HQ and decides what they can see inside it. It is the only screen in this
          product that can do that: the office screen under Office Governance stores one of eight committee
          roles instead, none of which is an HQ position, so an appointment made there grants nothing here.
        </p>
      </header>

      {msg && (
        <p className={`text-sm rounded-lg px-3 py-2 ${msg.k === "ok" ? "bg-[var(--cmp-surface-success)] text-green-800" : "bg-[var(--cmp-surface-error)] text-red-800"}`}>
          {msg.t}
        </p>
      )}

      {!canAppoint && (
        <p className="text-sm rounded-lg px-3 py-2 bg-gray-100 text-gray-700">
          You are signed in as {viewerName ?? "an appointed HQ user"} and can read this board. Appointing and
          ending are reserved to a platform owner, and the API refuses them for anyone else — so no button to
          do it is shown.
        </p>
      )}
      {canAppoint && (
        <p className="text-sm rounded-lg px-3 py-2 bg-gray-100 text-gray-700">
          You may appoint anyone except yourself. Self-appointment is refused by the API: an owner already
          reaches everything, so nothing is lost by it, and no request in this product should mean
          &ldquo;give me more than I was given&rdquo;.
        </p>
      )}

      {board.notes.map(n => (
        <p key={n} className="text-[12px] text-gray-500">{n}</p>
      ))}

      <div className="grid gap-4 sm:grid-cols-2 rounded-xl border border-gray-200 bg-white p-4">
        <Figure n={holdingNow} one="person holds an HQ position right now" many="people hold an HQ position right now"
          rows={flat.filter(r => r.h.grantsAccess)} />
        <Figure n={onRosterOnly} one="appointment is on the roster without granting access" many="appointments are on the roster without granting access"
          rows={flat.filter(r => !r.h.grantsAccess)} />
      </div>

      {anyUnreadable && (
        <Unreadable what="Part of the board" error="see the sections marked below" />
      )}

      {!board.spaces.ok ? <Unreadable what="The HQ spaces" error={board.spaces.error} /> : (
        <div className="space-y-8">
          {board.spaces.value.map(s => (
            <SpaceSection key={s.space} s={s} canAppoint={canAppoint} people={people} busy={busy} onAppoint={appoint} onEnd={end} />
          ))}
        </div>
      )}

      {/* Appointments sitting in an HQ space whose role is not a position. They grant nothing, and the
          people who made them almost certainly think they do. */}
      <section className="space-y-2">
        <h2 className="text-base font-bold text-gray-900">Appointments in an HQ space that grant nothing</h2>
        {!board.orphans.ok ? <Unreadable what="Unmatched appointments" error={board.orphans.error} /> : (
          <details className="rounded-xl border border-gray-200 bg-white p-4">
            <summary className="cursor-pointer text-sm text-gray-800">
              <span className="font-bold text-lg text-gray-900">{board.orphans.value.length}</span>{" "}
              <span className="text-gray-600">
                appointment{board.orphans.value.length === 1 ? "" : "s"} name a role that is not an HQ position
              </span>
            </summary>
            {board.orphans.value.length === 0
              ? <p className="mt-2 text-[12px] text-gray-400">The list is empty. Every appointment in an HQ space names a real position.</p>
              : <ul className="mt-2 space-y-1">
                  {board.orphans.value.map(o => (
                    <li key={o.appointmentId} className="text-[12px] text-gray-700 flex flex-wrap items-center gap-2">
                      <span className="font-medium">{o.personName ?? "Name not recorded"}</span>
                      <code className="bg-gray-50 rounded px-1">{o.role ?? "no role"}</code>
                      <span className="text-gray-400">{o.spaceLabel}</span>
                      <StatusBadge status={o.status} grantsAccess={o.grantsAccess} />
                      <span className="text-amber-800">grants no HQ capability</span>
                    </li>
                  ))}
                </ul>}
          </details>
        )}
      </section>

      <footer className="text-[11px] text-gray-500 space-y-1 border-t border-gray-100 pt-4">
        <p><span className="font-semibold">Ending an appointment keeps the row.</span> Setting a status is the only
          change made; nothing is deleted, because the row is the record that the appointment happened.</p>
        <p><span className="font-semibold">Only &ldquo;Active&rdquo; opens the door.</span> {STATUS_MEANING.suspended} {STATUS_MEANING.nominated}</p>
        <p>Viewer id {viewerId.slice(0, 8)}… — shown so you can tell which row is yours.</p>
      </footer>
    </div>
  );
}
