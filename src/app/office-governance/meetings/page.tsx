import { ogsGuard, Head, Stat, Card, Foot } from "../_ui";
import { loadOgsMeetings } from "@/lib/ogs/meetings";
import MeetingsAdmin from "./MeetingsAdmin";

export const dynamic = "force-dynamic";

// OGS-004 Meetings & Votes — the operational governance surface. Schedule meetings, track attendance against
// live quorum, run the agenda, record decisions (with vote tallies) and manage the actions arising — all over
// the real ogs_meetings model (migrations 118/119). Server page loads the model + people; MeetingsAdmin writes.
/* eslint-disable @typescript-eslint/no-explicit-any */
const NONE = "00000000-0000-0000-0000-000000000000";

export default async function MeetingsPage() {
  const { admin, isSuper, hid, fullName } = await ogsGuard();
  const d = await loadOgsMeetings(admin, hid, isSuper);
  const head = <Head code="OGS-004 · Office Governance System" title="Meetings & Votes" sub={`Schedule meetings, track quorum, record decisions & votes and manage actions · ${fullName}`} />;
  if (!d.provisioned) return <div className="space-y-4">{head}<Card><p className="text-sm text-gray-400">The meetings model (<code>ogs_meetings</code>) is not provisioned yet — run migrations 118/119 to enable scheduling meetings, recording decisions and tracking quorum.</p></Card></div>;

  const peopleQ = admin.from("profiles").select("id, full_name, role").order("full_name").limit(500);
  const { data: peopleRows } = await (isSuper ? peopleQ : peopleQ.eq("hospital_id", hid ?? NONE));
  const people = ((peopleRows ?? []) as any[]).map(p => ({ id: p.id, full_name: p.full_name, role: p.role }));
  const k = d.kpis;

  return (
    <div className="space-y-4">
      {head}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <Stat icon="📅" tone="blue" label="Upcoming meetings" value={k.upcoming} sub="scheduled ahead" />
        <Stat icon="✅" tone="emerald" label="Meetings held" value={k.held} />
        <Stat icon="⚖️" tone="violet" label="Decisions recorded" value={k.decisions} />
        <Stat icon="📌" tone={k.openActions ? "amber" : "emerald"} label="Open actions" value={k.openActions} />
        <Stat icon="👥" tone={k.quorumRate != null && k.quorumRate >= 80 ? "emerald" : "amber"} label="Quorum rate" value={k.quorumRate != null ? `${k.quorumRate}%` : "—"} sub="of held meetings" />
      </div>
      <MeetingsAdmin meetings={d.meetings} offices={d.offices} people={people} scopeHid={hid} isSuper={isSuper} />
      <Foot>OGS-004 — live over the real <code>ogs_meetings</code> / <code>ogs_meeting_attendance</code> / <code>ogs_agenda_items</code> / <code>ogs_decisions</code> / <code>ogs_office_actions</code> model. Scheduling auto-invites the office&apos;s active appointees so quorum tracks against real membership; decisions carry a vote tally (for / against / abstain) and outcome. Per-member roll-call voting, minutes circulation and e-signatures are the next refinement.</Foot>
    </div>
  );
}
