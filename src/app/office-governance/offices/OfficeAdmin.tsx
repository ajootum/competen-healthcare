"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { OFFICE_TYPES, SCOPE_TYPES, APPOINTMENT_ROLES, APPOINTMENT_ROLE_LABEL, STATE_LABEL, allowedNext } from "@/lib/ogs/lifecycle";
import { OgsSignButton } from "@/components/OgsSignButton";

// OGS write-workflow client surface — Constitute New Office wizard + per-office lifecycle & appointment
// management. Talks to /api/office-governance/offices*; every success calls router.refresh() so the server
// page (ogsGuard-scoped) re-reads the real ogs_* model. Admin-gated server-side; this UI only orchestrates.
/* eslint-disable @typescript-eslint/no-explicit-any */

type Person = { id: string; full_name: string | null; role: string | null };
type Appt = { id: string; personId: string | null; personName: string | null; role: string };
type Charter = { id: string; version: string; purpose: string | null; mandate: string | null; quorumRule: string | null; decisionRule: string | null; effectiveFrom: string | null; reviewDate: string | null; approvedBy: string | null; approvalStatus: string; createdAt: string | null; signatures: { signerName: string | null; signerRole: string | null; signedAt: string | null }[] };
type Office = { id: string; name: string; officeType: string; scopeType: string; status: string; authoritySource: string | null; chairName: string | null; quorum: number; nextReview: string | null; charterVersion: string | null; establishedAt: string | null; memberCount: number; appointments: Appt[]; charters: Charter[] };
type Call = (url: string, method: string, body?: any) => Promise<any>;

function bumpVersion(v: string | null): string {
  const m = /^v?(\d+)\.(\d+)$/.exec(v ?? "");
  if (m) return `v${m[1]}.${Number(m[2]) + 1}`;
  return "v1.1";
}

const STATUS_TONE: Record<string, string> = { active: "bg-[var(--cmp-surface-success)] text-emerald-700", approved: "bg-[var(--cmp-surface-success)] text-emerald-700", under_review: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]", pending_approval: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]", proposed: "bg-[var(--cmp-surface-information)] text-blue-700", in_design: "bg-[var(--cmp-surface-information)] text-blue-700", suspended: "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]", restructuring: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]", closing: "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]", dissolved: "bg-gray-200 text-gray-600", archived: "bg-gray-200 text-gray-600", template: "bg-gray-100 text-gray-500" };
const title = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export default function OfficeAdmin({ offices, people, scopeHid, isSuper }: { offices: Office[]; people: Person[]; scopeHid: string | null; isSuper: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [manageId, setManageId] = useState<string | null>(null);

  const call: Call = async (url, method, body) => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? `Error ${res.status}`); return null; }
      return await res.json().catch(() => ({}));
    } catch { setErr("Network error"); return null; } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      {err && <div className="bg-[var(--cmp-surface-error)] border border-[var(--cmp-color-error)] text-[var(--cmp-text-error)] rounded-lg px-3 py-2 text-[12px]">{err}</div>}
      <div className="flex justify-between items-center">
        <p className="text-[12px] text-gray-500">{offices.length} constituted office{offices.length === 1 ? "" : "s"}{isSuper ? " · enterprise scope" : ""}</p>
        <button onClick={() => setWizardOpen(v => !v)} className="text-[12px] bg-teal-600 text-white rounded-lg px-3 py-2 hover:bg-teal-700">{wizardOpen ? "Close" : "＋ Constitute new office"}</button>
      </div>

      {wizardOpen && <ConstituteWizard people={people} scopeHid={scopeHid} isSuper={isSuper} busy={busy} call={call} onDone={() => { setWizardOpen(false); router.refresh(); }} />}

      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-50">
        {offices.length === 0 && <p className="text-sm text-gray-400 p-6 text-center">No offices constituted yet. Use &ldquo;Constitute new office&rdquo; above to create the first one.</p>}
        {offices.map(o => (
          <div key={o.id}>
            <div className="flex items-center hover:bg-gray-50">
              <button onClick={() => setManageId(id => (id === o.id ? null : o.id))} className="flex-1 min-w-0 flex items-center gap-3 p-3 text-left">
                <span className="font-medium text-gray-800 text-[13px] flex-1 truncate">{o.name}</span>
                <span className="text-[10px] text-gray-400 hidden md:inline">{title(o.officeType.replace(/_/g, " "))} · {o.scopeType}</span>
                <span className="text-[11px] text-gray-500 tabular-nums">{o.memberCount}/{o.quorum}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${STATUS_TONE[o.status] ?? "bg-gray-100 text-gray-600"}`}>{STATE_LABEL[o.status] ?? o.status}</span>
                <span className="text-gray-300 text-xs w-3">{manageId === o.id ? "▲" : "▼"}</span>
              </button>
              <Link href={`/office-governance/offices/${o.id}`} className="px-3 text-[11px] text-teal-600 hover:underline shrink-0 whitespace-nowrap">open →</Link>
            </div>
            {manageId === o.id && <OfficeManage office={o} people={people} busy={busy} call={call} onChange={() => router.refresh()} />}
          </div>
        ))}
      </div>
      <p className="text-[10px] text-gray-400">Constitute, appoint and transition write to the real <code>ogs_*</code> model with an immutable lifecycle-transition log; every action is audit-logged and tenant-scoped. Admin authority (hospital_admin / super_admin) required.</p>
    </div>
  );
}

function ConstituteWizard({ people, scopeHid, isSuper, busy, call, onDone }: { people: Person[]; scopeHid: string | null; isSuper: boolean; busy: boolean; call: Call; onDone: () => void }) {
  const [step, setStep] = useState(1);
  const [f, setF] = useState<any>({ name: "", office_type: "governance", scope_type: "hospital", authority_source: "", reporting_line: "", code: "", purpose: "", mandate: "", quorum: 3, decision_rule: "", effective_from: new Date().toISOString().slice(0, 10), review_date: "", chair_id: "" });
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const ready = !!f.name.trim() && !!f.purpose.trim() && !!f.chair_id && Number(f.quorum) > 0;

  async function submit(activate: boolean) {
    const body: any = { ...f, quorum: Number(f.quorum) || 3, activate };
    if (isSuper) body.hospital_id = scopeHid;
    const r = await call("/api/office-governance/offices", "POST", body);
    if (r) onDone();
  }
  const inp = "w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12px]";
  const lbl = "text-[11px] text-gray-500 mb-0.5 block";
  const steps = ["Identity", "Charter", "Leadership", "Activation readiness", "Review"];

  return (
    <div className="bg-white rounded-xl border border-teal-200 p-4 space-y-3">
      <div className="flex items-center gap-1">{[1, 2, 3, 4, 5].map(n => <div key={n} className={`h-1.5 flex-1 rounded-full ${n <= step ? "bg-teal-500" : "bg-gray-100"}`} />)}</div>
      <p className="text-[11px] text-gray-400">Step {step} of 5 · {steps[step - 1]}</p>

      {step === 1 && <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><label className={lbl}>Office name *</label><input className={inp} value={f.name} onChange={e => set("name", e.target.value)} placeholder="e.g. Nursing Competency Office" /></div>
        <div><label className={lbl}>Office type</label><select className={inp} value={f.office_type} onChange={e => set("office_type", e.target.value)}>{OFFICE_TYPES.map(t => <option key={t} value={t}>{title(t.replace(/_/g, " "))}</option>)}</select></div>
        <div><label className={lbl}>Scope</label><select className={inp} value={f.scope_type} onChange={e => set("scope_type", e.target.value)}>{SCOPE_TYPES.map(t => <option key={t} value={t}>{title(t)}</option>)}</select></div>
        <div className="col-span-2"><label className={lbl}>Authority source</label><input className={inp} value={f.authority_source} onChange={e => set("authority_source", e.target.value)} placeholder="e.g. Chief Nursing Officer / Board delegation" /></div>
        <div><label className={lbl}>Reporting line</label><input className={inp} value={f.reporting_line} onChange={e => set("reporting_line", e.target.value)} placeholder="e.g. Hospital Executive" /></div>
        <div><label className={lbl}>Code</label><input className={inp} value={f.code} onChange={e => set("code", e.target.value)} placeholder="optional" /></div>
      </div>}

      {step === 2 && <div className="space-y-2">
        <div><label className={lbl}>Purpose</label><textarea className={inp} rows={2} value={f.purpose} onChange={e => set("purpose", e.target.value)} placeholder="What this office governs" /></div>
        <div><label className={lbl}>Mandate</label><textarea className={inp} rows={2} value={f.mandate} onChange={e => set("mandate", e.target.value)} placeholder="Powers & responsibilities" /></div>
        <div className="grid grid-cols-3 gap-3">
          <div><label className={lbl}>Quorum</label><input type="number" min={1} className={inp} value={f.quorum} onChange={e => set("quorum", e.target.value)} /></div>
          <div className="col-span-2"><label className={lbl}>Decision rule</label><input className={inp} value={f.decision_rule} onChange={e => set("decision_rule", e.target.value)} placeholder="e.g. Majority of members present" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={lbl}>Effective from</label><input type="date" className={inp} value={f.effective_from} onChange={e => set("effective_from", e.target.value)} /></div>
          <div><label className={lbl}>Review date</label><input type="date" className={inp} value={f.review_date} onChange={e => set("review_date", e.target.value)} /></div>
        </div>
      </div>}

      {step === 3 && <div className="space-y-2">
        <div><label className={lbl}>Chair</label><select className={inp} value={f.chair_id} onChange={e => set("chair_id", e.target.value)}><option value="">— select a chair —</option>{people.map(p => <option key={p.id} value={p.id}>{p.full_name ?? "Unnamed"}{p.role ? ` · ${p.role}` : ""}</option>)}</select></div>
        <p className="text-[10px] text-gray-400">The chair is the office&apos;s accountable lead. Further members can be appointed after constituting.</p>
      </div>}

      {step === 4 && <div className="space-y-1.5">
        {([["Office name set", !!f.name.trim()], ["Charter purpose defined", !!f.purpose.trim()], ["Chair appointed", !!f.chair_id], ["Quorum set", Number(f.quorum) > 0]] as [string, boolean][]).map(([label, ok]) => (
          <div key={label} className="flex items-center gap-2 text-[12px]"><span className={ok ? "text-[var(--cmp-text-success)]" : "text-gray-300"}>{ok ? "✓" : "○"}</span><span className={ok ? "text-gray-700" : "text-gray-400"}>{label}</span></div>
        ))}
        <p className={`text-[11px] mt-1 ${ready ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-warning)]"}`}>{ready ? "Ready to constitute and activate." : "Not all activation criteria met — you can still save as a proposed office."}</p>
      </div>}

      {step === 5 && <div className="text-[12px] text-gray-600 space-y-1">
        <p><b>{f.name || "—"}</b> · {title(f.office_type.replace(/_/g, " "))} · {title(f.scope_type)} scope</p>
        <p className="text-gray-500">Authority: {f.authority_source || "—"} · Quorum {f.quorum} · Chair {people.find(p => p.id === f.chair_id)?.full_name ?? "unfilled"}</p>
        <p className="text-gray-400 text-[11px]">Constituting creates the office, its founding charter (v1.0), the chair appointment and an immutable constituting transition.</p>
      </div>}

      <div className="flex items-center justify-between pt-1">
        <button disabled={step === 1 || busy} onClick={() => setStep(s => Math.max(1, s - 1))} className="text-[12px] text-gray-500 disabled:opacity-30">← Back</button>
        {step < 5
          ? <button disabled={busy || (step === 1 && !f.name.trim())} onClick={() => setStep(s => Math.min(5, s + 1))} className="text-[12px] bg-gray-800 text-white rounded-lg px-3 py-1.5 disabled:opacity-40">Next →</button>
          : <div className="flex gap-2">
              <button disabled={busy || !f.name.trim()} onClick={() => submit(false)} className="text-[12px] border border-gray-300 rounded-lg px-3 py-1.5 disabled:opacity-40">Save as proposed</button>
              <button disabled={busy || !ready} onClick={() => submit(true)} className="text-[12px] bg-teal-600 text-white rounded-lg px-3 py-1.5 disabled:opacity-40">Constitute &amp; activate</button>
            </div>}
      </div>
    </div>
  );
}

function OfficeManage({ office, people, busy, call, onChange }: { office: Office; people: Person[]; busy: boolean; call: Call; onChange: () => void }) {
  const [reason, setReason] = useState("");
  const [toState, setToState] = useState("");
  const [personId, setPersonId] = useState("");
  const [role, setRole] = useState("member");
  const nexts = allowedNext(office.status);
  const inp = "border border-gray-200 rounded-lg px-2 py-1 text-[12px]";

  async function transition() { if (!toState) return; const r = await call(`/api/office-governance/offices/${office.id}`, "PATCH", { to_state: toState, reason }); if (r) { setToState(""); setReason(""); onChange(); } }
  async function appoint() { if (!personId) return; const r = await call(`/api/office-governance/offices/${office.id}/appointments`, "POST", { person_id: personId, role }); if (r) { setPersonId(""); onChange(); } }
  async function remove(apptId: string) { const r = await call(`/api/office-governance/offices/${office.id}/appointments?appointment=${apptId}`, "DELETE"); if (r) onChange(); }

  return (
    <div className="bg-gray-50/60 px-3 pb-3 pt-1">
      <div className="grid md:grid-cols-2 gap-3">
        <div className="bg-white rounded-lg border border-gray-100 p-2.5">
          <p className="text-[11px] font-semibold text-gray-600 mb-1.5">Appointments</p>
          <div className="space-y-1 mb-2">
            {office.appointments.length === 0 && <p className="text-[11px] text-gray-400">No members appointed.</p>}
            {office.appointments.map(a => (
              <div key={a.id} className="flex items-center gap-2 text-[12px]"><span className="flex-1 truncate text-gray-700">{a.personName ?? "Member"}</span><span className="text-[10px] text-gray-400">{APPOINTMENT_ROLE_LABEL[a.role] ?? a.role}</span><button disabled={busy} onClick={() => remove(a.id)} className="text-rose-400 hover:text-[var(--cmp-text-error)] text-[11px] disabled:opacity-40">remove</button></div>
            ))}
          </div>
          <div className="flex gap-1.5">
            <select className={`${inp} flex-1 min-w-0`} value={personId} onChange={e => setPersonId(e.target.value)}><option value="">— person —</option>{people.map(p => <option key={p.id} value={p.id}>{p.full_name ?? "Unnamed"}</option>)}</select>
            <select className={inp} value={role} onChange={e => setRole(e.target.value)}>{APPOINTMENT_ROLES.map(r => <option key={r} value={r}>{APPOINTMENT_ROLE_LABEL[r]}</option>)}</select>
            <button disabled={busy || !personId} onClick={appoint} className="text-[12px] bg-teal-600 text-white rounded-lg px-2 disabled:opacity-40">Add</button>
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-100 p-2.5">
          <p className="text-[11px] font-semibold text-gray-600 mb-1.5">Lifecycle</p>
          {nexts.length === 0 ? <p className="text-[11px] text-gray-400">No further transitions from {STATE_LABEL[office.status] ?? office.status}.</p> : <>
            <div className="flex gap-1.5 mb-2">
              <select className={`${inp} flex-1 min-w-0`} value={toState} onChange={e => setToState(e.target.value)}><option value="">— move to —</option>{nexts.map(s => <option key={s} value={s}>{STATE_LABEL[s]}</option>)}</select>
              <button disabled={busy || !toState} onClick={transition} className="text-[12px] bg-gray-800 text-white rounded-lg px-2 disabled:opacity-40">Apply</button>
            </div>
            <input className={`${inp} w-full`} placeholder="Reason (optional)" value={reason} onChange={e => setReason(e.target.value)} />
          </>}
          <p className="text-[10px] text-gray-400 mt-2">Charter {office.charterVersion ?? "—"} · review {office.nextReview ?? "—"}</p>
        </div>
      </div>
      <CharterSection office={office} busy={busy} call={call} onChange={onChange} />
    </div>
  );
}

const CH_STATUS_TONE: Record<string, string> = { approved: "bg-[var(--cmp-surface-success)] text-emerald-700", draft: "bg-[var(--cmp-surface-information)] text-blue-700", pending: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]", superseded: "bg-gray-200 text-gray-500" };

function CharterSection({ office, busy, call, onChange }: { office: Office; busy: boolean; call: Call; onChange: () => void }) {
  const [amending, setAmending] = useState(false);
  const current = office.charters.find(c => c.version === office.charterVersion) ?? office.charters[0] ?? null;
  const history = office.charters.filter(c => c.id !== current?.id);

  const [version, setVersion] = useState(bumpVersion(office.charterVersion));
  const [purpose, setPurpose] = useState(current?.purpose ?? "");
  const [mandate, setMandate] = useState(current?.mandate ?? "");
  const [quorumRule, setQuorumRule] = useState(current?.quorumRule ?? "");
  const [decisionRule, setDecisionRule] = useState(current?.decisionRule ?? "");
  const [reviewDate, setReviewDate] = useState("");
  const [status, setStatus] = useState("approved");

  async function submit() {
    if (!version.trim()) return;
    const r = await call(`/api/office-governance/offices/${office.id}/charter`, "POST", { version, purpose, mandate, quorum_rule: quorumRule, decision_rule: decisionRule, review_date: reviewDate || null, approval_status: status });
    if (r) { setAmending(false); onChange(); }
  }
  const inp = "border border-gray-200 rounded-lg px-2 py-1 text-[12px]";
  const lbl = "text-[11px] text-gray-500 mb-0.5 block";

  return (
    <div className="mt-3 bg-white rounded-lg border border-gray-100 p-2.5">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[11px] font-semibold text-gray-600">Charter</p>
        <button onClick={() => setAmending(v => !v)} className="text-[11px] text-teal-600 hover:underline">{amending ? "Cancel" : "Amend charter"}</button>
      </div>
      {current ? (
        <div className="text-[12px] text-gray-700 space-y-1">
          <div className="flex items-center gap-2 flex-wrap"><span className="font-semibold">{current.version}</span><span className={`text-[10px] px-1.5 py-0.5 rounded-full ${CH_STATUS_TONE[current.approvalStatus] ?? "bg-gray-100 text-gray-600"}`}>{current.approvalStatus}</span><span className="text-[10px] text-gray-400">effective {current.effectiveFrom ?? "—"} · review {current.reviewDate ?? "—"}</span><span className="ml-auto"><OgsSignButton entityType="charter" entityId={current.id} signatures={current.signatures} /></span></div>
          {current.purpose && <p><span className="text-gray-400 text-[10px] uppercase tracking-wide">Purpose</span><br />{current.purpose}</p>}
          {current.mandate && <p><span className="text-gray-400 text-[10px] uppercase tracking-wide">Mandate</span><br />{current.mandate}</p>}
          {(current.quorumRule || current.decisionRule) && <p className="text-[11px] text-gray-500">{current.quorumRule ?? ""}{current.quorumRule && current.decisionRule ? " · " : ""}{current.decisionRule ?? ""}</p>}
        </div>
      ) : <p className="text-[11px] text-gray-400">No charter on record.</p>}

      {amending && (
        <div className="mt-2 border-t border-gray-100 pt-2 space-y-1.5">
          <div className="grid grid-cols-2 gap-2">
            <div><label className={lbl}>New version</label><input className={`${inp} w-full`} value={version} onChange={e => setVersion(e.target.value)} /></div>
            <div><label className={lbl}>Status</label><select className={`${inp} w-full`} value={status} onChange={e => setStatus(e.target.value)}>{["approved", "draft", "pending"].map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</select></div>
          </div>
          <div><label className={lbl}>Purpose</label><textarea className={`${inp} w-full`} rows={2} value={purpose} onChange={e => setPurpose(e.target.value)} /></div>
          <div><label className={lbl}>Mandate</label><textarea className={`${inp} w-full`} rows={2} value={mandate} onChange={e => setMandate(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className={lbl}>Quorum rule</label><input className={`${inp} w-full`} value={quorumRule} onChange={e => setQuorumRule(e.target.value)} /></div>
            <div><label className={lbl}>Decision rule</label><input className={`${inp} w-full`} value={decisionRule} onChange={e => setDecisionRule(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2 items-end">
            <div><label className={lbl}>Review date</label><input type="date" className={`${inp} w-full`} value={reviewDate} onChange={e => setReviewDate(e.target.value)} /></div>
            <div className="flex justify-end"><button disabled={busy || !version.trim()} onClick={submit} className="text-[12px] bg-teal-600 text-white rounded-lg px-3 py-1.5 disabled:opacity-40">Adopt new version</button></div>
          </div>
          <p className="text-[10px] text-gray-400">Adopting supersedes the current version and points the office at {version || "the new version"}.</p>
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-2 border-t border-gray-100 pt-1.5">
          <p className="text-[10px] text-gray-400 mb-1">Version history</p>
          <div className="space-y-0.5">
            {history.map(h => (
              <div key={h.id} className="flex items-center gap-2 text-[11px] text-gray-500"><span className="font-medium text-gray-600">{h.version}</span><span className={`text-[9px] px-1 py-0.5 rounded-full ${CH_STATUS_TONE[h.approvalStatus] ?? "bg-gray-100"}`}>{h.approvalStatus}</span><span className="text-gray-400">{h.createdAt ? new Date(h.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : ""}</span></div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
