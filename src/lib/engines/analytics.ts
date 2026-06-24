/**
 * Analytics Engine
 * Produces reports and dashboard aggregations.
 */

export interface NurseMetric {
  user_id: string;
  full_name: string;
  cpdHours: number;
  competent: number;
  total: number;
  coursesCompleted: number;
}

export interface HospitalMetric {
  hospital_id: string;
  hospital_name: string;
  nurseCount: number;
  avgCompliance: number;
  onCpdTarget: number;
}

export const CPD_ANNUAL_TARGET = 30;

export function cpdStatus(hours: number): "on_target" | "in_progress" | "behind" | "not_started" {
  if (hours >= CPD_ANNUAL_TARGET) return "on_target";
  if (hours >= 15) return "in_progress";
  if (hours > 0) return "behind";
  return "not_started";
}

export function wardCompliance(competentCount: number, totalNurses: number): number {
  if (totalNurses === 0) return 0;
  return Math.round((competentCount / totalNurses) * 100);
}

export function topSkillGaps(
  competencies: Array<{ name: string; competent: number; total: number }>
): Array<{ name: string; gap: number }> {
  return competencies
    .map(c => ({ name: c.name, gap: c.total > 0 ? 100 - Math.round((c.competent / c.total) * 100) : 100 }))
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 5);
}

export function formatHours(h: number): string {
  return h % 1 === 0 ? `${h}h` : `${h.toFixed(1)}h`;
}
