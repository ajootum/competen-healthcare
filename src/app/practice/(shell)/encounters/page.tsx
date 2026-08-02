import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { LIVE_STATUSES } from "@/lib/practice/encounters";

// /practice/encounters -- CPR-006's "encounter queue / history". Two lists, deliberately separated:
// what is OPEN right now and must be finished, and what has already been closed. A single mixed list
// would let an unsigned encounter from last Tuesday disappear under today's traffic, which is exactly
// the failure a clinical record must not have.

/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

const TONE: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-600",
  ACTIVE: "bg-[var(--cmp-surface-information)] text-[var(--cmp-text-information)]",
  PAUSED: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]",
  COMPLETED: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]",
  SIGNED: "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]",
  AMENDED: "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]",
  CANCELLED: "bg-gray-100 text-gray-400",
  ENTERED_IN_ERROR: "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]",
};

export default async function EncountersPage() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "encounter.list")) redirect("/practice/home");

  const admin = createAdminClient();
  const { data: rows } = await admin.from("practice_encounter")
    .select("id, patient_id, status, entry_pathway, encounter_mode, reason_for_visit, started_at, signed_at")
    .eq("workspace_id", shell.ctx.workspaceId)
    .order("started_at", { ascending: false }).limit(60);

  const encounters = (rows ?? []) as any[];
  const ids = [...new Set(encounters.map(e => e.patient_id))];
  const { data: patients } = ids.length
    ? await admin.from("practice_patient").select("id, display_name").in("id", ids)
    : { data: [] };
  const nameById = new Map(((patients ?? []) as any[]).map(p => [p.id, p.display_name]));

  const live = encounters.filter(e => LIVE_STATUSES.includes(e.status));
  const awaitingSignature = encounters.filter(e => e.status === "COMPLETED");
  const closed = encounters.filter(e => !LIVE_STATUSES.includes(e.status) && e.status !== "COMPLETED");

  const row = (e: any) => (
    <li key={e.id}>
      <Link href={`/practice/encounters/${e.id}`}
        className="flex items-center gap-2 flex-wrap rounded-lg border border-gray-100 px-3 py-2 hover:bg-gray-50">
        <span className="text-[13px] font-semibold text-gray-900">{nameById.get(e.patient_id) ?? "Unknown patient"}</span>
        <span className="text-[11px] text-gray-400">
          {String(e.entry_pathway).replace(/_/g, " ")} · {String(e.encounter_mode).replace(/_/g, " ")}
          {e.reason_for_visit ? ` · ${e.reason_for_visit}` : ""}
        </span>
        <span className="ml-auto font-mono text-[11px] text-gray-400">{String(e.started_at).slice(0, 16).replace("T", " ")}</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${TONE[e.status] ?? "bg-gray-100 text-gray-500"}`}>{e.status}</span>
      </Link>
    </li>
  );

  return (
    <div className="max-w-5xl">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Encounters</h1>
          <p className="text-[13px] text-gray-500">Open consultations, then everything closed. Newest first.</p>
        </div>
        <Link href="/practice/patients" className="text-[12px] font-semibold text-[#1D4ED8] hover:underline">
          Start one from a patient →
        </Link>
      </div>

      <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">Open now</h2>
        {live.length === 0 ? (
          <p className="mt-2 text-[12px] text-gray-400">
            Nothing open. Start an encounter from a patient record or from a checked-in appointment.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1.5">{live.map(row)}</ul>
        )}
      </section>

      {awaitingSignature.length > 0 && (
        <section className="mt-4 rounded-xl border border-[var(--cmp-color-warning)] bg-white p-4">
          <h2 className="text-[13px] font-bold text-gray-900">Completed, not signed</h2>
          <p className="mt-0.5 text-[11px] text-gray-500">
            The consultation is finished but the record is not final. Until it is signed it can still be edited.
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">{awaitingSignature.map(row)}</ul>
        </section>
      )}

      <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">Closed</h2>
        {closed.length === 0 ? (
          <p className="mt-2 text-[12px] text-gray-400">No closed encounters yet.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1.5">{closed.map(row)}</ul>
        )}
        <p className="mt-3 text-[10px] text-gray-400">
          Showing the {encounters.length} most recent encounters in this workspace. Search and filtering
          across the full history ship with Phase 5 (Practice Intelligence).
        </p>
      </section>
    </div>
  );
}
