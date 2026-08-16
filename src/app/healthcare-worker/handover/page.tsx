import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { titleCase, fmtWhen, StatCard, SectionCard, Empty, Chip, AcuityChip } from "@/lib/hww/kit";
import SbarForm from "./SbarForm";
import { AskClarification, AnswerClarification } from "./Clarify";
import { estateRolesOf } from "@/lib/roles";

// Handover / SBAR (HWW-WARD-001 S4.11 / HWW-HND-001) — the nurse-to-nurse
// handover surface: per-patient SBAR builder against the tenant's open
// handover, responsibility transfer (accept → complete), outstanding tasks
// carried with each patient, and clarifications (incoming asks, outgoing
// answers). Rides op_handovers/op_handover_items (079) with the frontline
// access rule: my assigned patients only.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

const ITEM_TONE: Record<string, string> = {
  pending: "bg-gray-100 text-gray-500", in_progress: "bg-[var(--cmp-surface-information)] text-blue-700",
  reviewed: "bg-indigo-100 text-indigo-700", accepted: "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]", completed: "bg-[var(--cmp-surface-success)] text-emerald-700",
};

export default async function HandoverPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("hospital_id, role, roles").eq("id", user.id).single();
  const roles: string[] = estateRolesOf(profile);
  const NONE = "00000000-0000-0000-0000-000000000000";
  const scope = (q: any) => (roles.includes("super_admin") ? q : q.eq("hospital_id", profile?.hospital_id ?? NONE));

  // My patients + the tenant's open handover + its items for my patients.
  const { data: asg } = await admin.from("op_patient_assignments")
    .select("op_patients!patient_id(id, label, acuity_level, op_beds!bed_id(label))")
    .eq("staff_id", user.id).eq("status", "active").limit(50);
  const patients = ((asg ?? []) as any[]).filter(a => a.op_patients).map(a => a.op_patients);
  const mine = patients.map(p => p.id);

  const { data: hoRows } = await scope(admin.from("op_handovers").select("*").neq("status", "accepted").order("created_at", { ascending: false })).limit(1);
  const handover = hoRows?.[0] ?? null;

  let items: any[] = [];
  if (handover && mine.length) {
    const { data } = await admin.from("op_handover_items").select("*")
      .eq("handover_id", handover.id).in("patient_id", mine).limit(100);
    items = data ?? [];
  }
  const itemFor = (pid: string) => items.find((i: any) => i.patient_id === pid) ?? null;

  // Outstanding tasks carried per patient + pending clarifications on my patients.
  const [taskRes, clarRes] = await Promise.all([
    mine.length
      ? admin.from("op_tasks").select("patient_id").in("patient_id", mine).not("status", "in", "(completed,verified,cancelled)").limit(300)
      : Promise.resolve({ data: [] }),
    mine.length
      ? admin.from("op_handover_clarifications").select("*, op_patients!patient_id(label)").in("patient_id", mine).order("created_at", { ascending: false }).limit(50)
      : Promise.resolve({ data: [] }),
  ]);
  const openTaskCount = (pid: string) => (((taskRes as any).data ?? []) as any[]).filter(t => t.patient_id === pid).length;
  const clarifications = ((clarRes as any).data ?? []) as any[];
  const pendingClar = clarifications.filter(c => c.status === "pending");

  const withSbar = patients.filter(p => { const it = itemFor(p.id); return it && (it.sbar_situation || it.sbar_background || it.sbar_assessment || it.sbar_recommendation); }).length;
  const accepted = patients.filter(p => ["accepted", "completed"].includes(itemFor(p.id)?.item_status ?? "")).length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Handover (SBAR)</h1>
        <p className="text-sm text-gray-500 mt-1">Prepare SBAR for each of your patients, transfer responsibility, and clear clarifications before the shift ends.</p>
      </div>

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard icon="🔄" title="Open Handover" value={handover ? titleCase(handover.status) : "None"}
          sub={handover ? `started ${fmtWhen(handover.created_at)}` : "saving an SBAR opens one"} />
        <StatCard icon="📝" title="SBAR Prepared" value={`${withSbar}/${patients.length}`} sub="of my patients" />
        <StatCard icon="🤝" title="Accepted" value={`${accepted}/${patients.length}`} sub="responsibility transferred" />
        <StatCard icon="❓" title="Open Clarifications" value={pendingClar.length} tone={pendingClar.length > 0 ? "text-[var(--cmp-text-warning)]" : undefined} sub="on my patients" />
      </div>

      <SectionCard icon="🧑‍⚕️" title="My Patients — SBAR & Transfer" count={patients.length}>
        {patients.length === 0 ? (
          <Empty>No active patient assignments to hand over.</Empty>
        ) : (
          <div className="divide-y divide-gray-100">
            {patients.map((p: any) => {
              const it = itemFor(p.id);
              const tasks = openTaskCount(p.id);
              return (
                <div key={p.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-800">{p.label}</span>
                    {p.op_beds?.label && <span className="text-xs text-gray-400">{p.op_beds.label}</span>}
                    <AcuityChip level={p.acuity_level} />
                    <Chip tone={ITEM_TONE[it?.item_status ?? "pending"] ?? ITEM_TONE.pending}>{titleCase(it?.item_status ?? "not started")}</Chip>
                    {tasks > 0 && <Chip tone="bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]">{tasks} outstanding task{tasks === 1 ? "" : "s"}</Chip>}
                    {it?.jbi_score != null && <Chip tone="bg-cyan-100 text-cyan-700">JBI {it.jbi_score}%</Chip>}
                  </div>
                  {it && (it.sbar_situation || it.sbar_background || it.sbar_assessment || it.sbar_recommendation) && (
                    <div className="mt-1.5 grid sm:grid-cols-2 gap-x-6 gap-y-0.5 text-xs text-gray-600">
                      {it.sbar_situation && <p><span className="font-semibold text-gray-400">S</span> {it.sbar_situation}</p>}
                      {it.sbar_background && <p><span className="font-semibold text-gray-400">B</span> {it.sbar_background}</p>}
                      {it.sbar_assessment && <p><span className="font-semibold text-gray-400">A</span> {it.sbar_assessment}</p>}
                      {it.sbar_recommendation && <p><span className="font-semibold text-gray-400">R</span> {it.sbar_recommendation}</p>}
                    </div>
                  )}
                  <SbarForm patientId={p.id} patientLabel={p.label}
                    existing={{ situation: it?.sbar_situation, background: it?.sbar_background, assessment: it?.sbar_assessment, recommendation: it?.sbar_recommendation }}
                    itemStatus={it?.item_status ?? null} />
                  <div className="mt-1.5"><AskClarification patientId={p.id} patientLabel={p.label} /></div>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      <SectionCard icon="❓" title="Clarifications On My Patients" count={clarifications.length}>
        {clarifications.length === 0 ? <Empty>None raised. The incoming nurse can ask about any of your patients; questions land here for you to answer.</Empty> : (
          <div className="divide-y divide-gray-100">
            {clarifications.map((c: any) => (
              <div key={c.id} className="py-2.5">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium text-gray-800">{c.op_patients?.label ?? "Patient"}</span>
                  <Chip tone={c.status === "pending" ? "bg-[var(--cmp-surface-warning)] text-orange-700" : "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]"}>{titleCase(c.status)}</Chip>
                  <span className="text-xs text-gray-400 ml-auto">{fmtWhen(c.created_at)}</span>
                </div>
                <p className="text-sm text-gray-700 mt-0.5">Q: {c.question}</p>
                {c.answer
                  ? <p className="text-sm text-emerald-800 mt-0.5">A: {c.answer} <span className="text-xs text-gray-400">— {c.answered_by_name ?? ""}</span></p>
                  : <AnswerClarification id={c.id} />}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <p className="text-center text-[11px] text-gray-400 pt-1">
        Carried-forward concerns travel with the handover automatically (Nurse Concerns module). The supervisor&apos;s Handover Centre sees the same records — one handover, two lenses.
      </p>
    </div>
  );
}
