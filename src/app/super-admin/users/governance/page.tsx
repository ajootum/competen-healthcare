import { requireHqCapability } from "@/lib/hq/context";
import { loadGovBoard } from "@/lib/hq/governance-model";
import type { Read } from "@/lib/hq/appointments";
import GovernanceBoard, { type GovPersonOption } from "./GovernanceBoard";

/**
 * Competen HQ — Scholar governance (COMPETEN-SCHOLAR-GOV-IMPLEMENT-01, Scholar Governance Model V1, migration 610).
 *
 * Under /super-admin/users for the same reason as Positions and Appointments beside it: that prefix is mapped to
 * hq.platform.users.view in HQ_ROUTE_INTENT, so the intent map stays true without a new entry.
 *
 * ⚠ THE GATE IS ON THE PAGE AND IT ENFORCES. requireHqCapability refuses regardless of hq_config.mode, and
 * /api/hq/governance checks again. Recording is owner-only in the route and in the database. `canRecord` is a
 * rendering hint. The person picker is read only for an owner, because only an owner can use it.
 */
export default async function ScholarGovernancePage() {
  const ctx = await requireHqCapability("hq.platform.users.view");
  const load = await loadGovBoard(ctx.admin);

  let people: Read<GovPersonOption[]> | null = null;
  if (ctx.isOwner && load.state === "ok") {
    const { data, error } = await ctx.admin.from("profiles").select("id, full_name, email").order("full_name").limit(2000);
    people = error
      ? { ok: false, error: error.message }
      : { ok: true, value: ((data ?? []) as { id: string; full_name: string | null; email: string | null }[])
          .filter(p => p.id !== ctx.userId)
          .map(p => ({ id: p.id, name: p.full_name, email: p.email })) };
  }

  return <GovernanceBoard load={load} canRecord={ctx.isOwner && load.state === "ok"} people={people} />;
}
