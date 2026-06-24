/**
 * Passport Engine
 * Stores and retrieves competency passport records.
 */

export type PassportStatus = "competent" | "in_progress" | "pending" | "expired";

export interface PassportEntry {
  competency_id: string;
  competency_name: string;
  category: string;
  status: PassportStatus;
  expiry_date: string | null;
  last_assessed: string | null;
}

export interface PassportSummary {
  total: number;
  competent: number;
  in_progress: number;
  pending: number;
  expired: number;
  compliance: number;
}

export function summarisePassport(entries: PassportEntry[]): PassportSummary {
  const total      = entries.length;
  const competent  = entries.filter(e => e.status === "competent").length;
  const in_progress = entries.filter(e => e.status === "in_progress").length;
  const pending    = entries.filter(e => e.status === "pending").length;
  const expired    = entries.filter(e => e.status === "expired").length;
  const compliance = total > 0 ? Math.round((competent / total) * 100) : 0;
  return { total, competent, in_progress, pending, expired, compliance };
}

export function groupByCategory(entries: PassportEntry[]): Record<string, PassportEntry[]> {
  return entries.reduce((acc, e) => {
    (acc[e.category] = acc[e.category] ?? []).push(e);
    return acc;
  }, {} as Record<string, PassportEntry[]>);
}

export function statusBadgeClass(status: PassportStatus): string {
  return {
    competent:   "bg-green-100 text-green-700",
    in_progress: "bg-blue-100 text-blue-700",
    pending:     "bg-gray-100 text-gray-500",
    expired:     "bg-red-100 text-red-600",
  }[status];
}
