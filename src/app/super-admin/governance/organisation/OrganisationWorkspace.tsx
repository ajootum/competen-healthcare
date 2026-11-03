"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { SPACE_LABEL, type HqAppointmentBoard } from "@/lib/hq/appointments";
import { HQ_SPACES } from "@/lib/hq/spaces";
import { MIN_REASON, SENSITIVE_LABEL, sensitiveClassOf, type HqPositionAdminView, type HqPositionBoard } from "@/lib/hq/positions";
import { CLINICAL_APPROVAL, PROFILES, profileGaps, type GovernanceProfile, type GovernanceProfileKey } from "@/lib/hq/governance-profiles";
import PositionsBoard from "../../users/positions/PositionsBoard";
import AppointmentsBoard from "../../users/appointments/AppointmentsBoard";
import type { AppointmentsData } from "../../users/appointments/load-appointments";

// UNIFIED-GOVERNANCE-V1 section 6. The page arranges boards that already exist and one small piece of new reading
// (the organisation hierarchy and the profile gaps). Every write posts to the existing owner-gated /api/hq/positions.

export type OrgTab = "positions" | "appointments" | "capabilities";
const TAB_LABEL: Record<OrgTab, string> = { positions: "Positions", appointments: "Appointments", capabilities: "Capabilities" };
const TABS: OrgTab[] = ["positions", "appointments", "capabilities"];

type Props = {
  initialTab: OrgTab;
  positionBoard: HqPositionBoard;
  migrationApplied: boolean;
  appointments: AppointmentsData;
  isOwner: boolean;
  viewerId: string;
  viewerName: string | null;
};

const btn = "inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-[13px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:opacity-50 min-h-9 pointer-coarse:min-h-[var(--cmp-touch-min)]";
const primary = `${btn} bg-teal-700 text-white hover:bg-teal-800`;
const ghost = `${btn} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`;
const field = "border border-gray-300 rounded-lg px-2 py-1 text-sm min-h-9 pointer-coarse:min-h-[var(--cmp-touch-min)] bg-white";

const Unreadable = ({ what, error }: { what: string; error: string }) => (
  <p className="text-sm rounded-lg px-3 py-2 bg-[var(--cmp-surface-warning)] text-amber-900">
    <span className="font-semibold">{what} could not be read.</span> This is not a zero. <span className="text-amber-800/80">({error})</span>
  </p>
);

type Say = (k: "ok" | "err", t: string) => void;

/** One POST to the positions route. Returns the database's own sentence on refusal. */
async function postPositions(body: Record<string, unknown>): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const r = await fetch("/api/hq/positions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.ok) return { ok: true };
    return { ok: false, error: j.error ?? `The request failed (HTTP ${r.status}). Nothing was changed.` };
  } catch {
    return { ok: false, error: "The request did not reach the server, so nothing was changed." };
  }
}

type HolderMap = Map<string, { now: number; all: number } | null>;

/** Holders per position code: people holding now / everybody on the roster, null per position when its roster could not be read, null overall when the board could not. */
function holderCounts(board: HqAppointmentBoard): HolderMap | null {
  if (!board.spaces.ok) return null;
  const m: HolderMap = new Map();
  for (const s of board.spaces.value) {
    if (!s.positions.ok) continue;
    for (const p of s.positions.value) m.set(p.code, p.holders.ok ? { now: p.holders.value.filter(h => h.grantsAccess).length, all: p.holders.value.length } : null);
  }
  return m;
}

// ── Positions tab: the hierarchy ─────────────────────────────────────────────
type Node = { p: HqPositionAdminView; children: Node[] };

/** Pure: a forest from reportsTo. Roots have no reportsTo, or a target not on the board. A cycle is cut, never looped or dropped. Executive space first. */
export function buildHierarchy(list: HqPositionAdminView[]): Node[] {
  const byCode = new Map(list.map(p => [p.code, p]));
  const kids = new Map<string, HqPositionAdminView[]>();
  const roots: HqPositionAdminView[] = [];
  for (const p of list) {
    if (p.reportsTo && p.reportsTo !== p.code && byCode.has(p.reportsTo)) kids.set(p.reportsTo, [...(kids.get(p.reportsTo) ?? []), p]);
    else roots.push(p);
  }
  const rank = (p: HqPositionAdminView) => HQ_SPACES.indexOf(p.space);
  const order = (a: HqPositionAdminView, b: HqPositionAdminView) => rank(a) - rank(b) || a.name.localeCompare(b.name);
  const seen = new Set<string>();
  const grow = (p: HqPositionAdminView): Node => {
    seen.add(p.code);
    return { p, children: (kids.get(p.code) ?? []).filter(c => !seen.has(c.code)).sort(order).map(grow) };
  };
  const forest = [...roots].sort(order).map(grow);
  for (const p of [...list].sort(order)) if (!seen.has(p.code)) forest.push(grow(p));
  return forest;
}

function ReportsTo({ p, all, say, canWrite }: { p: HqPositionAdminView; all: HqPositionAdminView[]; say: Say; canWrite: boolean }) {
  const router = useRouter();
  const [to, setTo] = useState<string>(p.reportsTo ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const changed = to !== (p.reportsTo ?? "");
  const nameOf = (c: string | null) => (c ? all.find(x => x.code === c)?.name ?? c : "nobody (top level)");
  if (!canWrite) {
    return <p className="text-[12px] text-gray-600">Reports to: <span className="font-medium text-gray-800">{nameOf(p.reportsTo)}</span></p>;
  }
  return (
    <div className="space-y-2">
      <label className="flex flex-col gap-1 text-[12px] text-gray-600">
        Reports to
        <select value={to} onChange={e => setTo(e.target.value)} className={field} disabled={busy}>
          <option value="">Nobody (top level)</option>
          {all.filter(x => x.code !== p.code).map(x => <option key={x.code} value={x.code}>{x.name}</option>)}
        </select>
      </label>
      {changed && (
        <div className="space-y-2">
          <label className="flex flex-col gap-1 text-[12px] text-gray-600">
            Reason (written to the audit trail, at least {MIN_REASON} characters)
            <input value={reason} onChange={e => setReason(e.target.value)} className={field} maxLength={500} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              className={primary} disabled={busy || reason.trim().length < MIN_REASON}
              onClick={async () => {
                setBusy(true);
                const r = await postPositions({ action: "set_reports_to", code: p.code, reportsTo: to || null, reason });
                setBusy(false);
                if (r.ok) { say("ok", `${p.name} now reports to ${nameOf(to || null)}.`); setReason(""); router.refresh(); }
                else { say("err", r.error); setTo(p.reportsTo ?? ""); }
              }}
            >Save reporting line</button>
            <button className={ghost} disabled={busy} onClick={() => { setTo(p.reportsTo ?? ""); setReason(""); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function NodeView({ n, all, holders, say, canWrite }: { n: Node; all: HqPositionAdminView[]; holders: HolderMap | null; say: Say; canWrite: boolean }) {
  const { p } = n;
  const h = holders?.get(p.code);
  return (
    <li>
      <div className={`rounded-xl border border-gray-200 bg-white p-3 space-y-2 ${p.isActive ? "" : "opacity-70"}`}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold text-gray-900">{p.name}</span>
          <code className="text-[11px] text-gray-600">{p.code}</code>
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-teal-50 text-teal-900">{SPACE_LABEL[p.space]}</span>
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${p.isActive ? "bg-[var(--cmp-surface-success)] text-green-800" : "bg-gray-100 text-gray-600"}`}>{p.isActive ? "Active" : "Inactive"}</span>
          <span className="text-[12px] text-gray-600">
            {holders === null || h === undefined ? "Holders: not read" : h === null ? "Holders: could not be read" : `${h.now} holding now · ${h.all} on the roster`}
          </span>
        </div>
        <ReportsTo key={`${p.code}:${p.reportsTo ?? ""}`} p={p} all={all} say={say} canWrite={canWrite} />
      </div>
      {n.children.length > 0 && (
        <ul className="mt-2 ml-3 pl-3 sm:ml-5 sm:pl-4 border-l-2 border-teal-100 space-y-2" aria-label={`Report to ${p.name}`}>
          {n.children.map(c => <NodeView key={c.p.code} n={c} all={all} holders={holders} say={say} canWrite={canWrite} />)}
        </ul>
      )}
    </li>
  );
}

function Hierarchy({ board, appointments, canWrite, say }: { board: HqPositionBoard; appointments: AppointmentsData; canWrite: boolean; say: Say }) {
  const list = useMemo(() => (board.positions.ok ? board.positions.value : []), [board.positions]);
  const forest = useMemo(() => buildHierarchy(list), [list]);
  const holders = useMemo(() => holderCounts(appointments.board), [appointments.board]);
  if (!board.positions.ok) return <Unreadable what="The positions" error={board.positions.error} />;
  if (list.length === 0) return <p className="text-sm text-gray-600">No positions exist yet.</p>;
  const anyLine = list.some(p => p.reportsTo);
  return (
    <section aria-labelledby="org-hierarchy" className="space-y-3">
      <div>
        <h2 id="org-hierarchy" className="text-base font-bold text-gray-900">Organisation hierarchy</h2>
        <p className="text-[13px] text-gray-600 max-w-3xl">
          Drawn from each position&apos;s reporting line. A position with no reporting line is at the top. Reporting lines organise the picture; what a position can do is decided by its grants.
        </p>
        {!anyLine && <p className="mt-1 text-[12px] text-amber-900">No position has a reporting line set (or this database does not have migration 940), so every position is drawn at the top level.</p>}
      </div>
      <ul className="space-y-2">
        {forest.map(n => <NodeView key={n.p.code} n={n} all={list} holders={holders} say={say} canWrite={canWrite} />)}
      </ul>
    </section>
  );
}

// ── Capabilities tab ─────────────────────────────────────────────────────────
function ProfileCard({ k, profile, position, canWrite, reason, applying, onApply, labelOf }: {
  k: GovernanceProfileKey; profile: GovernanceProfile; position: HqPositionAdminView; canWrite: boolean; reason: string;
  applying: string | null; onApply: (k: GovernanceProfileKey, gaps: string[]) => void; labelOf: (code: string) => string;
}) {
  const live = position.grants.ok ? position.grants.value.filter(g => g.live).map(g => g.capability) : null;
  const gaps = live ? profileGaps(profile, live) : null;
  return (
    <article className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
      <header>
        <h3 className="font-semibold text-gray-900">{profile.label}</h3>
        <p className="text-[12px] text-gray-600">{profile.note}</p>
      </header>
      {live === null || gaps === null
        ? <p className="text-[12px] text-amber-900">This position&apos;s grants could not be read, so the profile cannot be compared with them.</p>
        : (
          <>
            <p className="text-[12px] text-gray-700">
              {gaps.length === 0 ? "This position already holds every capability in this profile." : `${profile.capabilities.length - gaps.length} of ${profile.capabilities.length} held. ${gaps.length} still to grant.`}
            </p>
            <ul className="space-y-1">
              {profile.capabilities.map(c => {
                const held = live.includes(c);
                return (
                  <li key={c} className="flex items-start gap-2 text-[12px]">
                    <span aria-hidden className={held ? "text-green-700" : "text-amber-700"}>{held ? "✓" : "○"}</span>
                    <span><span className="text-gray-900">{labelOf(c)}</span> <code className="text-gray-500">{c}</code> <span className="sr-only">{held ? "held" : "to grant"}</span></span>
                  </li>
                );
              })}
            </ul>
            {canWrite && (
              <button className={primary} disabled={gaps.length === 0 || applying !== null || reason.trim().length < MIN_REASON} onClick={() => onApply(k, gaps)}>
                {applying === k ? "Granting…" : `Apply ${profile.label.toLowerCase()} to ${position.name}`}
              </button>
            )}
          </>
        )}
    </article>
  );
}

function Capabilities({ board, canWrite, isOwner, migrationApplied, say }: { board: HqPositionBoard; canWrite: boolean; isOwner: boolean; migrationApplied: boolean; say: Say }) {
  const router = useRouter();
  const list = useMemo(() => (board.positions.ok ? board.positions.value : []), [board.positions]);
  const [code, setCode] = useState<string>(list.find(p => p.code === "chief_executive_officer")?.code ?? list[0]?.code ?? "");
  const [reason, setReason] = useState("UNIFIED-GOVERNANCE-V1 standard content-governance profile");
  const [applying, setApplying] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  const labels = useMemo(() => new Map<string, string | null>(board.catalogue.ok ? board.catalogue.value.map(c => [c.code, c.label]) : []), [board.catalogue]);
  const labelOf = (c: string) => labels.get(c) ?? c;
  if (!board.positions.ok) return <Unreadable what="The positions" error={board.positions.error} />;
  const position = list.find(p => p.code === code) ?? null;

  async function grantAll(tag: string, caps: string[], acknowledgeSensitive: boolean) {
    if (!position) return;
    setApplying(tag);
    let done = 0;
    for (const capability of caps) {
      const res = await postPositions({ action: "grant", code: position.code, capability, reason, acknowledge_sensitive: acknowledgeSensitive });
      if (!res.ok) {
        setApplying(null);
        say("err", `Stopped at ${labelOf(capability)} (${capability}) after ${done} granted. ${res.error}`);
        router.refresh();
        return;
      }
      done += 1;
    }
    setApplying(null);
    say("ok", `Granted ${done} capabilit${done === 1 ? "y" : "ies"} to ${position.name}.`);
    router.refresh();
  }

  const live = position?.grants.ok ? position.grants.value.filter(g => g.live) : null;
  const clinicalHeld = !!live && live.some(g => g.capability === CLINICAL_APPROVAL[0]);

  return (
    <section aria-labelledby="org-caps" className="space-y-4">
      <div>
        <h2 id="org-caps" className="text-base font-bold text-gray-900">Capabilities of a position</h2>
        <p className="text-[13px] text-gray-600 max-w-3xl">
          A capability is defined in code; a position holds the ones granted to it. Granting goes through the audited position administration, which refuses separation-of-duties conflicts.
        </p>
      </div>
      {!isOwner && <p className="text-sm rounded-lg px-3 py-2 bg-gray-100 text-gray-700">Appointing and granting need platform ownership. You can read everything here.</p>}
      {isOwner && !migrationApplied && <p className="text-sm rounded-lg px-3 py-2 bg-[var(--cmp-surface-warning)] text-amber-900">Granting is not available yet: this database does not have migration 500.</p>}

      {list.length === 0 ? <p className="text-sm text-gray-600">No positions exist yet.</p> : (
        <>
          <label className="flex flex-col gap-1 text-[12px] text-gray-600 max-w-md">
            Position
            <select value={code} onChange={e => { setCode(e.target.value); setAck(false); }} className={field}>
              {HQ_SPACES.map(s => {
                const inSpace = list.filter(p => p.space === s);
                return inSpace.length === 0 ? null : (
                  <optgroup key={s} label={`${SPACE_LABEL[s]} space`}>
                    {inSpace.map(p => <option key={p.code} value={p.code}>{p.name}{p.isActive ? "" : " (inactive)"}</option>)}
                  </optgroup>
                );
              })}
            </select>
          </label>

          {position && (
            <>
              <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-2">
                <h3 className="font-semibold text-gray-900">{position.name} <code className="text-[11px] font-normal text-gray-500">{position.code}</code></h3>
                {!position.grants.ok ? <Unreadable what="The grants" error={position.grants.error} />
                  : live && live.length === 0 ? <p className="text-[13px] text-gray-600">This position holds no live grants.</p>
                  : (
                    <ul className="grid gap-1 sm:grid-cols-2">
                      {(live ?? []).map(g => {
                        const sc = sensitiveClassOf(g.capability);
                        return (
                          <li key={g.id} className="text-[12px] flex flex-wrap items-center gap-x-2">
                            <span className="text-gray-900">{g.label ?? labelOf(g.capability)}</span>
                            <code className="text-gray-500">{g.capability}</code>
                            {sc && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[var(--cmp-surface-warning)] text-amber-900">{SENSITIVE_LABEL[sc]}</span>}
                          </li>
                        );
                      })}
                    </ul>
                  )}
              </div>

              {canWrite && (
                <label className="flex flex-col gap-1 text-[12px] text-gray-600 max-w-2xl">
                  Reason for the grants (written to the audit trail, at least {MIN_REASON} characters)
                  <input value={reason} onChange={e => setReason(e.target.value)} className={field} maxLength={500} />
                </label>
              )}

              <div className="grid gap-3 md:grid-cols-2">
                {(Object.keys(PROFILES) as GovernanceProfileKey[]).map(k => (
                  <ProfileCard key={k} k={k} profile={PROFILES[k]} position={position} canWrite={canWrite} reason={reason} applying={applying} labelOf={labelOf}
                    onApply={(kk, gaps) => grantAll(kk, gaps, false)} />
                ))}
              </div>

              <article className="rounded-xl border border-amber-300 bg-[var(--cmp-surface-warning)] p-4 space-y-2">
                <h3 className="font-semibold text-amber-950">Clinical approval (specialist authority)</h3>
                <p className="text-[12px] text-amber-950">
                  Clinical approval is a clinical decision right, not part of any standard profile: executive status is not unrestricted clinical authority.
                  It needs an explicit acknowledgement, and the database refuses it beside content authoring rights that conflict with it.
                </p>
                {!position.grants.ok ? null : clinicalHeld ? <p className="text-[12px] text-amber-950">This position already holds clinical approval.</p> : canWrite ? (
                  <>
                    <label className="flex items-start gap-2 text-[12px] text-amber-950">
                      <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} className="mt-0.5 size-4 pointer-coarse:size-5" />
                      I understand this grants a specialist clinical decision authority to {position.name}.
                    </label>
                    <button className={primary} disabled={!ack || applying !== null || reason.trim().length < MIN_REASON}
                      onClick={() => grantAll("clinical", [...CLINICAL_APPROVAL], true)}>
                      {applying === "clinical" ? "Granting…" : `Add clinical approval to ${position.name}`}
                    </button>
                  </>
                ) : null}
              </article>
            </>
          )}
        </>
      )}
    </section>
  );
}

// ── The page ─────────────────────────────────────────────────────────────────
export default function OrganisationWorkspace({ initialTab, positionBoard, migrationApplied, appointments, isOwner, viewerId, viewerName }: Props) {
  const [tab, setTab] = useState<OrgTab>(initialTab);
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const say: Say = (k, t) => setMsg({ k, t });
  const canWrite = isOwner && migrationApplied;

  function choose(t: OrgTab) {
    setTab(t); setMsg(null);
    try { const u = new URL(window.location.href); u.searchParams.set("tab", t); window.history.replaceState(null, "", u.toString()); } catch { /* the tab still switches */ }
  }
  function onKey(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = TABS[(i + step + TABS.length) % TABS.length];
    choose(next);
    document.getElementById(`org-tab-${next}`)?.focus();
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-bold text-gray-900">Organisation &amp; Appointments</h1>
        <p className="text-gray-500 text-sm mt-1 max-w-3xl">
          Who reports to whom, who holds each position, and what each position can do. Every change is written to the audit trail before it is made.
        </p>
      </header>

      <div role="tablist" aria-label="Organisation sections" className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {TABS.map((t, i) => (
          <button
            key={t} id={`org-tab-${t}`} role="tab" type="button" aria-selected={tab === t} aria-controls={`org-panel-${t}`} tabIndex={tab === t ? 0 : -1}
            onClick={() => choose(t)} onKeyDown={e => onKey(e, i)}
            className={`px-4 py-2 text-[13px] font-semibold whitespace-nowrap min-h-11 pointer-coarse:min-h-[var(--cmp-touch-min)] -mb-px border-b-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 ${
              tab === t ? "border-teal-700 text-teal-900" : "border-transparent text-gray-600 hover:text-gray-900"}`}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {msg && tab !== "appointments" && (
        <p role="status" className={`text-sm rounded-lg px-3 py-2 ${msg.k === "ok" ? "bg-[var(--cmp-surface-success)] text-green-800" : "bg-[var(--cmp-surface-error)] text-red-800"}`}>{msg.t}</p>
      )}

      <div role="tabpanel" id={`org-panel-${tab}`} aria-labelledby={`org-tab-${tab}`} className="space-y-6">
        {tab === "positions" && (
          <>
            <Hierarchy board={positionBoard} appointments={appointments} canWrite={canWrite} say={say} />
            <PositionsBoard board={positionBoard} migrationApplied={migrationApplied} canAdminister={canWrite} isOwner={isOwner} viewerName={viewerName} />
          </>
        )}
        {tab === "appointments" && (
          <>
            <p className="text-[13px] text-gray-700 max-w-3xl">
              Multiple people may hold one position and one person several; an appointment carries term dates and, where the position requires it, the capabilities it carries.
            </p>
            <AppointmentsBoard
              board={appointments.board} people={appointments.people} canAppoint={isOwner} viewerId={viewerId} viewerName={viewerName}
              holdingNow={appointments.holdingNow} onRosterOnly={appointments.onRosterOnly} notListed={appointments.notListed}
            />
          </>
        )}
        {tab === "capabilities" && <Capabilities board={positionBoard} canWrite={canWrite} isOwner={isOwner} migrationApplied={migrationApplied} say={say} />}
      </div>
    </div>
  );
}
