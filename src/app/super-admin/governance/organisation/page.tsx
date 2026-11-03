import { requireHqCapability } from "@/lib/hq/context";
import { loadPositionBoard } from "@/lib/hq/positions";
import { loadAppointmentsData } from "../../users/appointments/load-appointments";
import OrganisationWorkspace, { type OrgTab } from "./OrganisationWorkspace";

/**
 * Competen HQ -- Organisation & Appointments (UNIFIED-GOVERNANCE-V1, owner spec section 6).
 *
 * One page, three tabs over the boards that already exist: Positions (hierarchy from hq_position.reports_to plus the
 * no-code positions screen), Appointments (the appointment board) and Capabilities (a position's live grants and the
 * two standard profiles). It adds no governance engine and no migration: every write goes to the existing owner-gated
 * /api/hq/positions and /api/hq/appointments routes, which the database re-checks.
 *
 * ⚠ THE GATE IS ON THE PAGE AND IT ENFORCES (requireHqCapability refuses regardless of hq_config.mode), and it runs
 * before any read. Reading is not writing: `isOwner` only decides whether buttons are drawn; the routes and the
 * hq_position_admin_* functions refuse a non-owner whatever the client sends.
 */
const TABS: readonly OrgTab[] = ["positions", "appointments", "capabilities"];

export default async function OrganisationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireHqCapability("hq.platform.users.view");

  const sp = await searchParams;
  const t = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const initialTab = (TABS as readonly string[]).includes(t ?? "") ? (t as OrgTab) : "positions";

  const [positionBoard, appointments] = await Promise.all([loadPositionBoard(ctx.admin), loadAppointmentsData(ctx)]);

  return (
    <OrganisationWorkspace
      initialTab={initialTab}
      positionBoard={positionBoard}
      migrationApplied={positionBoard.migrationApplied}
      appointments={appointments}
      isOwner={ctx.isOwner}
      viewerId={ctx.userId}
      viewerName={ctx.fullName}
    />
  );
}
