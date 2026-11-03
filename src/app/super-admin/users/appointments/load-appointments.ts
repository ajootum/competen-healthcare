import type { HqContext } from "@/lib/hq/context";
import { loadHqAppointmentBoard, countHolders, type HqAppointmentBoard, type Read } from "@/lib/hq/appointments";
import type { PersonOption } from "./AppointmentsBoard";
import { loadClassifications, typeCounts, typeOf } from "@/lib/hq/account-classification";

/**
 * The data the appointment board needs, shared by /super-admin/users/appointments and
 * /super-admin/governance/organisation so the two screens can never disagree. Server only.
 *
 * ⚠ The caller has ALREADY passed requireHqCapability("hq.platform.users.view") and hands us its context:
 * this helper reads, it never gates.
 *
 * ⚠ A FAILED READ IS NOT AN EMPTY LIST: an empty <select> would read as "there is nobody in this product to
 * appoint", which is a sentence about the data rather than about the query.
 * ⚠ ONLY REAL PEOPLE ARE OFFERED (owner, 29 Oct 2026). An HQ position is held by a person, so the picker lists
 * accounts classified Human (migration 650) and nothing else: demo, test, system and unclassified accounts are
 * left out and counted, never silently dropped. If the classification cannot be read, the picker says so rather
 * than offer every account.
 */

export type AppointmentsData = {
  board: HqAppointmentBoard;
  people: Read<PersonOption[]>;
  holdingNow: number | null;
  onRosterOnly: number | null;
  notListed: { demo: number; test: number; system: number; unclassified: number } | null;
};

export async function loadAppointmentsData(ctx: Pick<HqContext, "admin">): Promise<AppointmentsData> {
  const board = await loadHqAppointmentBoard(ctx.admin);

  const [{ data: profiles, error: peopleErr }, classes] = await Promise.all([
    ctx.admin.from("profiles").select("id, full_name, email, role").order("full_name").limit(2000),
    loadClassifications(ctx.admin),
  ]);
  const everyone = ((profiles ?? []) as { id: string; full_name: string | null; email: string | null; role: string | null }[]);
  const people: Read<PersonOption[]> = peopleErr
    ? { ok: false, error: peopleErr.message }
    : !classes.available
      ? { ok: false, error: "Account classification could not be read, so real people cannot be told apart from demo and test accounts." }
      : { ok: true, value: everyone.filter(p => typeOf(classes, p.id) === "human").map(p => ({ id: p.id, name: p.full_name, email: p.email, role: p.role })) };
  const counts = classes.available && !peopleErr ? typeCounts(everyone.filter(p => typeOf(classes, p.id) !== "human").map(p => p.id), classes) : null;

  return {
    board,
    people,
    holdingNow: countHolders(board, h => h.grantsAccess),
    onRosterOnly: countHolders(board, h => !h.grantsAccess),
    notListed: counts ? { demo: counts.demo, test: counts.test, system: counts.system, unclassified: counts.unclassified } : null,
  };
}
