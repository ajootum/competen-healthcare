import { loadCmoMembership } from "@/lib/competency/cmo-membership";
import { cmoGuard, Head, Card, Kpi, Donut, Ring, Pill, Provision, Foot } from "../_cmo-ui";
import Link from "next/link";

export const dynamic = "force-dynamic";

// CMO-003 Office Membership & Role Management — establish, staff, govern and empower competency offices
// across the organisation. The "office" = a governance committee (governance_committees); members carry the
// three real roles (chair / member / reviewer); acting authority = adm_delegations. Read model — appointment
// write-workflows, the delegation write-engine, no-code office-type config and the org-chart visual are next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */
const HEX: Record<string, string> = { slate: "#94a3b8", amber: "#f59e0b", blue: "#3b82f6", violet: "#a855f7", emerald: "#22c55e", rose: "#ef4444", teal: "#14b8a6" };
const fmtD = (t: string | null) => { if (!t) return "—"; try { return new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); } catch { return "—"; } };

export default async function OfficeMembershipPage() {
  const { admin, isSuper, hid } = await cmoGuard();
  const d = await loadCmoMembership(admin, hid, isSuper);
  const head = <Head code="CMO-003 · Competency Office" title="Office Membership & Role Management" sub="Establish, staff, govern and empower competency offices across the organisation." />;
  if (!d.provisioned) return <div className="max-w-[1400px] space-y-4">{head}<Provision module="Office Membership" part="part 2" /></div>;
  const k = d.kpis;
  const po = d.primaryOffice;

  return (
    <div className="max-w-[1400px] space-y-4">
      {head}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Competency Offices" value={k.offices} sub="governance committees" />
        <Kpi label="Total Members" value={k.members} sub="distinct people" />
        <Kpi label="Chairs appointed" value={k.chairs} sub={k.officesNoChair ? `${k.officesNoChair} office${k.officesNoChair > 1 ? "s" : ""} without a chair` : "every office chaired"} tone={k.officesNoChair ? "text-amber-600" : "text-emerald-600"} />
        <Kpi label="Delegations active" value={k.delegationsActive ?? "—"} sub={d.delegationsTableOk ? "acting authority" : "store not provisioned"} tone={k.delegationsActive ? "text-blue-600" : undefined} />
        <Kpi label="Reviewers" value={k.reviewers} sub="review role" />
        <Kpi label="Membership compliance" value={`${k.compliancePct}%`} sub="chaired & at quorum" tone={k.compliancePct >= 80 ? "text-emerald-600" : k.compliancePct >= 50 ? "text-amber-600" : "text-rose-600"} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="My Competency Office" right={<Link href="/competency-office" className="text-[11px] text-teal-600 hover:underline">Office dashboard →</Link>}>
          {po ? <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2"><p className="text-base font-bold text-gray-900 truncate">{po.name}</p><Pill text={po.level} tone={d.levelTone[po.level] ?? "slate"} /></div>
            <div className="grid grid-cols-2 gap-2 text-[12px]">
              <div><p className="text-gray-400 text-[10px] uppercase tracking-wide">Members</p><p className="font-semibold text-gray-900 tabular-nums">{po.memberCount}</p></div>
              <div><p className="text-gray-400 text-[10px] uppercase tracking-wide">Quorum</p><p className="font-semibold text-gray-900 tabular-nums">{po.quorum || "—"}</p></div>
              <div><p className="text-gray-400 text-[10px] uppercase tracking-wide">Chair</p><p className="font-semibold text-gray-900 truncate">{po.chairName ?? "— vacant"}</p></div>
              <div><p className="text-gray-400 text-[10px] uppercase tracking-wide">Established</p><p className="font-semibold text-gray-900">{fmtD(po.established)}</p></div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <Pill text={po.active ? "active" : "inactive"} tone={po.active ? "emerald" : "slate"} />
              {po.hasChair ? <Pill text="chaired" tone="teal" /> : <Pill text="chair vacant" tone="amber" />}
              {po.meetsQuorum ? <Pill text="at quorum" tone="emerald" /> : <Pill text="below quorum" tone="rose" />}
            </div>
          </div> : <p className="text-sm text-gray-400 py-6 text-center">No office in scope.</p>}
        </Card>

        <Card title="Membership by role" right={<span className="text-[11px] text-gray-400">{d.roleTotal} seats</span>}>
          {d.roleTotal ? <div className="flex items-center gap-3">
            <Donut segs={d.roleDonut.filter((s: any) => s.value > 0).map((s: any) => ({ n: s.value, color: s.color }))} total={d.roleTotal} centre={d.roleTotal} sub="members" size={110} />
            <div className="flex-1 space-y-1 text-[11px]">{d.roleDonut.map((s: any) => <div key={s.label} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: s.color }} /><span className="text-gray-600 flex-1">{s.label}</span><span className="font-semibold text-gray-900 tabular-nums">{s.value}</span></div>)}</div>
          </div> : <p className="text-sm text-gray-400 py-6 text-center">No members appointed yet.</p>}
          <p className="text-[10px] text-gray-400 mt-2">Live from <code>committee_members.role</code> — the three governed roles.</p>
        </Card>

        <Card title="Governance coverage" right={<span className="text-[11px] text-gray-400">composite</span>}>
          <div className="flex items-center gap-4">
            <Ring pct={k.compliancePct} size={92} label="chaired & at quorum" />
            <div className="flex-1 space-y-1.5 text-[12px]">
              <div className="flex justify-between"><span className="text-gray-600">Offices chaired</span><b className="tabular-nums">{k.offices - k.officesNoChair}/{k.offices}</b></div>
              <div className="flex justify-between"><span className="text-gray-600">At / above quorum</span><b className="tabular-nums">{k.offices - k.belowQuorum}/{k.offices}</b></div>
              <div className="flex justify-between"><span className="text-gray-600">Reviewers engaged</span><b className="tabular-nums">{k.reviewers}</b></div>
            </div>
          </div>
          <p className="text-[10px] text-gray-400 mt-2">Governed composite: share of offices that have a chair <em>and</em> meet their member quorum.</p>
        </Card>
      </div>

      <Card title="Office structure & directory" right={<Link href="/competency-office/publishing" className="text-[11px] text-teal-600 hover:underline">Governance &amp; publication →</Link>}>
        <div className="space-y-1">
          <div className="flex items-center text-[10px] text-gray-400 uppercase tracking-wide px-1"><span className="flex-1">Office</span><span className="w-24">Level</span><span className="w-16 text-center">Members</span><span className="w-40">Chair</span><span className="w-20 text-center">Quorum</span><span className="w-20 text-right">Status</span></div>
          {d.offices.map((o: any) => (
            <div key={o.id} className="flex items-center px-1 py-1.5 text-[12px] border-b border-gray-50">
              <span className="flex-1 text-gray-800 truncate">{o.name}</span>
              <span className="w-24"><Pill text={o.level} tone={d.levelTone[o.level] ?? "slate"} /></span>
              <span className="w-16 text-center text-gray-700 tabular-nums">{o.memberCount}</span>
              <span className="w-40 text-gray-600 truncate">{o.chairName ?? "— vacant"}</span>
              <span className={`w-20 text-center tabular-nums ${o.meetsQuorum ? "text-gray-500" : "text-rose-600 font-semibold"}`}>{o.memberCount}/{o.quorum || "—"}</span>
              <span className="w-20 text-right"><Pill text={o.active ? "active" : "inactive"} tone={o.active ? "emerald" : "slate"} /></span>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-gray-400 mt-2">The organisation directory of competency offices from <code>governance_committees</code>. Appointment / removal write-workflows are managed via the governance committees engine — next build phase in this workspace.</p>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Recent membership activity" className="xl:col-span-2" right={<span className="text-[11px] text-gray-400">appointments &amp; delegations</span>}>
          {d.recentActivity.length ? <div className="space-y-1">
            <div className="flex items-center text-[10px] text-gray-400 uppercase tracking-wide px-1"><span className="flex-1">Person</span><span className="w-28">Role</span><span className="flex-1">Office / authority</span><span className="w-24 text-right">When</span></div>
            {d.recentActivity.map((a: any, i: number) => (
              <div key={i} className="flex items-center px-1 py-1.5 text-[12px] border-b border-gray-50">
                <span className="flex-1 text-gray-800 truncate">{a.who}</span>
                <span className="w-28"><Pill text={a.role} tone={a.kind === "delegation" ? "amber" : (d.roleTone[a.role] ?? "slate")} /></span>
                <span className="flex-1 text-gray-600 truncate">{a.kind === "delegation" ? `Acting: ${a.what}` : a.what}</span>
                <span className="w-24 text-right text-gray-400 text-[11px]">{fmtD(a.when)}</span>
              </div>
            ))}
          </div> : <p className="text-sm text-gray-400 py-6 text-center">No membership or delegation activity yet.</p>}
        </Card>

        <Card title="AI Office Administration Copilot" right={<Pill text="rule-based" tone="violet" />}>
          <div className="space-y-2">{d.copilot.map((c: any, i: number) => (
            <div key={i} className="flex items-start gap-2"><span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: HEX[c.tone] }} /><div className="min-w-0"><p className="text-[12px] font-medium text-gray-800 leading-snug">{c.title}</p><p className="text-[11px] text-gray-500">{c.detail}</p></div></div>
          ))}</div>
          {d.aiRecs.length > 0 && <div className="mt-3 pt-3 border-t border-gray-100">
            <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1.5">From AI recommendations store</p>
            <div className="space-y-1.5">{d.aiRecs.map((r: any, i: number) => (
              <div key={i} className="flex items-start gap-2"><span className="text-[11px]">💡</span><div className="min-w-0"><p className="text-[12px] text-gray-700 leading-snug truncate">{r.title}</p>{r.detail && <p className="text-[10px] text-gray-400 truncate">{r.detail}</p>}</div></div>
            ))}</div>
          </div>}
          <p className="text-[10px] text-gray-400 mt-3">Rule-based signals derived from live office / member / quorum data. The generative office copilot is the next phase.</p>
        </Card>
      </div>

      <Foot>CMO-003 — live over <code>governance_committees</code> (the Competency Office object) + <code>committee_members</code> (chair / member / reviewer roles) + <code>adm_delegations</code> (acting authority). The office = a governance committee. Join-request / invitation / appointment write-workflows, the delegation write-engine, no-code office-type configuration and the full org-chart visual are the next build phase.</Foot>
    </div>
  );
}
