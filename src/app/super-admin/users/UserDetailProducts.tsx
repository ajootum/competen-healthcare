"use client";

import { useState } from "react";
import { PARTICIPATION_CATEGORIES, PARTICIPATION_LABEL, type ParticipationCategory } from "@/lib/hq/account-participation";
import { EXPERIENCE_NAME, basisLabel, formatDay, invitationStatus } from "@/lib/hq/user-detail";
import type { UserDetail } from "./user-detail-load";
import { Notice, SectionCard, SourceNote, StatePill, SubHead, btn, btnPrimary, inputCls } from "./UserDetailParts";

// Section 3 -- Products & Entitlements. ACTUAL entitlement rows (individual_entitlement, with liveness taken from the
// database-clock view), the open invitations, and the participation category. The category is a label: it grants and
// removes nothing. Grants, extensions and ending access stay on the Individual access board; this screen builds no
// second grant engine and offers only the link.

const ENTITLEMENT_STATUS: Record<string, string> = {
  active: "Active", trial: "Trial", suspended: "Suspended", expired: "Expired", cancelled: "Cancelled",
};

export default function UserDetailProducts({ userId, products, names, canManage, participationAvailable, onChanged }: {
  userId: string;
  products: UserDetail["products"];
  names: Record<string, string>;
  canManage: boolean;
  participationAvailable: boolean;
  onChanged: () => void;
}) {
  const { membership, entitlements, invitations, participation } = products;
  return (
    <SectionCard id="products" title="Products & Entitlements" subtitle="What the person can actually use, from the access records. Roles do not appear here.">
      <SubHead>Competen Individual membership</SubHead>
      {membership.state !== "ok" ? <SourceNote state={membership.state} what="Individual membership" />
        : !membership.value ? <p className="text-[13px] text-gray-700"><StatePill state="not_applicable" why="No Competen Individual membership exists for this person." /> No Individual membership.</p>
        : (
          <p className="text-[13px] text-gray-800">
            <b>{membership.value.status}</b> · source {basisLabel(membership.value.source === "hq_pilot_grant" ? "pilot" : membership.value.source)}
            {membership.value.onboardedAt ? ` · welcome finished ${formatDay(membership.value.onboardedAt)}` : " · welcome not finished"}
          </p>
        )}

      <SubHead>Entitlements</SubHead>
      {entitlements.state !== "ok" ? <SourceNote state={entitlements.state} what="Entitlements" />
        : entitlements.value.length === 0 ? <p className="text-[13px] text-gray-700"><StatePill state="not_applicable" why="No Scholar or Professional period has been granted." /> No Scholar or Professional period.</p>
        : (
          <ul className="flex flex-col gap-2">
            {entitlements.value.map(e => (
              <li key={e.id} className="rounded-lg border border-gray-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <b className="text-[13px] text-gray-900">{EXPERIENCE_NAME[e.experience] ?? e.experience}</b>
                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${e.live ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]" : "bg-[var(--cmp-surface-neutral)] text-gray-600"}`}>
                    {e.live ? "Live now" : `${ENTITLEMENT_STATUS[e.status] ?? e.status}${e.status === "active" || e.status === "trial" ? " · not live now" : ""}`}
                  </span>
                </div>
                <dl className="mt-1.5 grid gap-x-4 gap-y-1 text-[12px] text-gray-700 sm:grid-cols-2">
                  <div><dt className="inline text-gray-500">Starts </dt><dd className="inline">{formatDay(e.startsAt)}</dd></div>
                  <div><dt className="inline text-gray-500">Ends </dt><dd className="inline">{e.endsAt ? formatDay(e.endsAt) : "No end date"}</dd></div>
                  <div><dt className="inline text-gray-500">Basis </dt><dd className="inline">{basisLabel(e.source, e.planCode)}</dd></div>
                  <div><dt className="inline text-gray-500">Granted by </dt>
                    <dd className="inline">{e.grantedBy ? names[e.grantedBy] ?? "Name not available" : e.source === "payment" ? "Not applicable (paid)" : "Not recorded"}</dd></div>
                </dl>
              </li>
            ))}
          </ul>
        )}

      <SubHead>Invitations</SubHead>
      {invitations.state !== "ok" ? <SourceNote state={invitations.state} what="Invitations" />
        : invitations.value.length === 0 ? <p className="text-[13px] text-gray-700"><StatePill state="not_applicable" why="This person has not been invited to Competen Individual." /> No invitation.</p>
        : (
          <ul className="flex flex-col gap-2">
            {invitations.value.map(i => (
              <li key={i.id} className="rounded-lg border border-gray-200 p-3 text-[12px] text-gray-700">
                <p className="text-[13px] text-gray-900"><b>{i.experiences.map(x => EXPERIENCE_NAME[x] ?? x).join(" and ") || "No experience"}</b> · {invitationStatus(i.status, i.live)}</p>
                <p className="mt-1">
                  Sent {formatDay(i.createdAt)} · {i.status === "ACCEPTED" ? `accepted ${formatDay(i.acceptedAt)}` : i.status === "REVOKED" ? `revoked ${formatDay(i.revokedAt)}` : `expires ${formatDay(i.expiresAt)}`}
                  {" "}· access ends {i.endsAt ? formatDay(i.endsAt) : "with no end date"} · basis {basisLabel(i.entitlementSource ?? "pilot")}
                </p>
              </li>
            ))}
          </ul>
        )}

      <SubHead>Access category</SubHead>
      {!participationAvailable || participation.state === "not_set_up" ? <SourceNote state="not_set_up" what="Access categories" />
        : participation.state === "unreadable" ? <SourceNote state="unreadable" what="The access category" />
        : <Participation userId={userId} current={participation.value} names={names} canManage={canManage} onChanged={onChanged} />}

      <p className="mt-4 text-[12px] text-gray-600">
        To grant, extend or end access, use the{" "}
        <a href="/super-admin/individual" className="font-semibold text-teal-700 underline">Individual access board</a>.
      </p>
    </SectionCard>
  );
}

function Participation({ userId, current, names, canManage, onChanged }: {
  userId: string;
  current: Extract<UserDetail["products"]["participation"], { state: "ok" }>["value"];
  names: Record<string, string>;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [category, setCategory] = useState<ParticipationCategory>("regular");
  const [cohort, setCohort] = useState("");
  const [until, setUntil] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function start() {
    setCategory((current?.category as ParticipationCategory) ?? "regular");
    setCohort(current?.cohort ?? ""); setUntil(current?.validUntil ? current.validUntil.slice(0, 10) : ""); setReason("");
    setMsg(null); setEditing(true);
  }
  async function save() {
    if (!reason.trim()) { setMsg({ kind: "err", text: "Say why. The reason is recorded in the audit trail." }); return; }
    setSaving(true); setMsg(null);
    try {
      const res = await fetch("/api/super-admin/users/participation", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, category, reason, cohort: cohort || null, validUntil: until ? new Date(`${until}T23:59:59Z`).toISOString() : null }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      if (!res.ok) { setMsg({ kind: "err", text: res.status === 503 ? "Access categories are not set up in this environment yet." : j.error ?? "The category could not be saved." }); return; }
      setEditing(false); setMsg({ kind: "ok", text: "Category saved. It is in the audit trail. It changes no access." });
      onChanged();
    } catch { setMsg({ kind: "err", text: "The category could not be saved. Check your connection and try again." }); }
    finally { setSaving(false); }
  }

  return (
    <div>
      {!editing && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13px] text-gray-800">
            {current ? (
              <><b>{PARTICIPATION_LABEL[current.category as ParticipationCategory] ?? current.category}</b>
                {current.cohort ? ` · cohort ${current.cohort}` : ""}
                {current.validUntil ? ` · until ${formatDay(current.validUntil)}` : " · no end date"}
                <span className="block text-[12px] text-gray-600">
                  Reason: {current.reason}{current.setBy ? ` · set by ${names[current.setBy] ?? "a platform owner"}` : ""}{current.updatedAt ? ` · ${formatDay(current.updatedAt)}` : ""}
                </span></>
            ) : <><StatePill state="missing" why="No category has been set for this person." /> No category set.</>}
          </p>
          {canManage && <button type="button" onClick={start} className={btn}>{current ? "Change category" : "Set category"}</button>}
        </div>
      )}
      {editing && (
        <form onSubmit={e => { e.preventDefault(); void save(); }} className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="ud-p-cat" className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-gray-500">Category</label>
            <select id="ud-p-cat" value={category} onChange={e => setCategory(e.target.value as ParticipationCategory)} className={inputCls}>
              {PARTICIPATION_CATEGORIES.map(c => <option key={c} value={c}>{PARTICIPATION_LABEL[c]}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="ud-p-until" className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-gray-500">Valid until (optional)</label>
            <input id="ud-p-until" type="date" value={until} onChange={e => setUntil(e.target.value)} className={inputCls} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="ud-p-cohort" className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-gray-500">Cohort (optional)</label>
            <input id="ud-p-cohort" value={cohort} maxLength={60} onChange={e => setCohort(e.target.value)} className={inputCls} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="ud-p-reason" className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-gray-500">Reason (recorded in the audit trail)</label>
            <textarea id="ud-p-reason" value={reason} maxLength={600} rows={2} onChange={e => setReason(e.target.value)} className={inputCls} />
            <p className="mt-1 text-[11px] text-gray-500">A category is a label for filtering and reporting. It grants and removes no access.</p>
          </div>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button type="submit" disabled={saving || !reason.trim()} className={btnPrimary}>{saving ? "Saving…" : "Save category"}</button>
            <button type="button" disabled={saving} onClick={() => { setEditing(false); setMsg(null); }} className={btn}>Cancel</button>
          </div>
        </form>
      )}
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      {!canManage && <p className="mt-2 text-[11px] text-gray-500">Only a platform owner can set the category.</p>}
    </div>
  );
}
