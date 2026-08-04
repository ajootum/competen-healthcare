"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { tintedCard } from "@/lib/practice/palette";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE TIMELINE, AND DRAGGING AN APPOINTMENT TO A NEW TIME OR A DIFFERENT HOSPITAL.
//
// THE SERVER DECIDES, ALWAYS. The block follows the finger, but nothing has moved until the engine says
// so -- and when the engine refuses, the block SNAPS BACK and the reason is put on the screen. A
// calendar that leaves a block where it was dropped after a refusal is lying about the diary, and the
// practitioner walks away believing a patient was moved.
//
// EVERY POSITION COMES FROM THE SERVER as minutes from the start of the practice's day. This component
// multiplies by pixels and does no clock arithmetic of its own: `new Date(iso).getHours()` in a browser
// reads the LAPTOP'S timezone, so a receptionist working from a different country would silently see a
// different day. See timeline.ts.
//
// A REFUSED DROP OFFERS THE OVERRIDE RATHER THAN HIDING IT. Double-booking and travel conflicts are
// sometimes exactly what the practitioner intends; the honest response is to say what is wrong and let
// them insist, not to make the drag mysteriously fail.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

const PX_PER_MINUTE = 1.1;

const STATUS_STYLE: Record<string, string> = {
  REQUESTED: "border-l-4",
  CONFIRMED: "border-l-4",
  ARRIVED: "border-l-4 ring-1 ring-[var(--cp-accent)]",
  COMPLETED: "border-l-4 opacity-60",
};

const hhmm = (minute: number) => {
  const m = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

type Drag = {
  id: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  originMinute: number;
  originLaneIndex: number;
  minute: number;
  laneIndex: number;
  mode: "move" | "resize";
  originDuration: number;
  duration: number;
};

export default function Timeline({ timeline, canManage, onChanged }: {
  timeline: any; canManage: boolean; onChanged?: () => void;
}) {
  const router = useRouter();
  const [drag, setDrag] = useState<Drag | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{ text: string; retry: (() => void) | null } | null>(null);
  const laneStripRef = useRef<HTMLDivElement>(null);

  const { fromMinute, toMinute, snapMinutes, lanes, blocks, shading } = timeline;
  const height = (toMinute - fromMinute) * PX_PER_MINUTE;
  const top = (minute: number) => (minute - fromMinute) * PX_PER_MINUTE;

  const hourMarks: number[] = [];
  for (let m = Math.ceil(fromMinute / 60) * 60; m <= toMinute; m += 60) hourMarks.push(m);

  const snap = (m: number) => Math.round(m / snapMinutes) * snapMinutes;

  async function commit(block: any, minute: number, laneIndex: number, duration: number, force = false) {
    const laneId = lanes[laneIndex]?.id ?? null;
    // dayStart + minutes, the exact inverse of how the server placed it.
    const scheduledAt = new Date(Date.parse(timeline.dayStartIso) + minute * 60000).toISOString();

    setBusyId(block.id);
    setRefusal(null);
    const res = await fetch(`/api/v1/practice/appointments/${block.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scheduledAt, durationMinutes: duration, locationId: laneId,
        expectedVersion: block.recordVersion, allowOverlap: force || undefined,
      }),
    });
    setBusyId(null);

    // The server is the source of truth for where the block now is, so the day is re-read rather than
    // patched locally -- a local patch would show the practitioner their own guess.
    if (res.ok) {
      if (onChanged) onChanged(); else router.refresh();
      return;
    }

    const e = await res.json().catch(() => ({}));
    const code = e?.error?.code;
    const message = e?.error?.message ?? "That move did not work.";
    // NO_CHANGE is not worth a message -- the practitioner put it back where it was, which is fine.
    if (code === "NO_CHANGE") return;
    setRefusal({
      text: message,
      // The override is offered only where it exists. STALE and NOT_FOUND need a reload, not insistence.
      retry: (code === "DOUBLE_BOOKED" || code === "TRAVEL_CONFLICT")
        ? () => commit(block, minute, laneIndex, duration, true)
        : null,
    });
  }

  function beginDrag(e: React.PointerEvent, block: any, laneIndex: number, mode: "move" | "resize") {
    if (!canManage || !block.movable || busyId) return;
    e.preventDefault();
    // CAPTURED ON THE STRIP, NOT ON THE BLOCK. The block is re-parented into whichever lane the finger
    // is over, so React unmounts and remounts it the moment a drag crosses into another hospital --
    // taking the pointer capture with it and stranding the gesture halfway. The strip never moves.
    laneStripRef.current?.setPointerCapture?.(e.pointerId);
    setRefusal(null);
    setDrag({
      id: block.id, pointerId: e.pointerId,
      startClientX: e.clientX, startClientY: e.clientY,
      originMinute: block.startMinute, originLaneIndex: laneIndex,
      minute: block.startMinute, laneIndex,
      mode, originDuration: block.durationMinutes, duration: block.durationMinutes,
    });
  }

  function moveDrag(e: React.PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const deltaMinutes = (e.clientY - drag.startClientY) / PX_PER_MINUTE;

    if (drag.mode === "resize") {
      const duration = Math.min(480, Math.max(5, snap(drag.originDuration + deltaMinutes)));
      setDrag({ ...drag, duration });
      return;
    }

    const minute = Math.max(0, Math.min(1440 - drag.duration, snap(drag.originMinute + deltaMinutes)));
    // Which lane the finger is over, measured off the actual strip rather than assumed widths.
    let laneIndex = drag.laneIndex;
    const strip = laneStripRef.current;
    if (strip && lanes.length > 1) {
      const box = strip.getBoundingClientRect();
      const idx = Math.floor(((e.clientX - box.left) / box.width) * lanes.length);
      if (idx >= 0 && idx < lanes.length) laneIndex = idx;
    }
    setDrag({ ...drag, minute, laneIndex });
  }

  function endDrag(e: React.PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const block = blocks.find((b: any) => b.id === drag.id);
    const changed = drag.minute !== drag.originMinute
      || drag.laneIndex !== drag.originLaneIndex
      || drag.duration !== drag.originDuration;
    setDrag(null);
    if (block && changed) void commit(block, drag.minute, drag.laneIndex, drag.duration);
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-baseline gap-2">
        <h2 className="text-[13px] font-bold text-gray-900">Timeline</h2>
        <span className="text-[11px] text-gray-500">
          {hhmm(fromMinute)}–{hhmm(toMinute)} · {timeline.timezone}
        </span>
        {canManage && (
          <span className="ml-auto text-[11px] text-gray-400">
            Drag to move · drag the bottom edge to change the length
          </span>
        )}
      </div>

      {timeline.dstWarning && (
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-900">
          {timeline.dstWarning}
        </p>
      )}

      {refusal && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
          <p className="text-[12px] text-red-800">{refusal.text}</p>
          {refusal.retry && (
            <button type="button" onClick={refusal.retry}
              className="rounded border border-red-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-red-700 hover:bg-red-100">
              Move it anyway
            </button>
          )}
          <button type="button" onClick={() => setRefusal(null)}
            className="ml-auto text-[11px] font-semibold text-red-700 hover:underline">
            Dismiss
          </button>
        </div>
      )}

      {/* An empty diary WITH availability still draws: the shape of the day the practitioner set aside
          is worth seeing, and a blank panel would suggest nothing had been arranged at all. */}
      {blocks.length === 0 && shading.length === 0 ? (
        <p className="mt-3 text-[12px] text-gray-400">Nothing in the diary for this day, and no hours set aside.</p>
      ) : (
        <div className="mt-3 flex gap-2 overflow-x-auto">
          {/* ── Time gutter ──────────────────────────────────────────────────────────────────── */}
          <div className="relative w-11 shrink-0" style={{ height }}>
            {hourMarks.map(m => (
              <span key={m} className="absolute -translate-y-1/2 text-[10px] tabular-nums text-gray-400"
                style={{ top: top(m) }}>
                {hhmm(m)}
              </span>
            ))}
          </div>

          {/* ── Lanes ────────────────────────────────────────────────────────────────────────── */}
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex gap-1.5">
              {lanes.map((l: any) => (
                <div key={l.id ?? "none"} className="min-w-[140px] flex-1 truncate">
                  <p className="truncate text-[12px] font-semibold text-gray-800">{l.name}</p>
                  <p className="truncate text-[10px] text-gray-400">
                    {l.type === "unassigned" ? "no place recorded"
                      : l.facilityName ?? (l.type === "hospital" ? "no facility linked" : String(l.type).replace(/_/g, " "))}
                  </p>
                </div>
              ))}
            </div>

            <div ref={laneStripRef} className="relative flex gap-1.5 select-none" style={{ height }}
              onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
              {/* Hour rules, drawn once behind every lane. */}
              {hourMarks.map(m => (
                <div key={m} className="pointer-events-none absolute inset-x-0 border-t border-gray-100"
                  style={{ top: top(m) }} />
              ))}

              {lanes.map((lane: any, laneIndex: number) => (
                <div key={lane.id ?? "none"} className="relative min-w-[140px] flex-1 rounded-lg bg-[var(--cp-canvas)]">
                  {/* Availability behind the appointments. */}
                  {shading.filter((s: any) => (s.laneId ?? null) === (lane.id ?? null)).map((s: any, i: number) => (
                    <div key={i} className="pointer-events-none absolute inset-x-0 rounded"
                      style={{
                        top: top(s.fromMinute), height: (s.toMinute - s.fromMinute) * PX_PER_MINUTE,
                        background: s.kind === "leave" || s.kind === "blocked"
                          ? "repeating-linear-gradient(45deg, rgba(148,163,184,.16) 0 6px, transparent 6px 12px)"
                          : "rgba(79,70,229,.05)",
                      }} />
                  ))}

                  {blocks
                    .filter((b: any) => {
                      // THE BLOCK BEING DRAGGED BELONGS TO THE LANE UNDER THE FINGER, not to the lane it
                      // came from -- otherwise dragging it to another hospital makes it vanish, because
                      // its own lane declines to draw it and no other lane knows about it.
                      if (drag && drag.id === b.id) return (lanes[drag.laneIndex]?.id ?? null) === (lane.id ?? null);
                      return (b.locationId ?? null) === (lane.id ?? null);
                    })
                    .map((b: any) => {
                      const dragging = drag?.id === b.id;
                      const minute = dragging ? drag!.minute : b.startMinute;
                      const duration = dragging ? drag!.duration : b.durationMinutes;
                      return (
                        <div key={b.id}
                          onPointerDown={e => beginDrag(e, b, laneIndex, "move")}
                          // THE CARD IS TINTED IN ITS TYPE'S OWN COLOUR, which is what the comp does and
                          // what this screen previously spent on a 2px dot. A day then reads as a
                          // pattern before any text is read: amber blocks are hospital work, cyan is
                          // telemedicine, red is an emergency slot.
                          className={`absolute inset-x-0.5 overflow-hidden rounded-md border px-1.5 py-1 shadow-sm
                            ${STATUS_STYLE[b.status] ?? "border-l-4"}
                            ${dragging ? "z-20 opacity-90 shadow-lg ring-2 ring-[var(--cp-primary)]" : "z-10"}
                            ${busyId === b.id ? "opacity-50" : ""}
                            ${canManage && b.movable ? "cursor-grab active:cursor-grabbing" : "cursor-default"}`}
                          style={{
                            top: top(minute), height: Math.max(18, duration * PX_PER_MINUTE - 2),
                            ...tintedCard(b.colour),
                          }}
                          title={b.movable
                            ? `${b.patientName} — ${hhmm(minute)}, ${duration} min`
                            : `${b.patientName} — ${b.immovableReason}`}>
                          <p className="truncate text-[11px] font-semibold leading-tight text-gray-900">
                            {b.patientName}
                          </p>
                          <p className="truncate text-[10px] leading-tight text-gray-500">
                            {hhmm(minute)} · {b.typeLabel}
                          </p>
                          {!b.movable && (
                            <p className="truncate text-[9px] leading-tight text-gray-400">{b.immovableReason}</p>
                          )}

                          {/* Resize handle -- the bottom edge, where a calendar user expects it. */}
                          {canManage && b.movable && duration * PX_PER_MINUTE > 26 && (
                            <div onPointerDown={e => { e.stopPropagation(); beginDrag(e, b, laneIndex, "resize"); }}
                              className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
                              aria-label={`Change the length of ${b.patientName}'s appointment`} />
                          )}
                        </div>
                      );
                    })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* What a drag will not do. */}
      <p className="mt-2 text-[10px] text-gray-400">
        Dragging goes through the same rules as booking: a clash is refused, a move between hospitals with
        no time to travel is refused, and an arrived or finished appointment cannot be moved at all. Every
        move is recorded with both the old time and the new one.
      </p>
    </section>
  );
}
