import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { loadUnassignedQueue } from "@/lib/hww/census";
import { AssignPatient, RouteTransfer } from "./CensusActions";

// Census & Assignment (HWW-WARD-002, supervisor side) — the loop-closer the
// engine was missing a surface for: the UNASSIGNED QUEUE (offer patients to
// nurses via the acceptance flow), offers sitting unaccepted (who is holding
// up the ward), and pending transfers awaiting ROUTING to a receiving nurse.
// Every action lands in the nurse's Assignment Inbox — responsibility moves
// only on their explicit acceptance.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

const card = "bg-white rounded-xl border border-gray-200 p-5";
const titleCase = (s: string | null | undefined) => (s ?? "").replace(/_/g, " ").replace(/\b\w/g, ch => ch.toUpperCase());
const fmtWhen = (iso: string | null) => iso ? new Date(iso).toLocaleString([], { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }) : "";
const ACUITY: Record<string, string> = { stable: "bg-green-100 text-green-700", moderate: "bg-yellow-100 text-yellow-700", high: "bg-orange-100 text-orange-700", critical: "bg-red-100 text-red-700" };

export default async function CensusAssignmentPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  const isSuperUser = roles.includes("super_admin");
  const NONE = "00000000-0000-0000-0000-000000000000";

  const queue = await loadUnassignedQueue(admin, profile?.hospital_id ?? null, isSuperUser);

  // Pending transfers (no receiving nurse yet) + in-flight awaiting acceptance.
  let tq = admin.from("op_patient_transfers")
    .select("*, op_patients!patient_id(label, acuity_level), initiator:profiles!initiated_by(full_name), receiver:profiles!receiving_staff_id(full_name)")
    .in("status", ["pending", "awaiting_acceptance"]).order("created_at", { ascending: true }).limit(100);
  if (!isSuperUser) tq = tq.eq("hospital_id", profile?.hospital_id ?? NONE);
  const { data: transferRows, error: tErr } = await tq;
  const transfers = (transferRows ?? []) as any[];
  const needRouting = transfers.filter(t => t.status === "pending");
  const awaiting = transfers.filter(t => t.status === "awaiting_acceptance");
  const migrationMissing = queue.migrationMissing || (!!tErr && /does not exist|schema cache/i.test(tErr.message));

  // Nurse candidates: nurse/charge staff on the tenant's ACTIVE shift.
  let nurses: { id: string; name: string }[] = [];
  {
    let sq = admin.from("op_shifts").select("id").eq("status", "active").order("created_at", { ascending: false }).limit(1);
    if (!isSuperUser) sq = sq.eq("hospital_id", profile?.hospital_id ?? NONE);
    const { data: shifts } = await sq;
    if (shifts?.[0]) {
      const { data: staff } = await admin.from("op_shift_staff")
        .select("role, status, profiles!staff_id(id, full_name)")
        .eq("shift_id", shifts[0].id).in("role", ["nurse", "charge"]).in("status", ["assigned", "confirmed", "on_duty"]).limit(100);
      nurses = ((staff ?? []) as any[]).filter(s => s.profiles).map(s => ({ id: s.profiles.id, name: `${s.profiles.full_name ?? "Nurse"}${s.role === "charge" ? " (charge)" : ""}` }));
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Census &amp; Assignment</h1>
        <p className="text-sm text-gray-500 mt-1">The unassigned queue and the acceptance pipeline — offers and transfers move responsibility only when the nurse accepts.</p>
      </div>

      {migrationMissing && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          <p className="font-semibold text-amber-900">⚙️ State engine not yet enabled</p>
          <p className="text-sm text-amber-800 mt-1">Apply migration <code className="bg-amber-100 px-1.5 py-0.5 rounded font-mono text-xs">156-assignment-state-engine.sql</code>.</p>
        </div>
      )}

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className={card}><p className={`text-2xl font-bold tabular-nums ${queue.unassigned.length > 0 ? "text-red-600" : "text-gray-900"}`}>{queue.unassigned.length}</p><p className="text-xs text-gray-500 mt-0.5">unassigned patients (no owner, no offer)</p></div>
        <div className={card}><p className={`text-2xl font-bold tabular-nums ${queue.pendingAcceptance.length > 0 ? "text-amber-600" : "text-gray-900"}`}>{queue.pendingAcceptance.length}</p><p className="text-xs text-gray-500 mt-0.5">offers awaiting nurse acceptance</p></div>
        <div className={card}><p className={`text-2xl font-bold tabular-nums ${needRouting.length > 0 ? "text-orange-600" : "text-gray-900"}`}>{needRouting.length}</p><p className="text-xs text-gray-500 mt-0.5">transfers needing a receiving nurse</p></div>
        <div className={card}><p className="text-2xl font-bold tabular-nums text-gray-900">{awaiting.length}</p><p className="text-xs text-gray-500 mt-0.5">transfers awaiting receiving acceptance</p></div>
      </div>

      <div className={card}>
        <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">🗂️ Unassigned Queue <span className="text-gray-400 font-normal">({queue.unassigned.length})</span></h3>
        {nurses.length === 0 && <p className="text-xs text-amber-700 mb-2">No nurse-tier staff present on an active shift — activate and staff a shift to offer assignments.</p>}
        <div className="divide-y divide-gray-100">
          {queue.unassigned.length === 0 && !migrationMissing && <p className="text-sm text-gray-400">Every patient on the census has an owner or a live offer. New admissions land here.</p>}
          {queue.unassigned.map((p: any) => (
            <div key={p.id} className="py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-gray-800">{p.op_beds?.label ? `${p.op_beds.label} · ` : ""}{p.label}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${ACUITY[p.acuity_level] ?? ACUITY.stable}`}>{titleCase(p.acuity_level)}</span>
                {p.isolation_status !== "none" && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700">{titleCase(p.isolation_status)}</span>}
                {p.units?.name && <span className="text-xs text-gray-400">{p.units.name}</span>}
                <span className="ml-auto text-[11px] text-gray-400">in census since {fmtWhen(p.created_at)}</span>
              </div>
              {p.diagnosis && <p className="text-xs text-gray-500 mt-0.5">{p.diagnosis}</p>}
              <AssignPatient patientId={p.id} nurses={nurses} />
            </div>
          ))}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">⏳ Offers Awaiting Acceptance <span className="text-gray-400 font-normal">({queue.pendingAcceptance.length})</span></h3>
          <div className="divide-y divide-gray-50">
            {queue.pendingAcceptance.length === 0 && <p className="text-sm text-gray-400">No offers in flight.</p>}
            {queue.pendingAcceptance.map((p: any) => (
              <p key={p.id} className="py-2 text-sm text-gray-700 flex flex-wrap items-center gap-2">
                <span className="font-medium">{p.label}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${ACUITY[p.acuity_level] ?? ACUITY.stable}`}>{titleCase(p.acuity_level)}</span>
                <span className="text-xs text-gray-400 ml-auto">offered to {p.pending_with ?? "—"}</span>
              </p>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-2">The current owner (or you) stays accountable until the nurse accepts. Declines return here with their reason.</p>
        </div>

        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">🔀 Transfer Routing <span className="text-gray-400 font-normal">({transfers.length})</span></h3>
          <div className="divide-y divide-gray-50">
            {transfers.length === 0 && <p className="text-sm text-gray-400">No transfers in flight.</p>}
            {needRouting.map((t: any) => (
              <div key={t.id} className="py-2.5">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium text-gray-800">{t.op_patients?.label}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-cyan-100 text-cyan-700">{titleCase(t.transfer_type)}</span>
                  <span className="text-xs text-gray-500">{t.destination ?? t.to_room ?? ""}</span>
                  <span className="ml-auto text-[11px] text-gray-400">{t.initiator?.full_name ?? "—"} · {fmtWhen(t.created_at)}</span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">{t.reason}</p>
                <RouteTransfer transferId={t.id} nurses={nurses} />
              </div>
            ))}
            {awaiting.map((t: any) => (
              <p key={t.id} className="py-2 text-sm text-gray-700 flex flex-wrap items-center gap-2">
                <span className="font-medium">{t.op_patients?.label}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">Awaiting acceptance</span>
                <span className="text-xs text-gray-400 ml-auto">→ {t.receiver?.full_name ?? "—"}</span>
              </p>
            ))}
          </div>
        </div>
      </div>

      <p className="text-center text-[11px] text-gray-400 pt-1">
        Episode closure (discharge / transfer-out / deceased) is available per patient via the census API; declined offers and every transition are audit-logged.
      </p>
    </div>
  );
}
