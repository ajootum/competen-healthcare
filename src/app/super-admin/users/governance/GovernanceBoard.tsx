"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Read } from "@/lib/hq/appointments";
import {
  AUTHORITY_BOUNDARIES, CONSTITUTION_LABEL, DELEGATION_LABEL, DOCUMENT_LABEL, GOV_MIN_REASON, LEVEL_LABEL, LINK_KIND_LABEL,
  SEAT_STATUS_LABEL, type GovBodyView, type GovLoad, type GovSeatStatus, type GovSeatView,
} from "@/lib/hq/governance-model";

/**
 * The Scholar governance screen. Every button posts one action to /api/hq/governance, and every refusal shown is
 * the database's own sentence. Nothing on this screen grants access: it says so beside every linked position.
 */

export type GovPersonOption = { id: string; name: string | null; email: string | null };
type Props = { load: GovLoad; canRecord: boolean; people: Read<GovPersonOption[]> | null };
type Post = (body: Record<string, unknown>, key: string, okText: string) => Promise<boolean>;

const input = "border border-gray-300 rounded-lg px-2 py-1 text-sm min-h-9 pointer-coarse:min-h-11";
const btn = "text-[12px] font-medium rounded-lg px-3 py-1.5 min-h-9 pointer-coarse:min-h-11 disabled:opacity-40";
const primary = `${btn} bg-teal-700 text-white hover:bg-teal-800`;
const quiet = `${btn} border border-gray-300 text-gray-700 hover:bg-gray-50`;

const STATUS_TONE: Record<GovSeatStatus, string> = {
  vacant: "bg-gray-100 text-gray-700 border-gray-300",
  nominated: "bg-[var(--cmp-surface-warning)] text-amber-900 border-amber-300",
  interim: "bg-indigo-50 text-indigo-900 border-indigo-300",
  appointed: "bg-[var(--cmp-surface-success)] text-green-800 border-green-300",
};
const StatusPill = ({ s }: { s: GovSeatStatus }) => (
  <span className={`inline-block text-[11px] font-semibold rounded-full border px-2 py-0.5 ${STATUS_TONE[s]}`}>{SEAT_STATUS_LABEL[s]}</span>
);

function SeatCard({ seat, canRecord, post, busy }: { seat: GovSeatView; canRecord: boolean; post: Post; busy: string | null }) {
  const [reason, setReason] = useState("");
  const [interest, setInterest] = useState("");
  const c = seat.current;
  return (
    <li className="rounded-lg border border-gray-200 bg-white p-3 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-gray-900 text-sm">{seat.name}</p>
          {seat.description && <p className="text-[12px] text-gray-500">{seat.description}</p>}
        </div>
        <StatusPill s={seat.status} />
      </div>
      {seat.accountability && <p className="text-[12px] text-gray-700"><span className="text-gray-500">Accountable for:</span> {seat.accountability}</p>}
      {seat.provider && <p className="text-[12px] text-gray-700"><span className="text-gray-500">Provided by:</span> {seat.provider === "holdings" ? "Competen Holdings" : "Competen Scholar"}</p>}
      {c && (
        <div className="text-[12px] text-gray-800 rounded-md bg-gray-50 px-2 py-1.5 space-y-0.5">
          <p><span className="font-medium">{c.holderName ?? "Unnamed holder"}</span>{!c.hasProfile && <span className="text-gray-500"> (no Competen account)</span>} · {c.status}{c.effectiveFrom ? ` from ${c.effectiveFrom}` : ""}</p>
          {c.basis && <p className="text-gray-600">Basis: {c.basis}</p>}
          <p className="text-gray-600">Interests: {c.interests.length ? c.interests.map(i => i.interest + (i.mitigation ? ` (managed: ${i.mitigation})` : "")).join(" · ") : "none declared yet"}</p>
        </div>
      )}
      {seat.authorityPosition ? (
        <p className="text-[12px] text-gray-700">
          <span className="text-gray-500">Platform right through the existing position </span>
          <Link href="/super-admin/users/appointments" className="text-teal-700 hover:underline">{seat.authorityPosition.name}</Link>
          {" · "}
          {seat.authorityPosition.activeHolders.ok
            ? `${seat.authorityPosition.activeHolders.value} active HQ holder${seat.authorityPosition.activeHolders.value === 1 ? "" : "s"}`
            : "holder count unknown (could not be read)"}
          <span className="block text-gray-500">Filling this seat grants nothing. Holding the position does not fill this seat.</span>
        </p>
      ) : seat.kind === "director" ? (
        <p className="text-[12px] text-gray-500">A board seat grants no platform capability.</p>
      ) : null}
      {seat.independentOf.length > 0 && (
        <p className="text-[12px] text-gray-600">Independence: {seat.independentOf.map(x => x.reason).join(" · ")}</p>
      )}
      {seat.exclusive && <p className="text-[12px] text-gray-600">Independent seat: cannot be combined with any other seat.</p>}
      {seat.links.filter(l => l.kind !== "ai_escalation").length > 0 && (
        <ul className="text-[12px] space-y-0.5">
          {seat.links.filter(l => l.kind !== "ai_escalation").map(l => (
            <li key={l.code}><Link href={l.route} className="text-teal-700 hover:underline">{l.label}</Link>{l.note && <span className="text-gray-500"> · {l.note}</span>}</li>
          ))}
        </ul>
      )}
      {canRecord && c && (
        <details className="text-[12px]">
          <summary className="cursor-pointer text-gray-700">Record an interest or end this record</summary>
          <div className="mt-2 grid gap-2">
            <label className="flex flex-col gap-1 text-gray-600">Declared interest
              <input value={interest} onChange={e => setInterest(e.target.value)} className={input} maxLength={500} />
            </label>
            <label className="flex flex-col gap-1 text-gray-600">Reason (written to the audit trail)
              <input value={reason} onChange={e => setReason(e.target.value)} className={input} maxLength={500} />
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={quiet} disabled={!interest.trim() || reason.trim().length < GOV_MIN_REASON || busy === `int-${c.id}`}
                onClick={() => post({ action: "declare_interest", appointment_id: c.id, interest, reason }, `int-${c.id}`, "Interest recorded.")}>Record interest</button>
              <button type="button" className={quiet} disabled={reason.trim().length < GOV_MIN_REASON || busy === `end-${c.id}`}
                onClick={() => post({ action: "end", appointment_id: c.id, reason }, `end-${c.id}`, "Record ended. It stays as history.")}>End record</button>
            </div>
          </div>
        </details>
      )}
    </li>
  );
}

function BodyCard({ body, canRecord, post, busy }: { body: GovBodyView; canRecord: boolean; post: Post; busy: string | null }) {
  const accent = body.kind === "holding_company" || body.kind === "product_lead" ? "border-indigo-300" : "border-gray-200";
  return (
    <section className={`rounded-xl border ${accent} bg-white p-4 space-y-3`} aria-labelledby={`body-${body.code}`}>
      <div className="space-y-1">
        <h3 id={`body-${body.code}`} className="text-base font-bold text-gray-900">{body.name}</h3>
        {body.description && <p className="text-sm text-gray-600">{body.description}</p>}
        <p className="text-[12px] text-gray-600">
          <span className="font-medium">{CONSTITUTION_LABEL[body.constitution] ?? body.constitution}</span>
          {body.constitutionNote && <> · {body.constitutionNote}</>}
        </p>
        {body.interimAuthority && (
          <p className="text-[12px] rounded-md bg-indigo-50 text-indigo-900 px-2 py-1">Interim authority: {body.interimAuthority}</p>
        )}
        <p className="text-[12px] text-gray-600">
          Governing document: <span className="font-medium">{DOCUMENT_LABEL[body.documentStatus] ?? body.documentStatus}</span>
          {body.documentRef && <> · {body.documentRef}</>}
        </p>
      </div>
      {body.seats.length > 0
        ? <ul className="grid gap-2 md:grid-cols-2">{body.seats.map(s => <SeatCard key={s.code} seat={s} canRecord={canRecord} post={post} busy={busy} />)}</ul>
        : <p className="text-[12px] text-gray-500">This body has no seats of its own.</p>}
    </section>
  );
}

function RecordAppointment({ seats, people, post, busy }: { seats: GovSeatView[]; people: Read<GovPersonOption[]> | null; post: Post; busy: string | null }) {
  const [seat, setSeat] = useState("");
  const [personId, setPersonId] = useState("");
  const [holderName, setHolderName] = useState("");
  const [status, setStatus] = useState<"nominated" | "interim" | "active">("nominated");
  const [basis, setBasis] = useState("");
  const [interests, setInterests] = useState("");
  const [reason, setReason] = useState("");
  const open = seats.filter(s => s.status === "vacant" || s.status === "nominated");
  const needsMore = status !== "nominated";
  const ready = !!seat && (!!personId || !!holderName.trim()) && reason.trim().length >= GOV_MIN_REASON
    && (!needsMore || (basis.trim().length >= 5 && !!interests.trim()));
  return (
    <details className="rounded-xl border border-gray-200 bg-white p-4">
      <summary className="cursor-pointer font-semibold text-gray-900">Record a nomination or a lawful appointment</summary>
      <p className="mt-2 text-[12px] text-gray-600 max-w-3xl">
        Record only what has lawfully happened. A board director cannot be appointed until Competen Scholar is
        incorporated, so the database accepts only a nomination for a board seat. An interim or active record needs its
        basis and a declaration of interests. Nothing recorded here grants platform access.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[12px] text-gray-600">Seat
          <select value={seat} onChange={e => setSeat(e.target.value)} className={input}>
            <option value="">Choose a seat</option>
            {open.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-gray-600">Status
          <select value={status} onChange={e => setStatus(e.target.value as typeof status)} className={input}>
            <option value="nominated">Nominated (seat stays vacant)</option>
            <option value="interim">Interim holder</option>
            <option value="active">Appointed</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-gray-600">Person with a Competen account
          {people && !people.ok
            ? <span className="text-amber-900">People could not be read ({people.error}). Enter a name instead.</span>
            : (
              <select value={personId} onChange={e => { setPersonId(e.target.value); if (e.target.value) setHolderName(""); }} className={input}>
                <option value="">None, enter a name</option>
                {(people?.ok ? people.value : []).map(p => <option key={p.id} value={p.id}>{p.name ?? "Unnamed"}{p.email ? ` (${p.email})` : ""}</option>)}
              </select>
            )}
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-gray-600">Or the holder&apos;s name
          <input value={holderName} onChange={e => { setHolderName(e.target.value); if (e.target.value) setPersonId(""); }} className={input} maxLength={200} disabled={!!personId} />
        </label>
        {needsMore && (
          <>
            <label className="flex flex-col gap-1 text-[12px] text-gray-600">Lawful basis (resolution, instrument or decision reference)
              <input value={basis} onChange={e => setBasis(e.target.value)} className={input} maxLength={500} />
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-gray-600">Declared interests (write None declared if none)
              <input value={interests} onChange={e => setInterests(e.target.value)} className={input} maxLength={500} />
            </label>
          </>
        )}
        <label className="flex flex-col gap-1 text-[12px] text-gray-600 sm:col-span-2">Reason (written to the audit trail)
          <input value={reason} onChange={e => setReason(e.target.value)} className={input} maxLength={500} />
        </label>
      </div>
      <button type="button" className={`${primary} mt-3`} disabled={!ready || busy === "appoint"}
        onClick={async () => {
          const ok = await post({ action: "appoint", seat, person_id: personId || null, holder_name: holderName || null, status, basis, interests, reason }, "appoint", "Recorded.");
          if (ok) { setSeat(""); setPersonId(""); setHolderName(""); setBasis(""); setInterests(""); setReason(""); }
        }}>Record</button>
    </details>
  );
}

export default function GovernanceBoard({ load, canRecord, people }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const [delReason, setDelReason] = useState("");

  const post: Post = async (body, key, okText) => {
    setBusy(key); setMsg(null);
    try {
      const r = await fetch("/api/hq/governance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) { setMsg({ k: "ok", t: okText }); router.refresh(); return true; }
      setMsg({ k: "err", t: j.error ?? `The request failed (HTTP ${r.status}). Nothing was changed.` });
    } catch {
      setMsg({ k: "err", t: "The request did not reach the server, so nothing was changed." });
    } finally {
      setBusy(null);
    }
    return false;
  };

  const header = (
    <header>
      <p className="text-[12px] font-semibold tracking-wide text-indigo-800 uppercase">Competen Scholar · Governance Model V1</p>
      <h1 className="text-xl font-bold text-gray-900">Scholar governance</h1>
      <p className="text-gray-500 text-sm mt-1 max-w-3xl">
        Three levels of accountability, every seat and its status, the delegations between them, and the existing
        workflows each seat runs through. This is a governance record: platform authority comes only from an HQ
        appointment to a position, on <Link href="/super-admin/users/appointments" className="text-teal-700 hover:underline">HQ positions</Link>.
      </p>
    </header>
  );

  if (load.state !== "ok")
    return (
      <div className="space-y-6">
        {header}
        <p className="text-sm rounded-lg px-3 py-2 bg-[var(--cmp-surface-warning)] text-amber-900">
          {load.state === "absent" ? load.reason : <>The Scholar governance registry could not be read. This is not an empty structure. <span className="text-amber-800/80">({load.error})</span></>}
        </p>
      </div>
    );

  const b = load.board;
  const seats = b.bodies.flatMap(x => x.seats);
  return (
    <div className="space-y-6">
      {header}
      {msg && (
        <p role="status" className={`text-sm rounded-lg px-3 py-2 ${msg.k === "ok" ? "bg-[var(--cmp-surface-success)] text-green-800" : "bg-[var(--cmp-surface-error)] text-red-800"}`}>{msg.t}</p>
      )}
      {b.notes.map(n => <p key={n} className="text-sm rounded-lg px-3 py-2 bg-[var(--cmp-surface-warning)] text-amber-900">{n}</p>)}

      <section aria-label="Seat status" className="grid gap-2 grid-cols-2 md:grid-cols-5">
        {([["Seats", b.counts.seats], ["Vacant", b.counts.vacant], ["Nominated", b.counts.nominated], ["Interim", b.counts.interim], ["Appointed", b.counts.appointed]] as const).map(([k, v]) => (
          <div key={k} className="rounded-xl border border-gray-200 bg-white px-3 py-2">
            <p className="text-[12px] text-gray-500">{k}</p><p className="text-lg font-bold text-gray-900">{v}</p>
          </div>
        ))}
      </section>

      {canRecord && <RecordAppointment seats={seats} people={people} post={post} busy={busy} />}

      {([1, 2, 3] as const).map(level => {
        const bodies = b.bodies.filter(x => x.level === level);
        if (!bodies.length) return null;
        return (
          <section key={level} className="space-y-3">
            <h2 className="text-sm font-bold tracking-wide text-indigo-800 uppercase">{LEVEL_LABEL[level]}</h2>
            {bodies.map(body => <BodyCard key={body.code} body={body} canRecord={canRecord} post={post} busy={busy} />)}
          </section>
        );
      })}

      <section className="space-y-2">
        <h2 className="text-base font-bold text-gray-900">Delegated authority</h2>
        <ul className="space-y-2">
          {b.delegations.map(d => (
            <li key={d.code} className="rounded-lg border border-gray-200 bg-white p-3 text-sm space-y-1">
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-gray-900">{d.from} → {d.to}</span>
                <span className={`text-[11px] font-semibold rounded-full border px-2 py-0.5 ${d.active ? "bg-indigo-50 text-indigo-900 border-indigo-300" : "bg-gray-100 text-gray-700 border-gray-300"}`}>{DELEGATION_LABEL[d.status] ?? d.status}</span>
              </p>
              <p className="text-[12px] text-gray-700">{d.scope}</p>
              {d.basis && <p className="text-[12px] text-gray-500">Basis: {d.basis}</p>}
              {canRecord && d.status !== "withdrawn" && (
                <div className="pt-1">
                  <button type="button" className={quiet} disabled={delReason.trim().length < GOV_MIN_REASON || busy === `del-${d.code}`}
                    onClick={() => post({ action: "set_delegation", code: d.code, status: "withdrawn", reason: delReason }, `del-${d.code}`, "Delegation withdrawn.")}>Withdraw</button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {canRecord && (
          <label className="flex flex-col gap-1 text-[12px] text-gray-600 max-w-xl">Reason for a delegation change (written to the audit trail)
            <input value={delReason} onChange={e => setDelReason(e.target.value)} className={input} maxLength={500} />
          </label>
        )}
        <p className="text-[12px] text-gray-500">A delegation from a body that is not established cannot be approved: the database refuses it.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-bold text-gray-900">{LINK_KIND_LABEL.ai_escalation}</h2>
        <ol className="space-y-1">
          {b.escalation.map(e => (
            <li key={e.code} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm flex flex-wrap items-center gap-2">
              <span className="font-semibold text-gray-900">{e.step}.</span>
              <Link href={e.route} className="text-teal-700 hover:underline">{e.label}</Link>
              <span className="text-gray-600">· {e.seatName}</span>
              <StatusPill s={e.seatStatus} />
              {e.note && <span className="text-[12px] text-gray-500 basis-full">{e.note}</span>}
            </li>
          ))}
        </ol>
        <p className="text-[12px] text-gray-500">Each step opens only for someone holding that page&apos;s HQ right, and for a platform owner. A step whose seat is vacant has nobody else to act on it yet.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-bold text-gray-900">Outstanding appointments ({b.outstanding.length})</h2>
        <ul className="grid gap-1 md:grid-cols-2 text-sm">
          {b.outstanding.map(o => (
            <li key={o.seat} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 flex items-center justify-between gap-2">
              <span><span className="text-gray-900">{o.seatName}</span> <span className="text-[12px] text-gray-500">· {o.body}</span></span>
              <StatusPill s={o.status} />
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 space-y-1">
        <h2 className="text-sm font-bold tracking-wide text-indigo-800 uppercase">Authority boundaries</h2>
        <ul className="list-disc pl-5 text-sm text-gray-800 space-y-0.5">
          {AUTHORITY_BOUNDARIES.map(t => <li key={t}>{t}</li>)}
        </ul>
        <p className="text-[12px] text-gray-600 pt-1">Functions may be combined where qualifications and independence allow. The database refuses the combinations that independence forbids.</p>
      </section>
    </div>
  );
}
