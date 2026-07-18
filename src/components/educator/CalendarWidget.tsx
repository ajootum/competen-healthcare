"use client";

import { useMemo, useState } from "react";

// Interactive assessment calendar (spec: replace the simple upcoming list).
// Month grid with session markers from live scheduled_assessments; clicking a
// day lists its sessions; the rail below always shows the next upcoming ones.

export type CalEvent = {
  id: string;
  iso: string;          // scheduled_for ISO timestamp
  nurse: string;
  method: string;
};

const METHOD_LABELS: Record<string, string> = {
  direct_observation: "Observation", knowledge: "Knowledge", simulation: "Simulation",
  osce: "OSCE", concurrent_audit: "Audit", retrospective_audit: "Chart Audit", logbook: "Logbook",
};

const METHOD_TINT: Record<string, string> = {
  osce: "bg-teal-50 text-teal-700",
  simulation: "bg-green-50 text-green-700",
  knowledge: "bg-blue-50 text-blue-600",
  direct_observation: "bg-purple-50 text-purple-700",
};

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default function CalendarWidget({ events }: { events: CalEvent[] }) {
  const [today] = useState(() => new Date());
  const [monthDate, setMonthDate] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState<string | null>(null);

  const byDay = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const e of events) {
      const k = dayKey(new Date(e.iso));
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    return m;
  }, [events]);

  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const upcoming = useMemo(
    () => events
      .filter(e => new Date(e.iso).getTime() >= today.getTime())
      .sort((a, b) => a.iso.localeCompare(b.iso))
      .slice(0, 4),
    [events, today],
  );

  const selectedEvents = selected ? byDay.get(selected) ?? [] : [];
  const monthLabel = monthDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const todayKey = dayKey(today);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <button onClick={() => { setMonthDate(new Date(year, month - 1, 1)); setSelected(null); }}
          className="w-6 h-6 rounded-lg text-gray-400 hover:bg-gray-100 text-xs" aria-label="Previous month">‹</button>
        <p className="text-xs font-bold text-gray-800">{monthLabel}</p>
        <button onClick={() => { setMonthDate(new Date(year, month + 1, 1)); setSelected(null); }}
          className="w-6 h-6 rounded-lg text-gray-400 hover:bg-gray-100 text-xs" aria-label="Next month">›</button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 text-center mb-1">
        {["M", "T", "W", "T2", "F", "S", "S2"].map(d => (
          <span key={d} className="text-[8px] font-bold text-gray-300 uppercase">{d.replace(/\d/, "")}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((day, i) => {
          if (day === null) return <span key={`pad-${i}`} />;
          const k = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const has = byDay.has(k);
          const isToday = k === todayKey;
          const isSelected = k === selected;
          return (
            <button key={k}
              onClick={() => setSelected(isSelected ? null : k)}
              className={`relative h-7 rounded-lg text-[10px] transition-colors ${
                isSelected ? "bg-purple-600 text-white font-bold"
                : isToday ? "bg-purple-100 text-purple-800 font-bold"
                : has ? "text-gray-800 font-semibold hover:bg-purple-50"
                : "text-gray-400 hover:bg-gray-50"
              }`}>
              {day}
              {has && !isSelected && (
                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-teal-500" />
              )}
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="mt-2 border-t border-gray-50 pt-2">
          {selectedEvents.length === 0 ? (
            <p className="text-[10px] text-gray-400">No sessions on this day.</p>
          ) : (
            selectedEvents.map(e => (
              <div key={e.id} className="flex items-center gap-2 py-1">
                <span className="text-[9px] font-bold text-purple-600 w-10 shrink-0" suppressHydrationWarning>
                  {new Date(e.iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="text-[10px] text-gray-700 truncate flex-1">{e.nurse}</span>
                <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded shrink-0 ${METHOD_TINT[e.method] ?? "bg-gray-100 text-gray-500"}`}>
                  {METHOD_LABELS[e.method] ?? e.method}
                </span>
              </div>
            ))
          )}
        </div>
      )}

      <div className="mt-3 border-t border-gray-50 pt-2.5">
        <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Next up</p>
        {upcoming.length === 0 ? (
          <p className="text-[10px] text-gray-400">No upcoming scheduled assessments for your learners.</p>
        ) : (
          upcoming.map(e => {
            const d = new Date(e.iso);
            return (
              <div key={e.id} className="flex items-center gap-2.5 py-1">
                <span className="w-9 shrink-0 text-center bg-gray-50 rounded-lg py-1">
                  <span className="block text-[8px] font-bold text-purple-600 uppercase leading-none" suppressHydrationWarning>
                    {d.toLocaleDateString(undefined, { month: "short" })}
                  </span>
                  <span className="block text-xs font-extrabold text-gray-800 leading-tight" suppressHydrationWarning>{d.getDate()}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-semibold text-gray-800 truncate">{e.nurse}</span>
                  <span className="block text-[9px] text-gray-400" suppressHydrationWarning>
                    {d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </span>
                <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded shrink-0 ${METHOD_TINT[e.method] ?? "bg-gray-100 text-gray-500"}`}>
                  {METHOD_LABELS[e.method] ?? e.method}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
