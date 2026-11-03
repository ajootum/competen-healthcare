import { requireHqCapability } from "@/lib/hq/context";
import { loadPositionBoard } from "@/lib/hq/positions";
import Link from "next/link";
import PositionsBoard from "./PositionsBoard";

/**
 * Competen HQ — Positions and grants (HQ-POSITION-ADMIN-01, migration 500).
 *
 * Under /super-admin/users for the same reason as the appointments screen beside it: that prefix is already
 * mapped to hq.platform.users.view in HQ_ROUTE_INTENT, so the intent map stays true without a new entry.
 *
 * ⚠ THE GATE IS ON THE PAGE AND IT ENFORCES. requireHqCapability refuses regardless of hq_config.mode, and
 * /api/hq/positions checks again. Reading is not writing: `canAdminister` is a rendering hint, and both the
 * route and the hq_position_admin_* functions refuse a non-owner whatever the client sends.
 */
export default async function HqPositionsPage() {
  const ctx = await requireHqCapability("hq.platform.users.view");
  const board = await loadPositionBoard(ctx.admin);
  return (
    <>
      <p className="mb-3 text-[13px] text-gray-600">
        Also available as <Link href="/super-admin/governance/organisation" className="font-semibold text-teal-800 hover:underline">Organisation &amp; Appointments</Link>.
      </p>
      <PositionsBoard
        board={board}
        migrationApplied={board.migrationApplied}
        canAdminister={ctx.isOwner && board.migrationApplied}
        isOwner={ctx.isOwner}
        viewerName={ctx.fullName}
      />
    </>
  );
}
