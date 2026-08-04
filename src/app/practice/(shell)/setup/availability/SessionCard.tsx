"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/* eslint-disable @typescript-eslint/no-explicit-any */

// CPR-SETUP-003 — a session as a first-class object with a lifecycle.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-SET-002 SHIPPED WITH ADD AND NOTHING ELSE, which is how a real practice ended up with
// 09:00–13:00 on Tuesday at two different hospitals and no way to correct either. Every action the
// specification lists is here: edit, duplicate, move, suspend, delete.
//
// THE DELETE CONFIRMATION NAMES WHAT SURVIVES. "Deleting availability never silently removes patient
// appointments" is the specification's own acceptance criterion, and the engine already guarantees it --
// but a practitioner who reads only "session removed" will believe their Tuesday is clear while three
// patients are still booked into it. So the result leads with what was KEPT.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

const WEEKDAYS = [
  [1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [7, "Sun"],
] as const;

const hhmmOf = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const toMinutes = (v: string) => {
  const [h, m] = v.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

type Mode = null | "edit" | "duplicate" | "confirm-delete";

export default function SessionCard({ session, locations, kindHue }: {
  session: any; locations: any[]; kindHue: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // ── WHY THIS IS NOT A <details> ────────────────────────────────────────────────────────────────
  //
  // It was, and it was wrong twice over. A native <details> only closes when its own summary is clicked
  // again -- so clicking anywhere else left it open, and opening a second card's menu left BOTH on
  // screen at once. Worse, the open menu is absolutely positioned over the card, so choosing Delete
  // rendered the confirmation UNDERNEATH it: the button was there, and unreachable. "Unable to delete"
  // was a z-index, not a refusal.
  //
  // A controlled menu that closes on outside click, on Escape, and on choosing anything fixes all three.
  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutside = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    // `capture` so a click on ANOTHER card's trigger closes this one before that one opens.
    document.addEventListener("pointerdown", closeOnOutside, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  /** Every menu item does this: pick the mode AND put the menu away, so nothing is left covering it. */
  const choose = (next: Mode) => { setMode(next); setMenuOpen(false); };

  const [draft, setDraft] = useState({
    weekday: String(session.weekday),
    from: hhmmOf(session.starts_minute),
    to: hhmmOf(session.ends_minute),
    locationId: session.location_id ?? "",
  });
  const [copyDays, setCopyDays] = useState<number[]>([]);

  const suspended = session.status === "suspended";

  async function send(payload: Record<string, unknown>, describe: (d: any) => string) {
    setBusy(true); setNotice(null);
    const res = await fetch("/api/v1/practice/availability-config", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      // The engine's refusals are written to be read by a practitioner -- "you cannot be at Mulago and
      // TMR at the same time" -- so they are shown as they are rather than replaced with "invalid".
      setNotice({ kind: "err", text: data?.error?.message ?? "That did not work." });
      return;
    }
    setNotice({ kind: "ok", text: describe(data) });
    setMode(null);
    router.refresh();
  }

  const locName = (id: string | null) =>
    id ? locations.find(l => l.id === id)?.name ?? "another place" : "anywhere";

  return (
    <li className={`rounded-lg border bg-white px-2 py-1.5 ${suspended ? "border-dashed border-gray-300 opacity-70" : "border-gray-200"}`}
      style={{ borderLeft: `3px solid ${suspended ? "var(--cp-slate-300)" : kindHue}` }}>

      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold text-gray-800">
            {hhmmOf(session.starts_minute)}–{hhmmOf(session.ends_minute)}
          </p>
          <p className="truncate text-[9px] text-gray-500">{locName(session.location_id)}</p>
          {suspended && <p className="text-[9px] font-semibold text-amber-700">Suspended</p>}
        </div>
        <div className="relative shrink-0" ref={menuRef}>
          <button type="button" onClick={() => setMenuOpen(o => !o)}
            aria-haspopup="menu" aria-expanded={menuOpen}
            className="px-1 text-[12px] leading-none text-gray-400 hover:text-gray-700"
            aria-label="Session actions">⋮</button>
          {menuOpen && (
            <div role="menu"
              className="absolute right-0 z-30 mt-1 w-36 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
              <button type="button" role="menuitem" onClick={() => choose("edit")}
                className="block w-full px-2.5 py-1.5 text-left text-[11px] text-gray-700 hover:bg-gray-50">
                Edit or move
              </button>
              <button type="button" role="menuitem" onClick={() => choose("duplicate")}
                className="block w-full px-2.5 py-1.5 text-left text-[11px] text-gray-700 hover:bg-gray-50">
                Duplicate
              </button>
              <button type="button" role="menuitem" disabled={busy}
                onClick={() => {
                  setMenuOpen(false);
                  void send(
                    { action: "edit_session", templateId: session.id, status: suspended ? "active" : "suspended" },
                    () => (suspended ? "Session resumed." : "Session suspended — it stops generating and keeps its place."));
                }}
                className="block w-full px-2.5 py-1.5 text-left text-[11px] text-gray-700 hover:bg-gray-50">
                {suspended ? "Resume" : "Suspend"}
              </button>
              <button type="button" role="menuitem" onClick={() => choose("confirm-delete")}
                className="block w-full px-2.5 py-1.5 text-left text-[11px] text-rose-700 hover:bg-rose-50">
                Delete
              </button>
            </div>
          )}
        </div>
      </div>

      {notice && (
        <p className={`mt-1 rounded px-1.5 py-1 text-[9px] leading-snug ${
          notice.kind === "ok" ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-900"}`}>
          {notice.text}
        </p>
      )}

      {mode === "edit" && (
        <form className="mt-1.5 flex flex-col gap-1 border-t border-gray-100 pt-1.5" onSubmit={e => {
          e.preventDefault();
          send({
            action: "edit_session", templateId: session.id,
            weekday: Number(draft.weekday),
            startsMinute: toMinutes(draft.from), endsMinute: toMinutes(draft.to),
            locationId: draft.locationId || null,
          }, d => `Saved.${d.session?.slotsKept ? ` ${d.session.slotsKept} slot${d.session.slotsKept === 1 ? "" : "s"} kept — somebody is booked in.` : ""}`);
        }}>
          <select value={draft.weekday} onChange={e => setDraft(d => ({ ...d, weekday: e.target.value }))}
            className="rounded border border-gray-200 px-1 py-1 text-[10px]" aria-label="Day">
            {WEEKDAYS.map(([n, l]) => <option key={n} value={n}>{l}</option>)}
          </select>
          <div className="flex gap-1">
            <input type="time" value={draft.from} onChange={e => setDraft(d => ({ ...d, from: e.target.value }))}
              className="w-full rounded border border-gray-200 px-1 py-1 text-[10px]" aria-label="Start" />
            <input type="time" value={draft.to} onChange={e => setDraft(d => ({ ...d, to: e.target.value }))}
              className="w-full rounded border border-gray-200 px-1 py-1 text-[10px]" aria-label="End" />
          </div>
          <select value={draft.locationId} onChange={e => setDraft(d => ({ ...d, locationId: e.target.value }))}
            className="rounded border border-gray-200 px-1 py-1 text-[10px]" aria-label="Location">
            <option value="">Anywhere</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <div className="flex gap-1">
            <button type="submit" disabled={busy}
              className="flex-1 rounded bg-[var(--cp-primary)] py-1 text-[10px] font-semibold text-white disabled:opacity-50">
              Save
            </button>
            <button type="button" onClick={() => setMode(null)}
              className="rounded border border-gray-200 px-2 py-1 text-[10px] text-gray-600">Cancel</button>
          </div>
        </form>
      )}

      {mode === "duplicate" && (
        <form className="mt-1.5 flex flex-col gap-1 border-t border-gray-100 pt-1.5" onSubmit={e => {
          e.preventDefault();
          send({ action: "duplicate_session", templateId: session.id, toWeekdays: copyDays },
            d => {
              const c = d.duplicate?.created?.length ?? 0;
              const r = d.duplicate?.refused ?? [];
              // PARTIAL SUCCESS SAYS SO. Copying to three days where one clashes is not a failure and
              // not a clean success -- reporting either would be a lie about the week.
              return r.length === 0
                ? `Copied to ${c} day${c === 1 ? "" : "s"}.`
                : `Copied to ${c}; ${r.length} refused — ${r[0].reason}`;
            });
        }}>
          <p className="text-[9px] text-gray-500">Copy to which days?</p>
          <div className="flex flex-wrap gap-0.5">
            {WEEKDAYS.map(([n, l]) => (
              <button key={n} type="button"
                onClick={() => setCopyDays(d => d.includes(n) ? d.filter(x => x !== n) : [...d, n])}
                className={`rounded px-1 py-0.5 text-[9px] font-semibold ${
                  copyDays.includes(n)
                    ? "bg-[var(--cp-primary)] text-white"
                    : "border border-gray-200 text-gray-600"}`}>
                {l}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            <button type="submit" disabled={busy || copyDays.length === 0}
              className="flex-1 rounded bg-[var(--cp-primary)] py-1 text-[10px] font-semibold text-white disabled:opacity-50">
              Copy
            </button>
            <button type="button" onClick={() => setMode(null)}
              className="rounded border border-gray-200 px-2 py-1 text-[10px] text-gray-600">Cancel</button>
          </div>
        </form>
      )}

      {mode === "confirm-delete" && (
        <div className="mt-1.5 border-t border-gray-100 pt-1.5">
          {/* THE CONFIRMATION SAYS WHAT WILL AND WILL NOT HAPPEN. The engine cannot remove a slot
              somebody is booked into; saying so here is what stops a practitioner assuming it did. */}
          <p className="text-[9px] leading-snug text-gray-600">
            Removes this session and its future free slots. Any slot a patient is booked into is kept,
            and no appointment is cancelled.
          </p>
          <div className="mt-1 flex gap-1">
            <button type="button" disabled={busy}
              onClick={() => send({ action: "remove_session", templateId: session.id },
                d => d.removed?.slotsKept
                  ? `Removed. ${d.removed.slotsKept} slot${d.removed.slotsKept === 1 ? "" : "s"} kept — somebody is booked in.`
                  : `Removed. ${d.removed?.slotsRemoved ?? 0} free slot${d.removed?.slotsRemoved === 1 ? "" : "s"} cleared.`)}
              className="flex-1 rounded bg-rose-600 py-1 text-[10px] font-semibold text-white disabled:opacity-50">
              Delete
            </button>
            <button type="button" onClick={() => setMode(null)}
              className="rounded border border-gray-200 px-2 py-1 text-[10px] text-gray-600">Keep</button>
          </div>
        </div>
      )}
    </li>
  );
}
