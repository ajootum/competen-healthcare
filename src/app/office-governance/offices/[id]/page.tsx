import { ogsGuard, Head, Stat, Card, Pill, Table, Foot } from "../../_ui";
import { loadOfficeAdmin } from "@/lib/ogs/office";
import { loadOgsMeetings } from "@/lib/ogs/meetings";
import { STATE_LABEL, APPOINTMENT_ROLE_LABEL } from "@/lib/ogs/lifecycle";
import Link from "next/link";

export const dynamic = "force-dynamic";

// OGS R001 — Office Dashboard. A shareable read view of ONE office's governance record: identity, charter
// (current + history), members, its meetings & formal decisions, and the immutable lifecycle-transition log.
// Management (constitute/appoint/transition/charter) lives on /offices; this page is the office's home.
/* eslint-disable @typescript-eslint/no-explicit-any */

const STATUS_TONE: Record<string, string> = { active: "emerald", approved: "emerald", under_review: "amber", pending_approval: "amber", proposed: "blue", in_design: "blue", suspended: "rose", restructuring: "amber", closing: "rose", dissolved: "slate", archived: "slate", template: "slate" };
const CH_TONE: Record<string, string> = { approved: "emerald", draft: "blue", pending: "amber", superseded: "slate" };
const OUT_TONE: Record<string, string> = { carried: "emerald", rejected: "rose", deferred: "amber", tabled: "slate" };
const M_TONE: Record<string, string> = { scheduled: "blue", in_progress: "amber", held: "emerald", cancelled: "slate" };
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const fmtDT = (d: string | null) => (d ? new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

export default async function OfficeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { admin, isSuper, hid } = await ogsGuard();
  const { provisioned, offices } = await loadOfficeAdmin(admin, hid, isSuper);
  const office = offices.find(o => o.id === id) ?? null;

  const back = <Link href="/office-governance/offices" className="text-[12px] text-teal-600 hover:underline">← All offices</Link>;
  if (!provisioned || !office) {
    return <div className="space-y-4"><Head code="OGS-001 · Office Governance System" title="Office" sub="Office governance record" />{back}<Card><p className="text-sm text-gray-400">{provisioned ? "Office not found or out of scope." : "The office model is not provisioned yet — run migrations 116/117."}</p></Card></div>;
  }

  const current = office.charters.find(c => c.version === office.charterVersion) ?? office.charters[0] ?? null;
  const history = office.charters.filter(c => c.id !== current?.id);

  const meetingsData = await loadOgsMeetings(admin, hid, isSuper);
  const meetings = (meetingsData.provisioned ? meetingsData.meetings : []).filter((m: any) => m.officeId === id);
  const decisions = meetings.flatMap((m: any) => m.decisions.map((d: any) => ({ ...d, meeting: m.title })));
  const openActions = meetings.flatMap((m: any) => m.actions).filter((a: any) => a.status === "open" || a.status === "in_progress").length;

  const { data: transRows } = await admin.from("ogs_lifecycle_transitions").select("from_state, to_state, reason, actor_name, occurred_at").eq("office_id", id).order("occurred_at", { ascending: false }).limit(50);
  const transitions = (transRows ?? []) as any[];

  return (
    <div className="space-y-4">
      <Head code="OGS-001 · Office Governance System" title={office.name} sub={`${office.officeType} office · ${office.scopeType} scope · ${office.authoritySource ?? "authority not set"}`} action={{ label: "Manage →", href: "/office-governance/offices" }} />
      <div className="flex items-center gap-3 flex-wrap">{back}<Pill text={STATE_LABEL[office.status] ?? office.status} tone={STATUS_TONE[office.status] ?? "slate"} /><span className="text-[12px] text-gray-500">Chair: {office.chairName ?? "vacant"} · Charter {office.charterVersion ?? "—"} · Next review {fmtDate(office.nextReview)} · Established {fmtDate(office.establishedAt)}</span></div>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-3">
        <Stat icon="👥" tone="blue" label="Members" value={office.memberCount} sub={`quorum ${office.quorum}`} />
        <Stat icon="🗳️" tone="violet" label="Meetings" value={meetings.length} />
        <Stat icon="⚖️" tone="indigo" label="Decisions" value={decisions.length} />
        <Stat icon="📌" tone={openActions ? "amber" : "emerald"} label="Open actions" value={openActions} />
        <Stat icon="📜" tone="teal" label="Charter versions" value={office.charters.length} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Charter" className="xl:col-span-2" right={current ? <Pill text={`${current.version} · ${current.approvalStatus}`} tone={CH_TONE[current.approvalStatus] ?? "slate"} /> : undefined}>
          {current ? (
            <div className="text-[13px] text-gray-700 space-y-2">
              <p className="text-[11px] text-gray-400">Effective {fmtDate(current.effectiveFrom)} · review {fmtDate(current.reviewDate)} · approved by {current.approvedBy ?? "—"}</p>
              {current.purpose && <div><p className="text-[10px] uppercase tracking-wide text-gray-400">Purpose</p><p>{current.purpose}</p></div>}
              {current.mandate && <div><p className="text-[10px] uppercase tracking-wide text-gray-400">Mandate</p><p>{current.mandate}</p></div>}
              {(current.quorumRule || current.decisionRule) && <p className="text-[12px] text-gray-500">{current.quorumRule ?? ""}{current.quorumRule && current.decisionRule ? " · " : ""}{current.decisionRule ?? ""}</p>}
              {history.length > 0 && <div className="pt-1 border-t border-gray-50"><p className="text-[10px] text-gray-400 mb-1">Version history</p>{history.map(h => <div key={h.id} className="flex items-center gap-2 text-[11px] text-gray-500"><span className="font-medium text-gray-600">{h.version}</span><Pill text={h.approvalStatus} tone={CH_TONE[h.approvalStatus] ?? "slate"} /><span className="text-gray-400">{fmtDate(h.createdAt)}</span></div>)}</div>}
            </div>
          ) : <p className="text-sm text-gray-400">No charter on record.</p>}
        </Card>

        <Card title="Members" right={`${office.memberCount}/${office.quorum}`}>
          {office.appointments.length ? (
            <div className="space-y-1.5">{office.appointments.map(a => (
              <div key={a.id} className="flex items-center gap-2 text-[12px]"><span className="w-6 h-6 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-[10px] font-bold shrink-0">{(a.personName?.[0] ?? "?").toUpperCase()}</span><span className="flex-1 truncate text-gray-700">{a.personName ?? "Member"}</span><Pill text={APPOINTMENT_ROLE_LABEL[a.role] ?? a.role} tone={a.role === "chair" ? "violet" : a.role === "reviewer" ? "amber" : "blue"} /></div>
            ))}</div>
          ) : <p className="text-sm text-gray-400 py-4 text-center">No members appointed.</p>}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Meetings" right={<Link href="/office-governance/meetings" className="text-teal-600 hover:underline">Meetings &amp; Votes →</Link>}>
          {meetings.length ? (
            <div className="space-y-1.5">{meetings.slice(0, 8).map((m: any) => (
              <div key={m.id} className="flex items-center gap-2 text-[12px] border-b border-gray-50 pb-1"><span className="flex-1 min-w-0 truncate text-gray-800">{m.title}</span><span className="text-[10px] text-gray-400">{fmtDT(m.scheduledAt)}</span><span className={`text-[10px] px-1.5 py-0.5 rounded-full ${m.quorumMet ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>{m.present}/{m.requiredQuorum}</span><Pill text={m.status.replace(/_/g, " ")} tone={M_TONE[m.status] ?? "slate"} /></div>
            ))}</div>
          ) : <p className="text-sm text-gray-400 py-4 text-center">No meetings scheduled.</p>}
        </Card>

        <Card title="Formal decisions">
          {decisions.length ? (
            <div className="space-y-1.5">{decisions.slice(0, 8).map((d: any) => (
              <div key={d.id} className="flex items-center gap-2 text-[12px] border-b border-gray-50 pb-1"><span className="flex-1 min-w-0 truncate text-gray-800">{d.title}</span><span className="text-[10px] text-gray-500 tabular-nums whitespace-nowrap">✓{d.votesFor} ✕{d.votesAgainst} ~{d.votesAbstain}</span><Pill text={d.outcome} tone={OUT_TONE[d.outcome] ?? "slate"} /></div>
            ))}</div>
          ) : <p className="text-sm text-gray-400 py-4 text-center">No decisions recorded.</p>}
        </Card>
      </div>

      <Card title="Lifecycle history" right="immutable">
        {transitions.length ? (
          <Table
            cols={["From", "To", "Reason", "By", "When"]}
            rows={transitions.map((t: any) => [
              <span key="f" className="text-gray-500">{t.from_state ? (STATE_LABEL[t.from_state] ?? t.from_state) : "—"}</span>,
              <Pill key="t" text={STATE_LABEL[t.to_state] ?? t.to_state} tone={STATUS_TONE[t.to_state] ?? "slate"} />,
              <span key="r" className="text-gray-600">{t.reason ?? "—"}</span>,
              <span key="a" className="text-gray-500">{t.actor_name ?? "—"}</span>,
              <span key="w" className="tabular-nums text-gray-400">{fmtDT(t.occurred_at)}</span>,
            ])}
            empty="No transitions recorded."
          />
        ) : <p className="text-sm text-gray-400 py-4 text-center">No lifecycle transitions recorded.</p>}
      </Card>

      <Foot>OGS-001 — the office&apos;s governance record over the first-class <code>ogs_offices</code> model: identity, charter (current + versions), appointments, its meetings &amp; vote-tallied decisions, and the immutable <code>ogs_lifecycle_transitions</code> log. Read view — constitute, appoint, transition and amend from <Link href="/office-governance/offices" className="text-teal-600 hover:underline">Offices — Constitute &amp; Manage</Link>.</Foot>
    </div>
  );
}
