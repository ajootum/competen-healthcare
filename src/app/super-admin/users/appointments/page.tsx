import { requireHqCapability } from "@/lib/hq/context";
import { loadHqAppointmentBoard, countHolders, type Read } from "@/lib/hq/appointments";
import AppointmentsBoard, { type PersonOption } from "./AppointmentsBoard";

/**
 * Competen HQ — Position appointments.
 *
 * ⚠ WHY THIS PAGE LIVES UNDER /super-admin/users AND NOT AT A NEW TOP-LEVEL ROUTE.
 *
 * HQ_ROUTE_INTENT (src/lib/hq/spaces.ts) maps route prefixes to capabilities, and its last entry is
 * `/super-admin` marked `exact` precisely so that a NEW module resolves to null — and null denies. A page
 * at, say, /super-admin/appointments would therefore be a route the intent map does not know, which is
 * the state that file exists to make impossible. Adding an entry means editing spaces.ts, which this task
 * was told not to touch. /super-admin/users is already mapped to hq.platform.users.view, which is the
 * capability this page needs anyway, so the page sits inside that prefix and the map stays true.
 *
 * ⚠ THE GATE IS ON THE PAGE, NOT THE LAYOUT. Next 16's authentication guide: a check in a layout "will
 * not prevent nested route segments and Server Actions from being accessed", and layouts "don't re-render
 * on navigation". The guard runs here, and again inside every /api/hq/appointments handler.
 *
 * ⚠ AND IT ENFORCES RATHER THAN OBSERVES, WHICH ON THIS PAGE IS THE WHOLE BALLGAME. It used to call
 * requireHqContext, which honours hq_config.mode -- and under `observe` a would_deny still PROCEEDS. That
 * made this screen, the one that grants HQ positions, reachable by anybody holding any position without
 * hq.platform.users.view: an appointee could have appointed themselves Chief Executive. Measured live
 * before CP-HQ-NAV-001 step 3 closed it. requireHqCapability refuses regardless of mode.
 *
 * ⚠ READING IS NOT WRITING. The guard admits anyone the capability admits; `ctx.isOwner` is what
 * decides whether the buttons do anything, and the API enforces the same thing again — the client's
 * `canAppoint` flag is a rendering hint and is never trusted by the server.
 */
export default async function HqAppointmentsPage() {
  const ctx = await requireHqCapability("hq.platform.users.view");

  const board = await loadHqAppointmentBoard(ctx.admin);

  // The person picker. ⚠ A FAILED READ IS NOT AN EMPTY LIST: an empty <select> would read as "there is
  // nobody in this product to appoint", which is a sentence about the data rather than about the query.
  const { data: profiles, error: peopleErr } = await ctx.admin
    .from("profiles").select("id, full_name, email, role").order("full_name").limit(2000);
  const people: Read<PersonOption[]> = peopleErr
    ? { ok: false, error: peopleErr.message }
    : { ok: true, value: ((profiles ?? []) as { id: string; full_name: string | null; email: string | null; role: string | null }[])
        .map(p => ({ id: p.id, name: p.full_name, email: p.email, role: p.role })) };

  return (
    <AppointmentsBoard
      board={board}
      people={people}
      canAppoint={ctx.isOwner}
      viewerId={ctx.userId}
      viewerName={ctx.fullName}
      holdingNow={countHolders(board, h => h.grantsAccess)}
      onRosterOnly={countHolders(board, h => !h.grantsAccess)}
    />
  );
}
