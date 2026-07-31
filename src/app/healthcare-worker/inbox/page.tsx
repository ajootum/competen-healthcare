import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { loadAssignmentInbox } from "@/lib/hww/census";
import { titleCase, fmtWhen, AcuityChip, Chip, StatCard, SectionCard, Empty } from "@/lib/hww/kit";

// Assignment Inbox (HWW-WARD-002/003) — where responsibility is offered and
// explicitly taken: assignments awaiting my acceptance (I am NOT responsible
// until I accept), incoming transfers awaiting my acceptance (ownership moves
// only when I accept), and the state of transfers I initiated. Nothing enters
// My Patients without an acceptance recorded here.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { AssignmentActions, TransferAccept } from "./InboxActions";

export const dynamic = "force-dynamic";

const XFER_TONE: Record<string, string> = { pending: "bg-gray-100 text-gray-500", awaiting_acceptance: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]", completed: "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]", cancelled: "bg-gray-100 text-gray-400" };

export default async function AssignmentInboxPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const d = await loadAssignmentInbox(admin, user.id);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Assignment Inbox</h1>
        <p className="text-sm text-gray-500 mt-1">Responsibility changes only when you accept it — until then the current nurse (or your supervisor) remains accountable.</p>
      </div>

      {d.migrationMissing && (
        <div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-5">
          <p className="font-semibold text-amber-900">⚙️ State engine not yet enabled</p>
          <p className="text-sm text-amber-800 mt-1">Apply migration <code className="bg-[var(--cmp-surface-warning)] px-1.5 py-0.5 rounded font-mono text-xs">156-assignment-state-engine.sql</code> to enable the acceptance workflow.</p>
        </div>
      )}

      <div className="grid sm:grid-cols-3 gap-4">
        <StatCard icon="📥" title="Awaiting My Acceptance" value={d.pendingAssignments.length} tone={d.pendingAssignments.length > 0 ? "text-emerald-700" : undefined} sub="assignments offered to me" />
        <StatCard icon="🔁" title="Incoming Transfers" value={d.incomingTransfers.length} tone={d.incomingTransfers.length > 0 ? "text-[var(--cmp-text-warning)]" : undefined} sub="awaiting my acceptance" />
        <StatCard icon="📤" title="My Open Transfers" value={d.outgoingTransfers.length} sub="initiated by me, in flight" />
      </div>

      <SectionCard icon="📥" title="Assignments Awaiting My Acceptance" count={d.pendingAssignments.length}>
        {d.pendingAssignments.length === 0 ? (
          <Empty>Nothing pending. When your supervisor (or the assignment engine) allocates a patient to you, it appears here first.</Empty>
        ) : (
          <div className="divide-y divide-gray-100">
            {d.pendingAssignments.map((a: any) => {
              const p = a.op_patients;
              return (
                <div key={a.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-800">{p?.op_beds?.label ? `${p.op_beds.label} · ` : ""}{p?.label ?? "Patient"}</span>
                    <AcuityChip level={p?.acuity_level} />
                    {p?.isolation_status && p.isolation_status !== "none" && <Chip tone="bg-purple-100 text-purple-700">{titleCase(p.isolation_status)}</Chip>}
                    <Chip tone="bg-[var(--cmp-surface-information)] text-blue-700">{titleCase(a.assignment_type)}</Chip>
                    <span className="ml-auto text-xs text-gray-400">assigned by {a.assigner?.full_name ?? "supervisor"} · {fmtWhen(a.started_at)}</span>
                  </div>
                  {p?.diagnosis && <p className="text-xs text-gray-500 mt-0.5">{p.diagnosis}</p>}
                  <AssignmentActions id={a.id} />
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      <SectionCard icon="🔁" title="Incoming Transfers" count={d.incomingTransfers.length}>
        {d.incomingTransfers.length === 0 ? (
          <Empty>No transfers addressed to you. Accepting a transfer moves the patient — and responsibility — to you in one step.</Empty>
        ) : (
          <div className="divide-y divide-gray-100">
            {d.incomingTransfers.map((t: any) => (
              <div key={t.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-gray-800">{t.op_patients?.label ?? "Patient"}</span>
                  <AcuityChip level={t.op_patients?.acuity_level} />
                  <Chip tone="bg-cyan-100 text-cyan-700">{titleCase(t.transfer_type)}</Chip>
                  <span className="ml-auto text-xs text-gray-400">from {t.from_nurse?.full_name ?? "—"} · {fmtWhen(t.created_at)}</span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">Reason: {t.reason}{t.to_room ? ` · to ${t.to_room}` : ""}{t.destination ? ` · ${t.destination}` : ""}</p>
                <TransferAccept id={t.id} />
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {(d.outgoingTransfers.length > 0 || d.recentDeclines.length > 0) && (
        <div className="grid lg:grid-cols-2 gap-5">
          <SectionCard icon="📤" title="Transfers I Initiated" count={d.outgoingTransfers.length}>
            <div className="divide-y divide-gray-50">
              {d.outgoingTransfers.length === 0 && <Empty>None in flight.</Empty>}
              {d.outgoingTransfers.map((t: any) => (
                <p key={t.id} className="py-2 text-xs text-gray-600 flex flex-wrap items-center gap-2">
                  <span className="font-medium text-gray-800">{t.op_patients?.label}</span>
                  <Chip tone="bg-cyan-100 text-cyan-700">{titleCase(t.transfer_type)}</Chip>
                  <Chip tone={XFER_TONE[t.status] ?? XFER_TONE.pending}>{titleCase(t.status)}</Chip>
                  {t.receiver?.full_name && <span className="text-gray-400">→ {t.receiver.full_name}</span>}
                  <span className="ml-auto text-gray-400">{fmtWhen(t.created_at)}</span>
                </p>
              ))}
            </div>
          </SectionCard>
          <SectionCard icon="↩️" title="My Recent Declines" count={d.recentDeclines.length}>
            <div className="divide-y divide-gray-50">
              {d.recentDeclines.length === 0 && <Empty>None.</Empty>}
              {d.recentDeclines.map((a: any) => (
                <p key={a.id} className="py-2 text-xs text-gray-600">
                  <span className="font-medium text-gray-800">{a.op_patients?.label}</span> — {a.declined_reason} <span className="text-gray-300">· {fmtWhen(a.responded_at)}</span>
                </p>
              ))}
            </div>
          </SectionCard>
        </div>
      )}

      <p className="text-center text-[11px] text-gray-400 pt-1">
        Every acceptance, decline and transfer is an immutable audit event. Declined assignments return to your supervisor for re-allocation; the patient is never left ownerless.
      </p>
    </div>
  );
}
