import { ogsGuard, Head, Stat, Card, Pill, Donut, Legend, Table, Foot, T } from "../_ui";
import { loadOgsDelegation } from "@/lib/ogs/delegation";
import DelegateForm from "./DelegateForm";
import RevokeButton from "./RevokeButton";

const NONE = "00000000-0000-0000-0000-000000000000";

export const dynamic = "force-dynamic";

// OGS-003 Authority & Delegation Centre — office authority roles, delegations and approval powers, grounded
// in adm_delegations + committee_members (chairs = full authority). Delegation type is derived honestly from
// the data; acting / emergency / scope-limited types, approval chains and conflict checks are next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */
const STATUS_TONE: Record<string, string> = { active: "emerald", scheduled: "blue", expired: "slate", revoked: "rose" };

export default async function OgsDelegationCentre() {
  const { admin, isSuper, hid } = await ogsGuard();
  const d = await loadOgsDelegation(admin, hid, isSuper);
  const head = <Head code="OGS-003 · Office Governance System" title="Authority & Delegation Centre" sub="Manage office authority roles, delegations and approval powers." />;
  if (!d.provisioned) return <div className="space-y-4">{head}<Card><p className="text-sm text-gray-400">The delegation store (<code>adm_delegations</code>) is not provisioned yet. Once its migration is applied, this module lights up with live delegations and authority coverage.</p></Card></div>;
  const k = d.kpis;

  const peopleQ = admin.from("profiles").select("id, full_name, role").order("full_name").limit(500);
  const { data: peopleRows } = await (isSuper ? peopleQ : peopleQ.eq("hospital_id", hid ?? NONE));
  const people = ((peopleRows ?? []) as any[]).map(p => ({ id: p.id, full_name: p.full_name, role: p.role }));

  return (
    <div className="space-y-4">
      {head}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <Stat icon="🗝️" tone="teal" label="Active delegations" value={k.activeDelegations} sub="in force now" />
        <Stat icon="⏳" tone="amber" label="Expiring soon" value={k.expiringSoon} sub="within 30 days" />
        <Stat icon="👥" tone="blue" label="Delegated approvers" value={k.delegatedApprovers} sub="distinct delegates" />
        <Stat icon="🛡️" tone={k.authorityCoverage != null && k.authorityCoverage >= 85 ? "emerald" : "amber"} label="Authority coverage" value={k.authorityCoverage != null ? `${k.authorityCoverage}%` : "—"} sub="active offices chaired" />
        <Stat icon="📋" tone="indigo" label="Total delegations" value={k.totalDelegations} sub="all statuses" />
      </div>

      <DelegateForm people={people} scopeHid={hid} isSuper={isSuper} />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Office authority structure" className="xl:col-span-2" right="chair = full authority">
          {d.offices.length ? (
            <div className="space-y-2.5">
              {d.offices.map((o: any) => (
                <div key={o.id} className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-lg bg-teal-100 text-teal-700 flex items-center justify-center text-sm font-bold shrink-0">{(o.chair?.[0] ?? o.name?.[0] ?? "?").toUpperCase()}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] font-medium text-gray-800 truncate">{o.name}</p>
                    <p className="text-[10.5px] text-gray-400 truncate">{o.level} office · Chair: {o.chair ?? <span className="text-rose-500">unfilled</span>}</p>
                  </div>
                  <span className="text-[11px] text-gray-500 tabular-nums shrink-0">{o.members} member{o.members === 1 ? "" : "s"}</span>
                  <Pill text={o.chair ? "full authority" : "no chair"} tone={o.chair ? "violet" : "slate"} />
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-gray-400 py-6 text-center">No governance offices registered.</p>}
          <p className="text-[10px] text-gray-400 mt-3">Chairs hold full office authority; members contribute. Grounded in <code>committee_members</code> roles — the formal authority-matrix (per-decision approval powers) is next-phase.</p>
        </Card>

        <Card title="Delegation by type">
          <div className="flex items-center gap-2">
            <Donut segments={d.byType} total={k.totalDelegations} label="Delegations" size={130} />
            <Legend items={d.byType.map((s: any) => ({ label: s.label, value: s.value, tone: s.tone, pct: k.totalDelegations ? Math.round((s.value / k.totalDelegations) * 100) : 0 }))} />
          </div>
          <p className="text-[10px] text-gray-400 mt-2">Type <em>derived</em> from the data: open-ended (no valid-to) ⇒ Permanent, else Time-limited. Acting, emergency &amp; scope-limited types are the next-phase OGS-003 engine.</p>
        </Card>
      </div>

      <Card title="Active delegations" right={`${k.totalDelegations} in register`}>
        <Table
          cols={["Title / position", "Delegate", "Delegated by", "Type", "Valid from", "Valid to", "Status"]}
          rows={d.delegationRows.map((r: any) => [
            <span key="p" className="font-medium text-gray-800">{r.position}</span>,
            <span key="d" className="text-gray-600">{r.delegate}</span>,
            <span key="b" className="text-gray-500">{r.delegatedBy}</span>,
            <Pill key="t" text={r.type} tone={r.type === "Permanent" ? "indigo" : "amber"} />,
            <span key="vf" className="tabular-nums text-gray-500">{r.validFrom}</span>,
            <span key="vt" className="tabular-nums text-gray-500">{r.validTo}</span>,
            <span key="s" className="inline-flex items-center"><Pill text={r.status} tone={STATUS_TONE[r.status] ?? "slate"} /><RevokeButton id={r.id} status={r.status} /></span>,
          ])}
          empty="No delegations recorded."
        />
      </Card>

      <Card title="Upcoming expirations" right="active · next 60 days">
        {d.expirations.length ? (
          <div className="space-y-2">
            {d.expirations.map((e: any, i: number) => (
              <div key={i} className="flex items-center gap-2.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: T(e.tone).hex }} />
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-medium text-gray-800 truncate">{e.position}</p>
                  <p className="text-[10.5px] text-gray-400 truncate">{e.delegate} · expires {e.validTo}</p>
                </div>
                <span className="text-[11px] font-semibold tabular-nums shrink-0" style={{ color: T(e.tone).hex }}>{e.daysLeft}d left</span>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-gray-400 py-6 text-center">No active delegations expiring in the next 60 days.</p>}
      </Card>

      <Foot>OGS-003 — live over <code>adm_delegations</code> (delegations) and <code>committee_members</code> (authority holders, chairs = full authority). Delegation type is <em>derived</em> from valid-to (Permanent vs Time-limited); delegation types beyond those (acting, emergency, scope-limited), approval chains and conflict-of-interest checks are the next-phase OGS-003 engine (an office-scoped delegation table). Delegations are hospital/position-scoped today, not yet office-linked.</Foot>
    </div>
  );
}
