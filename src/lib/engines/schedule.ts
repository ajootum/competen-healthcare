// Scheduling conflict detection (Assessment Schedule/Calendar specs): finds
// double-booked assessors and double-booked learners among real scheduled
// sessions (two sessions within 60 minutes). Room, equipment, leave and
// public-holiday conflicts have no backing stores and are not invented.

export type SchedSession = {
  id: string;
  nurse_id: string;
  nurse_name: string;
  assessor_id: string;
  assessor_name: string;
  scheduled_for: string;
  status: string;
};

export type Conflict = { key: string; title: string; detail: string };

const HOUR = 60 * 60 * 1000;

export function findConflicts(sessions: SchedSession[]): Conflict[] {
  const active = sessions
    .filter(s => s.status === "scheduled")
    .sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for));

  const conflicts: Conflict[] = [];
  const seen = new Set<string>();
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i], b = active[j];
      const gap = new Date(b.scheduled_for).getTime() - new Date(a.scheduled_for).getTime();
      if (gap >= HOUR) break; // sorted — later sessions only get further away
      if (a.assessor_id === b.assessor_id) {
        const key = `a-${a.id}-${b.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          conflicts.push({
            key,
            title: `${a.assessor_name} is double-booked`,
            detail: `${fmt(a.scheduled_for)} (${a.nurse_name}) overlaps ${fmt(b.scheduled_for)} (${b.nurse_name})`,
          });
        }
      }
      if (a.nurse_id === b.nurse_id) {
        const key = `n-${a.id}-${b.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          conflicts.push({
            key,
            title: `${a.nurse_name} is double-booked`,
            detail: `Sessions at ${fmt(a.scheduled_for)} and ${fmt(b.scheduled_for)}`,
          });
        }
      }
    }
  }
  return conflicts;
}
