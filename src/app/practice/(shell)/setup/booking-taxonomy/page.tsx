import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { taxonomyForSetup } from "@/lib/practice/taxonomy-admin";
import TaxonomyEditor from "./TaxonomyEditor";

// /practice/setup/booking-taxonomy -- CP-BOOKING-TAXONOMY-001 s4's no-code configuration.
//
// "All taxonomy must be configurable from Practice Setup without code deployment."
//
// ⚠ THE SCREEN SHOWS SWITCHED-OFF ENTRIES. They cannot be booked and they are not offered anywhere else,
// but this is the only page from which one can be switched back on -- and every historical appointment
// still points at them, which is exactly why s4 says deactivate rather than delete.

export const dynamic = "force-dynamic";

export default async function BookingTaxonomyPage() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  // The same capability the sidebar entry and the API enforce. A page reachable by URL but refused by
  // its own API is a worse experience than one that is simply not offered.
  if (!hasCapability(shell.ctx, "practice.settings.manage")) redirect("/practice/setup");

  const admin = createAdminClient();
  const { taxonomy, notYetConfigurable } = await taxonomyForSetup(admin, shell.ctx);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Visit types and consultation modes</h1>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-gray-500">
            <strong>Why</strong> a patient is being seen and <strong>how</strong> the consultation
            happens are recorded separately, so a follow-up can be in person, by telephone or at home
            without any of those being a different kind of visit.
          </p>
        </div>
        <Link href="/practice/setup" className="text-[12.5px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
          &larr; Practice Setup
        </Link>
      </div>

      {/* ⚠ THREE STATES. An unreadable taxonomy must not render as a practice that has configured
          nothing -- on THIS page that would invite somebody to add six entries that already exist. */}
      {!taxonomy.readable ? (
        <p className="mt-4 rounded-xl border border-[var(--cmp-color-critical)] bg-[var(--cmp-surface-critical)] p-4 text-[13px] text-[var(--cmp-text-critical)]">
          {taxonomy.detail ?? "This practice's visit types and consultation modes could not be read."}
          {" "}Nothing has been lost and nothing has been changed &mdash; do <strong>not</strong> read
          this as an empty configuration. Reload before adding anything.
        </p>
      ) : (
        <TaxonomyEditor
          visitTypes={taxonomy.visitTypes.map(v => ({
            id: v.id, code: v.code, label: v.label, active: v.active,
            selfBookable: v.selfBookable, durationMinutes: v.defaultDurationMinutes,
            systemSeeded: v.systemSeeded,
            isDefault: v.id === taxonomy.defaultVisitTypeId,
          }))}
          modes={taxonomy.modes.map(m => ({
            id: m.id, code: m.code, label: m.label, active: m.active,
            selfBookable: m.selfBookable, requiresLocation: m.requiresLocation,
            systemSeeded: m.systemSeeded,
            isDefault: m.id === taxonomy.defaultModeId,
          }))}
        />
      )}

      {/* ⚠ SAID, NOT SILENTLY OMITTED. s4 asks for location restriction and migration 292 has nowhere to
          store it, so the gap is printed rather than left as a control that would appear to work. */}
      <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50/60 p-4">
        <h2 className="text-[12.5px] font-bold text-gray-800">Not configurable yet</h2>
        <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[12px] leading-relaxed text-gray-600">
          {notYetConfigurable.map(n => <li key={n}>{n}</li>)}
        </ul>
      </div>

      <p className="mt-4 text-[11.5px] leading-relaxed text-gray-500">
        Entries are switched off rather than deleted. Appointments already recorded against one keep
        pointing at it, so a year of history stays readable &mdash; a deleted entry would turn every one
        of those into a booking whose purpose nobody can look up.
      </p>
    </div>
  );
}
