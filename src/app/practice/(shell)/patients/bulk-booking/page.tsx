import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { bulkAvailability, type BulkPreset } from "@/lib/practice/bulk-booking";
import BulkWorkspace from "./BulkWorkspace";
import { Advisory } from "@/components/practice/EncounterKit";

// /practice/patients/bulk-booking -- CP-BULK-BOOKING-001.
//
// s1: "Bulk Booking is intentionally under Patients because the operational task is to place multiple
// patients into the schedule." The Practice Planner remains the source of availability; this workspace
// only CONSUMES it.
//
// ⚠ WHAT THIS FIRST CUT DOES NOT DO, said here rather than discovered: the reverse workflow (s2's
// "Patients -> Find availability", including the follow-up-due and overdue cohorts of s8) is not built.
// The primary workflow is, and the spec names it the default. A half-built second workflow behind a
// tab that looked finished would be worse than a named absence.

export const dynamic = "force-dynamic";

type LocationRow = { id: string; name: string; color_slot: string | null };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v ?? "").trim();
const PRESETS: BulkPreset[] = ["today", "tomorrow", "this_week", "next_week", "custom"];

export default async function BulkBookingPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "appointment.manage")) redirect("/practice/patients");

  const sp = await searchParams;
  // ⚠ TYPED DATES BEAT THE DEFAULT PRESET, and they did not until the owner found it on 2026-08-12:
  // "I tried selecting dates from the 16th to 23rd and it does not select appropriately. It seems to be
  // overridden by This week."
  //
  // It was. The preset chips are submit buttons carrying name="preset", so pressing one sends it -- but
  // APPLY CARRIES NO NAME, so pressing Apply submits the dates and no preset at all. This line then
  // supplied `this_week` as a default, and bulkAvailability discards fromDate/toDate for any preset that
  // is not `custom`. The dates were read, overwritten and never used, and the chip stayed lit on This
  // week, which is why the screen looked like it had ignored the request rather than misunderstood it.
  //
  // A preset the user actually PRESSED still wins over the dates in the boxes, because pressing one is
  // an instruction to change them. The inference only fills the silence Apply leaves.
  const rawPreset = one(sp.preset);
  const preset: BulkPreset = (PRESETS as string[]).includes(rawPreset)
    ? (rawPreset as BulkPreset)
    : (one(sp.from) || one(sp.to) ? "custom" : "this_week");
  const admin = createAdminClient();

  const availability = await bulkAvailability(admin, shell.ctx, {
    preset,
    fromDate: one(sp.from) || undefined,
    toDate: one(sp.to) || undefined,
    locationId: one(sp.location) || null,
    visitTypeId: one(sp.visitType) || null,
  });

  const { data: locs } = await admin.from("practice_location")
    .select("id, name, color_slot").eq("workspace_id", shell.ctx.workspaceId).eq("active", true).order("name");

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Bulk booking</h1>
          <p className="mt-1 text-[13px] text-gray-500">Book multiple patients into available practice sessions.</p>
        </div>
        <Link href="/practice/patients" className="text-[12.5px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
          &larr; Back to Patients
        </Link>
      </div>

      {/* ⚠ THREE STATES, and the middle one matters most on this screen: a failed availability read must
          never render as a diary with no free time. Somebody would conclude the week is full. */}
      {!availability.permitted ? (
        <p className="mt-4 rounded-xl border border-gray-200 bg-white p-4 text-[13px] text-gray-600">
          Your role does not carry the appointment permission, so bookings cannot be made here.
        </p>
      ) : !availability.readable ? (
        <p className="mt-4 rounded-xl border border-[var(--cmp-color-critical)] bg-[var(--cmp-surface-critical)] p-4 text-[13px] text-[var(--cmp-text-critical)]">
          {availability.detail ?? "Availability could not be read."} Nothing is being claimed about this
          period &mdash; do <strong>not</strong> read this as a week with no free appointments.
        </p>
      ) : (
        <BulkWorkspace
          preset={preset}
          fromDate={availability.fromDate}
          toDate={availability.toDate}
          timezone={availability.timezone}
          locationId={availability.locationId}
          locations={((locs ?? []) as LocationRow[]).map(l => ({ id: l.id, name: l.name, colorSlot: l.color_slot ?? null }))}
          sessions={availability.sessions}
          closed={availability.closed}
          totalSlots={availability.totalSlots}
          visitTypes={availability.taxonomy.visitTypes.map(v => ({
            id: v.id, label: v.label, minutes: v.defaultDurationMinutes,
          }))}
          modes={availability.taxonomy.modes.map(m => ({ id: m.id, label: m.label }))}
          defaultVisitTypeId={availability.taxonomy.defaultVisitTypeId}
          defaultModeId={availability.taxonomy.defaultModeId}
        />
      )}

      {/* ⚠ COLLAPSED, NOT DELETED. These two gaps must stay findable -- a spec requirement that is
          silently absent is indistinguishable from one nobody noticed -- but they were sitting open
          under the booking grid on every visit, and the grid is what the screen is for. */}
      <div className="mt-5">
        <Advisory summary="Not built yet" count={2}>
        <ul className="list-disc space-y-1 pl-5 text-[12px] leading-relaxed text-gray-600">
          <li>
            <strong>Patients &rarr; Find availability</strong> (s2&rsquo;s reverse workflow), and with it
            the follow-up-due and overdue cohorts of s8. The spec names Availability &rarr; Add patients
            as the default workflow, and that is what this screen is.
          </li>
          <li>
            <strong>A batch idempotency key</strong> (s13). Re-submitting a batch that half-succeeded is
            refused row by row by the double-booking constraint rather than silently duplicating, which
            is real protection but is not the same thing &mdash; so every row&rsquo;s outcome is shown
            rather than a single confirmation.
          </li>
        </ul>
        </Advisory>
      </div>
    </div>
  );
}
