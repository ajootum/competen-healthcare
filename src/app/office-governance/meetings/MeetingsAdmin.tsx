"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { OgsSignButton } from "@/components/OgsSignButton";

// OGS-004 meetings & votes client surface — schedule meetings, mark attendance (live quorum), run the agenda,
// record decisions with vote tallies and manage actions. Talks to /api/office-governance/meetings*; every
// success router.refresh()es the server page (ogsGuard-scoped). Admin-gated server-side.
/* eslint-disable @typescript-eslint/no-explicit-any */

type Person = { id: string; full_name: string | null; role: string | null };
type OfficeOpt = { id: string; name: string; quorum: number; status: string };
type Attendee = { id: string; personId: string | null; personName: string | null; role: string | null; status: string };
type AgendaItem = { id: string; seq: number; title: string; description: string | null; itemType: string; status: string };
type Sig = { signerName: string | null; signerRole: string | null; signedAt: string | null };
type Decision = { id: string; title: string; description: string | null; decisionType: string; outcome: string; votesFor: number; votesAgainst: number; votesAbstain: number; decidedAt: string | null; recordedByName: string | null; signatures: Sig[] };
type Action = { id: string; title: string; ownerName: string | null; dueDate: string | null; status: string };
type Meeting = { id: string; officeId: string; officeName: string; title: string; meetingType: string; scheduledAt: string | null; location: string | null; status: string; requiredQuorum: number; chairedByName: string | null; minutes: string | null; heldAt: string | null; attendance: Attendee[]; invited: number; present: number; quorumMet: boolean; agenda: AgendaItem[]; decisions: Decision[]; actions: Action[]; minutesSignatures: Sig[] };
type Call = (url: string, method: string, body?: any) => Promise<any>;

const M_TONE: Record<string, string> = { scheduled: "bg-[var(--cmp-surface-information)] text-blue-700", in_progress: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]", held: "bg-[var(--cmp-surface-success)] text-emerald-700", cancelled: "bg-gray-200 text-gray-600" };
const M_NEXT: Record<string, { to: string; label: string; cls: string }[]> = {
  scheduled: [{ to: "in_progress", label: "Start", cls: "bg-[var(--cmp-color-information)]" }, { to: "cancelled", label: "Cancel", cls: "bg-gray-400" }],
  in_progress: [{ to: "held", label: "Close (held)", cls: "bg-[var(--cmp-color-success)]" }, { to: "cancelled", label: "Cancel", cls: "bg-gray-400" }],
  held: [], cancelled: [],
};
const OUT_TONE: Record<string, string> = { carried: "text-emerald-700 bg-[var(--cmp-surface-success)]", rejected: "text-[var(--cmp-text-error)] bg-[var(--cmp-surface-error)]", deferred: "text-[var(--cmp-text-warning)] bg-[var(--cmp-surface-warning)]", tabled: "text-gray-600 bg-gray-200" };
const ATT_TONE: Record<string, string> = { present: "bg-[var(--cmp-color-success)]", apologies: "bg-[var(--cmp-color-warning)]", absent: "bg-[var(--cmp-color-error)]", invited: "bg-gray-300" };
const fmt = (d: string | null) => (d ? new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const inp = "border border-gray-200 rounded-lg px-2 py-1 text-[12px]";

export default function MeetingsAdmin({ meetings, offices, people, scopeHid, isSuper }: { meetings: Meeting[]; offices: OfficeOpt[]; people: Person[]; scopeHid: string | null; isSuper: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState(false);

  const call: Call = async (url, method, body) => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? `Error ${res.status}`); return null; }
      return await res.json().catch(() => ({}));
    } catch { setErr("Network error"); return null; } finally { setBusy(false); }
  };
  const refresh = () => router.refresh();

  return (
    <div className="space-y-4">
      {err && <div className="bg-[var(--cmp-surface-error)] border border-[var(--cmp-color-error)] text-[var(--cmp-text-error)] rounded-lg px-3 py-2 text-[12px]">{err}</div>}
      <div className="flex justify-between items-center">
        <p className="text-[12px] text-gray-500">{meetings.length} meeting{meetings.length === 1 ? "" : "s"}</p>
        <button onClick={() => setScheduling(v => !v)} className="text-[12px] bg-teal-600 text-white rounded-lg px-3 py-2 hover:bg-teal-700">{scheduling ? "Close" : "＋ Schedule meeting"}</button>
      </div>

      {scheduling && <ScheduleForm offices={offices} scopeHid={scopeHid} isSuper={isSuper} busy={busy} call={call} onDone={() => { setScheduling(false); refresh(); }} />}

      {offices.length === 0 && <div className="bg-[var(--cmp-surface-information)] border border-[var(--cmp-color-information)] rounded-lg px-3 py-2 text-[12px] text-blue-800">No offices constituted yet — constitute an office first, then schedule its meetings.</div>}

      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-50">
        {meetings.length === 0 && <p className="text-sm text-gray-400 p-6 text-center">No meetings yet. Schedule one above.</p>}
        {meetings.map(m => (
          <div key={m.id}>
            <button onClick={() => setOpenId(id => (id === m.id ? null : m.id))} className="w-full flex items-center gap-3 p-3 text-left hover:bg-gray-50">
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-gray-800 text-[13px] truncate">{m.title}</span>
                <span className="block text-[10px] text-gray-400 truncate">{m.officeName} · {fmt(m.scheduledAt)}</span>
              </span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${m.quorumMet ? "bg-[var(--cmp-surface-success)] text-emerald-700" : "bg-gray-100 text-gray-500"}`}>quorum {m.present}/{m.requiredQuorum}</span>
              <span className="text-[10px] text-gray-400 hidden md:inline">{m.decisions.length} decision{m.decisions.length === 1 ? "" : "s"}</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${M_TONE[m.status] ?? "bg-gray-100"}`}>{m.status.replace(/_/g, " ")}</span>
              <span className="text-gray-300 text-xs w-3">{openId === m.id ? "▲" : "▼"}</span>
            </button>
            {openId === m.id && <MeetingDetail meeting={m} people={people} busy={busy} call={call} refresh={refresh} />}
          </div>
        ))}
      </div>
      <p className="text-[10px] text-gray-400">Every action writes to the real <code>ogs_meetings</code> model and is audit-logged; quorum is live (present vs the office quorum snapshot). Admin authority required.</p>
    </div>
  );
}

function ScheduleForm({ offices, scopeHid, isSuper, busy, call, onDone }: { offices: OfficeOpt[]; scopeHid: string | null; isSuper: boolean; busy: boolean; call: Call; onDone: () => void }) {
  const [officeId, setOfficeId] = useState("");
  const [title, setTitle] = useState("");
  const [type, setType] = useState("regular");
  const [when, setWhen] = useState("");
  const [location, setLocation] = useState("");
  async function submit() {
    if (!officeId || !title.trim()) return;
    const body: any = { office_id: officeId, title, meeting_type: type, scheduled_at: when || null, location: location || null };
    if (isSuper) body.hospital_id = scopeHid;
    const r = await call("/api/office-governance/meetings", "POST", body);
    if (r) onDone();
  }
  const lbl = "text-[11px] text-gray-500 mb-0.5 block";
  return (
    <div className="bg-white rounded-xl border border-teal-200 p-4 grid grid-cols-1 md:grid-cols-6 gap-2 items-end">
      <div className="md:col-span-2"><label className={lbl}>Office</label><select className={`${inp} w-full`} value={officeId} onChange={e => setOfficeId(e.target.value)}><option value="">— office —</option>{offices.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
      <div className="md:col-span-2"><label className={lbl}>Title</label><input className={`${inp} w-full`} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Q3 Governance Meeting" /></div>
      <div><label className={lbl}>Type</label><select className={`${inp} w-full`} value={type} onChange={e => setType(e.target.value)}>{["regular", "extraordinary", "emergency"].map(t => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}</select></div>
      <div><label className={lbl}>When</label><input type="datetime-local" className={`${inp} w-full`} value={when} onChange={e => setWhen(e.target.value)} /></div>
      <div className="md:col-span-5"><label className={lbl}>Location</label><input className={`${inp} w-full`} value={location} onChange={e => setLocation(e.target.value)} placeholder="Room / video link (optional)" /></div>
      <button disabled={busy || !officeId || !title.trim()} onClick={submit} className="text-[12px] bg-gray-800 text-white rounded-lg px-3 py-1.5 disabled:opacity-40">Schedule</button>
    </div>
  );
}

function MeetingDetail({ meeting: m, people, busy, call, refresh }: { meeting: Meeting; people: Person[]; busy: boolean; call: Call; refresh: () => void }) {
  const base = `/api/office-governance/meetings/${m.id}`;
  const presentAttendees = m.attendance.filter(a => a.status === "present" && a.personId).map(a => ({ id: a.personId as string, name: a.personName ?? "Member" }));
  const [minutes, setMinutes] = useState(m.minutes ?? "");
  const [agendaTitle, setAgendaTitle] = useState("");
  const [actTitle, setActTitle] = useState(""); const [actOwner, setActOwner] = useState(""); const [actDue, setActDue] = useState("");

  const setAtt = async (attId: string, status: string) => { const r = await call(`${base}/attendance?attendance=${attId}`, "PATCH", { status }); if (r) refresh(); };
  const meetingStatus = async (to: string) => { const r = await call(base, "PATCH", { status: to }); if (r) refresh(); };
  const saveMinutes = async () => { const r = await call(base, "PATCH", { minutes }); if (r) refresh(); };
  const addAgenda = async () => { if (!agendaTitle.trim()) return; const r = await call(`${base}/agenda`, "POST", { title: agendaTitle }); if (r) { setAgendaTitle(""); refresh(); } };
  const delAgenda = async (itemId: string) => { const r = await call(`${base}/agenda?item=${itemId}`, "DELETE"); if (r) refresh(); };
  const addAction = async () => { if (!actTitle.trim()) return; const r = await call(`${base}/actions`, "POST", { title: actTitle, owner_id: actOwner || null, due_date: actDue || null }); if (r) { setActTitle(""); setActOwner(""); setActDue(""); refresh(); } };
  const completeAction = async (actId: string) => { const r = await call(`${base}/actions?action=${actId}`, "PATCH", { status: "completed" }); if (r) refresh(); };

  return (
    <div className="bg-gray-50/60 px-3 pb-3 pt-2 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(M_NEXT[m.status] ?? []).map(t => <button key={t.to} disabled={busy} onClick={() => meetingStatus(t.to)} className={`text-[11px] text-white rounded-lg px-2.5 py-1 disabled:opacity-40 ${t.cls}`}>{t.label}</button>)}
        <span className="text-[11px] text-gray-400">Chair: {m.chairedByName ?? "—"}{m.location ? ` · ${m.location}` : ""}{m.heldAt ? ` · held ${fmt(m.heldAt)}` : ""}</span>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        {/* Attendance / quorum */}
        <div className="bg-white rounded-lg border border-gray-100 p-2.5">
          <div className="flex items-center justify-between mb-1.5"><p className="text-[11px] font-semibold text-gray-600">Attendance</p><span className={`text-[10px] px-1.5 py-0.5 rounded-full ${m.quorumMet ? "bg-[var(--cmp-surface-success)] text-emerald-700" : "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]"}`}>{m.present}/{m.requiredQuorum} · {m.quorumMet ? "quorum met" : "no quorum"}</span></div>
          <div className="space-y-1 max-h-44 overflow-y-auto">
            {m.attendance.length === 0 && <p className="text-[11px] text-gray-400">No invitees (office has no active appointees).</p>}
            {m.attendance.map(a => (
              <div key={a.id} className="flex items-center gap-1.5 text-[12px]">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ATT_TONE[a.status] ?? "bg-gray-300"}`} />
                <span className="flex-1 truncate text-gray-700">{a.personName ?? "Member"}</span>
                {["present", "apologies", "absent"].map(s => <button key={s} disabled={busy} onClick={() => setAtt(a.id, s)} className={`text-[10px] px-1 rounded disabled:opacity-40 ${a.status === s ? "bg-gray-800 text-white" : "text-gray-400 hover:text-gray-700"}`}>{s[0].toUpperCase()}</button>)}
              </div>
            ))}
          </div>
        </div>

        {/* Agenda */}
        <div className="bg-white rounded-lg border border-gray-100 p-2.5">
          <p className="text-[11px] font-semibold text-gray-600 mb-1.5">Agenda</p>
          <div className="space-y-1 mb-2 max-h-36 overflow-y-auto">
            {m.agenda.length === 0 && <p className="text-[11px] text-gray-400">No agenda items.</p>}
            {m.agenda.map(a => (
              <div key={a.id} className="flex items-center gap-2 text-[12px]"><span className="text-gray-300 tabular-nums w-4">{a.seq}</span><span className="flex-1 truncate text-gray-700">{a.title}</span><button disabled={busy} onClick={() => delAgenda(a.id)} className="text-rose-400 hover:text-[var(--cmp-text-error)] text-[11px] disabled:opacity-40">×</button></div>
            ))}
          </div>
          <div className="flex gap-1.5"><input className={`${inp} flex-1 min-w-0`} value={agendaTitle} onChange={e => setAgendaTitle(e.target.value)} placeholder="Add agenda item" onKeyDown={e => { if (e.key === "Enter") addAgenda(); }} /><button disabled={busy || !agendaTitle.trim()} onClick={addAgenda} className="text-[12px] bg-teal-600 text-white rounded-lg px-2 disabled:opacity-40">Add</button></div>
        </div>
      </div>

      {/* Decisions */}
      <div className="bg-white rounded-lg border border-gray-100 p-2.5">
        <p className="text-[11px] font-semibold text-gray-600 mb-1.5">Decisions &amp; votes</p>
        <div className="space-y-1.5 mb-2">
          {m.decisions.length === 0 && <p className="text-[11px] text-gray-400">No decisions recorded.</p>}
          {m.decisions.map(d => (
            <div key={d.id} className="border-b border-gray-50 pb-1">
              <div className="flex items-center gap-2 text-[12px]">
                <span className="flex-1 min-w-0 truncate text-gray-800">{d.title}</span>
                <span className="text-[10px] text-gray-500 tabular-nums whitespace-nowrap">✓{d.votesFor} ✕{d.votesAgainst} ~{d.votesAbstain}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${OUT_TONE[d.outcome] ?? "bg-gray-100"}`}>{d.outcome}</span>
              </div>
              <div className="flex items-center gap-2 mt-0.5"><span className="text-[10px] text-gray-400">{d.decisionType} · {d.recordedByName ?? "—"}</span><span className="ml-auto"><OgsSignButton entityType="decision" entityId={d.id} signatures={d.signatures} /></span></div>
            </div>
          ))}
        </div>
        <DecisionForm base={base} people={people} attendees={presentAttendees} busy={busy} call={call} refresh={refresh} />
      </div>

      {/* Actions */}
      <div className="bg-white rounded-lg border border-gray-100 p-2.5">
        <p className="text-[11px] font-semibold text-gray-600 mb-1.5">Actions arising</p>
        <div className="space-y-1 mb-2">
          {m.actions.length === 0 && <p className="text-[11px] text-gray-400">No actions.</p>}
          {m.actions.map(a => (
            <div key={a.id} className="flex items-center gap-2 text-[12px]"><span className="flex-1 truncate text-gray-700">{a.title}</span><span className="text-[10px] text-gray-400 truncate w-28">{a.ownerName ?? "unassigned"}{a.dueDate ? ` · ${a.dueDate}` : ""}</span>{a.status === "completed" ? <span className="text-[10px] text-[var(--cmp-text-success)]">done</span> : <button disabled={busy} onClick={() => completeAction(a.id)} className="text-[10px] text-teal-600 hover:underline disabled:opacity-40">complete</button>}</div>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-1.5">
          <input className={`${inp} md:col-span-2`} value={actTitle} onChange={e => setActTitle(e.target.value)} placeholder="New action" />
          <select className={inp} value={actOwner} onChange={e => setActOwner(e.target.value)}><option value="">— owner —</option>{people.map(p => <option key={p.id} value={p.id}>{p.full_name ?? "Unnamed"}</option>)}</select>
          <div className="flex gap-1.5"><input type="date" className={`${inp} flex-1 min-w-0`} value={actDue} onChange={e => setActDue(e.target.value)} /><button disabled={busy || !actTitle.trim()} onClick={addAction} className="text-[12px] bg-teal-600 text-white rounded-lg px-2 disabled:opacity-40">Add</button></div>
        </div>
      </div>

      {/* Minutes */}
      {(m.status === "in_progress" || m.status === "held") && (
        <div className="bg-white rounded-lg border border-gray-100 p-2.5">
          <div className="flex items-center justify-between mb-1.5"><p className="text-[11px] font-semibold text-gray-600">Minutes</p><OgsSignButton entityType="minutes" entityId={m.id} signatures={m.minutesSignatures} /></div>
          <textarea className={`${inp} w-full`} rows={2} value={minutes} onChange={e => setMinutes(e.target.value)} placeholder="Meeting minutes / summary" />
          <div className="flex justify-end mt-1"><button disabled={busy} onClick={saveMinutes} className="text-[12px] bg-gray-800 text-white rounded-lg px-3 py-1 disabled:opacity-40">Save minutes</button></div>
        </div>
      )}
    </div>
  );
}

function DecisionForm({ base, people, attendees, busy, call, refresh }: { base: string; people: Person[]; attendees: { id: string; name: string }[]; busy: boolean; call: Call; refresh: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(""); const [type, setType] = useState("resolution"); const [outcome, setOutcome] = useState("carried");
  const [mode, setMode] = useState<"rollcall" | "tally">(attendees.length ? "rollcall" : "tally");
  const [vf, setVf] = useState(0); const [va, setVa] = useState(0); const [vab, setVab] = useState(0);
  const [roll, setRoll] = useState<Record<string, "for" | "against" | "abstain">>({});
  const [actTitle, setActTitle] = useState(""); const [actOwner, setActOwner] = useState("");

  const useRoll = mode === "rollcall" && attendees.length > 0;
  const rc = attendees.map(a => roll[a.id] ?? "abstain");
  const tallyFor = useRoll ? rc.filter(v => v === "for").length : vf;
  const tallyAgainst = useRoll ? rc.filter(v => v === "against").length : va;
  const tallyAbstain = useRoll ? rc.filter(v => v === "abstain").length : vab;

  async function submit() {
    if (!title.trim()) return;
    const body: any = { title, decision_type: type, outcome };
    if (useRoll) body.votes = attendees.map(a => ({ voter_id: a.id, vote: roll[a.id] ?? "abstain" }));
    else { body.votes_for = vf; body.votes_against = va; body.votes_abstain = vab; }
    if (actTitle.trim()) body.action = { title: actTitle, owner_id: actOwner || null };
    const r = await call(`${base}/decisions`, "POST", body);
    if (r) { setTitle(""); setVf(0); setVa(0); setVab(0); setRoll({}); setActTitle(""); setActOwner(""); setOpen(false); refresh(); }
  }
  if (!open) return <button onClick={() => setOpen(true)} className="text-[12px] text-teal-600 hover:underline">＋ Record a decision</button>;
  const voteBtn = (aId: string, v: "for" | "against" | "abstain") => { const active = (roll[aId] ?? "abstain") === v; const on = v === "for" ? "bg-[var(--cmp-color-success)] text-white" : v === "against" ? "bg-[var(--cmp-color-error)] text-white" : "bg-gray-500 text-white"; return <button key={v} type="button" onClick={() => setRoll(r => ({ ...r, [aId]: v }))} className={`text-[10px] w-5 py-0.5 rounded ${active ? on : "text-gray-400 hover:text-gray-700"}`}>{v[0].toUpperCase()}</button>; };
  return (
    <div className="border-t border-gray-100 pt-2 space-y-1.5">
      <input className={`${inp} w-full`} value={title} onChange={e => setTitle(e.target.value)} placeholder="Decision / resolution" />
      <div className="grid grid-cols-2 gap-1.5">
        <select className={inp} value={type} onChange={e => setType(e.target.value)}>{["resolution", "approval", "policy", "endorsement"].map(t => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}</select>
        <select className={inp} value={outcome} onChange={e => setOutcome(e.target.value)}>{["carried", "rejected", "deferred", "tabled"].map(t => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}</select>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-gray-500">Votes:</span>
        {attendees.length > 0 && <div className="flex gap-1">{(["rollcall", "tally"] as const).map(md => <button key={md} type="button" onClick={() => setMode(md)} className={`text-[10px] px-2 py-0.5 rounded ${mode === md ? "bg-gray-800 text-white" : "text-gray-500 border border-gray-200"}`}>{md === "rollcall" ? "Roll-call" : "Tally"}</button>)}</div>}
        <span className="text-[11px] text-gray-600 tabular-nums ml-auto">✓{tallyFor} ✕{tallyAgainst} ~{tallyAbstain}</span>
      </div>
      {useRoll ? (
        <div className="space-y-0.5 max-h-40 overflow-y-auto border border-gray-100 rounded-lg p-1.5">
          {attendees.map(a => (
            <div key={a.id} className="flex items-center gap-1.5 text-[12px]"><span className="flex-1 truncate text-gray-700">{a.name}</span>{voteBtn(a.id, "for")}{voteBtn(a.id, "against")}{voteBtn(a.id, "abstain")}</div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          <label className="flex items-center gap-1 text-[11px] text-gray-500">For<input type="number" min={0} className={`${inp} w-full`} value={vf} onChange={e => setVf(+e.target.value)} /></label>
          <label className="flex items-center gap-1 text-[11px] text-gray-500">Against<input type="number" min={0} className={`${inp} w-full`} value={va} onChange={e => setVa(+e.target.value)} /></label>
          <label className="flex items-center gap-1 text-[11px] text-gray-500">Abstain<input type="number" min={0} className={`${inp} w-full`} value={vab} onChange={e => setVab(+e.target.value)} /></label>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
        <input className={inp} value={actTitle} onChange={e => setActTitle(e.target.value)} placeholder="Follow-up action (optional)" />
        <select className={inp} value={actOwner} onChange={e => setActOwner(e.target.value)} disabled={!actTitle.trim()}><option value="">— action owner —</option>{people.map(p => <option key={p.id} value={p.id}>{p.full_name ?? "Unnamed"}</option>)}</select>
      </div>
      {useRoll && <p className="text-[10px] text-gray-400">Roll-call over the {attendees.length} present member{attendees.length === 1 ? "" : "s"} — the tally is derived and each member&apos;s vote recorded. Mark attendance &ldquo;present&rdquo; to include a member.</p>}
      <div className="flex justify-end gap-2"><button onClick={() => setOpen(false)} className="text-[12px] text-gray-500">Cancel</button><button disabled={busy || !title.trim()} onClick={submit} className="text-[12px] bg-teal-600 text-white rounded-lg px-3 py-1 disabled:opacity-40">Record decision</button></div>
    </div>
  );
}
