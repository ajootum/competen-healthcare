import { ROLE_CONFIG, type AppRole } from "@/lib/roles";
import { ACCOUNT_TYPE_LABEL, type AccountType } from "./account-classification";

// The Users directory CSV, shared by "Export selected" in the browser and the filtered export route on the server
// (HQ-USERS-CLASSIFY-01), so both files have the same columns. The account type column is new.
export type CsvRow = {
  name: string; email: string; phone: string | null; roles: string[]; organisation: string | null; facility: string | null;
  status: string; accountType: AccountType; lastSignIn: string | null; competencyPct: number | null; passportPct: number | null;
};

export function usersCsv(rows: CsvRow[]): string {
  const esc = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["Name", "Email", "Phone", "Roles", "Organisation", "Facility", "Status", "Account type", "Last login", "Competency %", "Passport %"];
  return [head.join(","), ...rows.map(u => [
    esc(u.name), esc(u.email), esc(u.phone), esc(u.roles.map(r => ROLE_CONFIG[r as AppRole]?.label ?? r).join("; ")),
    esc(u.organisation), esc(u.facility), esc(u.status), esc(ACCOUNT_TYPE_LABEL[u.accountType]),
    esc(u.lastSignIn ? new Date(u.lastSignIn).toISOString() : "never"),
    esc(u.competencyPct ?? ""), esc(u.passportPct ?? ""),
  ].join(","))].join("\n");
}
