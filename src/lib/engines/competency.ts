/**
 * Competency Engine
 * Determines competency status from assessment data.
 */

export type CompetencyLevel =
  | "Novice"
  | "Advanced Beginner"
  | "Competent"
  | "Proficient"
  | "Expert";

export function avgToLevel(avg: number): CompetencyLevel {
  if (avg >= 5.5) return "Expert";
  if (avg >= 4.5) return "Proficient";
  if (avg >= 2.5) return "Competent";
  if (avg >= 1.5) return "Advanced Beginner";
  return "Novice";
}

export function levelToStatus(level: CompetencyLevel): "competent" | "in_progress" | "pending" {
  if (level === "Competent" || level === "Proficient" || level === "Expert") return "competent";
  if (level === "Advanced Beginner") return "in_progress";
  return "pending";
}

export function isCompetent(avg: number): boolean {
  return avg >= 2.5;
}

export function expiryDate(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().split("T")[0];
}

export function isExpired(expiryDateStr: string | null): boolean {
  if (!expiryDateStr) return false;
  return new Date(expiryDateStr) < new Date();
}

export function isExpiringSoon(expiryDateStr: string | null, withinDays = 60): boolean {
  if (!expiryDateStr) return false;
  const exp = new Date(expiryDateStr);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + withinDays);
  return exp >= new Date() && exp <= cutoff;
}
