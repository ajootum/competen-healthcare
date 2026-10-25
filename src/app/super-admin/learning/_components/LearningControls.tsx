"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { primary, ghost, input, Message } from "@/app/super-admin/ai/fair-use/_components/FairUseControls";

// The Learning studio's small controls. Each posts one action to /api/hq/learning, which fixes the capability per
// action and takes the person from the session. Refusals come back in words, with a version's problems when it is not
// ready to go forward.

export { primary, ghost, input, Message };

export function useLearningSend() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  async function send(body: Record<string, unknown>, done: string, after?: (j: any) => void) {
    setBusy(true); setMsg(null); setProblems([]);
    try {
      const res = await fetch("/api/hq/learning", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: j?.error ?? "That could not be done. Nothing has changed." }); setProblems(Array.isArray(j?.problems) ? j.problems : []); return; }
      setMsg({ ok: true, text: done });
      if (Array.isArray(j?.problems)) setProblems(j.problems);
      after?.(j);
      router.refresh();
    } catch { setMsg({ ok: false, text: "That could not be done. Check your connection." }); } finally { setBusy(false); }
  }
  return { busy, msg, problems, send };
}

export function Problems({ items, title = "Still to do before it can go forward" }: { items: string[]; title?: string }) {
  if (!items.length) return null;
  return (
    <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-950">
      <p className="font-semibold">{title} ({items.length})</p>
      <ul className="mt-1 list-disc pl-5">{items.slice(0, 60).map((p, i) => <li key={i}>{p}</li>)}</ul>
    </div>
  );
}

/** One button that posts one action. */
export function ActionButton({ body, label, done, tone = "primary", confirm, after }: { body: Record<string, unknown>; label: string; done: string; tone?: "primary" | "ghost"; confirm?: string; after?: (j: any) => void }) {
  const { busy, msg, problems, send } = useLearningSend();
  return (
    <div className="space-y-2">
      <button type="button" className={tone === "primary" ? primary : ghost} disabled={busy}
        onClick={() => { if (confirm && !window.confirm(confirm)) return; send(body, done, after); }}>{label}</button>
      <Message msg={msg} />
      <Problems items={problems} />
    </div>
  );
}

export function CreateProvider() {
  const { busy, msg, send } = useLearningSend();
  const [f, setF] = useState({ code: "", name: "", kind: "competen", websiteUrl: "" });
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); send({ action: "create_provider", ...f }, "Provider added."); }}>
      <label className="text-[12.5px] text-gray-700">Code<input className={`${input} ml-1 w-32`} value={f.code} onChange={e => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="COMPETEN" required /></label>
      <label className="text-[12.5px] text-gray-700">Name<input className={`${input} ml-1 w-56`} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="Competen Holdings" required /></label>
      <label className="text-[12.5px] text-gray-700">Kind<select className={`${input} ml-1`} value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}>
        <option value="competen">Competen</option><option value="partner">Partner</option><option value="external">External provider</option></select></label>
      <label className="text-[12.5px] text-gray-700">Website (https)<input className={`${input} ml-1 w-56`} value={f.websiteUrl} onChange={e => setF({ ...f, websiteUrl: e.target.value })} /></label>
      <button type="submit" className={primary} disabled={busy}>Add provider</button>
      <Message msg={msg} />
    </form>
  );
}

export function CreateOffering({ types, providers }: { types: string[]; providers: { id: string; name: string; kind: string }[] }) {
  const router = useRouter();
  const { busy, msg, send } = useLearningSend();
  const [f, setF] = useState({ code: "", title: "", source: "competen", delivery: "hosted", offeringType: types[0] ?? "course", owner: "", deliveryProvider: "", issuer: "", commercial: "" });
  const sel = (k: keyof typeof f, label: string) => (
    <label className="text-[12.5px] text-gray-700">{label}<select className={`${input} ml-1`} value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })}>
      <option value="">Not yet</option>{providers.map(p => <option key={p.id} value={p.id}>{p.name} ({p.kind})</option>)}</select></label>
  );
  return (
    <form className="space-y-2" onSubmit={e => { e.preventDefault(); send({ action: "create", code: f.code, title: f.title, source: f.source, delivery: f.source === "external" ? "external" : f.delivery, offeringType: f.offeringType,
      responsibilities: { contentOwnerId: f.owner || null, deliveryProviderId: f.deliveryProvider || null, certificateIssuerId: f.issuer || null, commercialProviderId: f.commercial || null } },
      "Created, with its first draft.", j => j?.offeringId && router.push(`/super-admin/learning/${j.offeringId}`)); }}>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[12.5px] text-gray-700">Code<input className={`${input} ml-1 w-44`} value={f.code} onChange={e => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="LRN-ECG-01" required pattern="LRN-[A-Za-z0-9][A-Za-z0-9-]{2,40}" /></label>
        <label className="text-[12.5px] text-gray-700">Title<input className={`${input} ml-1 w-64`} value={f.title} onChange={e => setF({ ...f, title: e.target.value })} required /></label>
        <label className="text-[12.5px] text-gray-700">Whose learning<select className={`${input} ml-1`} value={f.source} onChange={e => setF({ ...f, source: e.target.value })}>
          <option value="competen">Competen-developed</option><option value="partner">Partner-developed</option><option value="external">External linked course</option></select></label>
        {f.source === "partner" && <label className="text-[12.5px] text-gray-700">Delivered<select className={`${input} ml-1`} value={f.delivery} onChange={e => setF({ ...f, delivery: e.target.value })}>
          <option value="hosted">On Competen</option><option value="external">On the partner&apos;s platform</option></select></label>}
        <label className="text-[12.5px] text-gray-700">Type<select className={`${input} ml-1`} value={f.offeringType} onChange={e => setF({ ...f, offeringType: e.target.value })}>{types.map(t => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}</select></label>
      </div>
      <div className="flex flex-wrap items-end gap-2">{sel("owner", "Content owner")}{sel("deliveryProvider", "Delivery provider")}{sel("issuer", "Certificate issuer")}{sel("commercial", "Commercial party")}</div>
      <button type="submit" className={primary} disabled={busy}>Create</button>
      <Message msg={msg} />
    </form>
  );
}

export function ProposePrice({ offeringId }: { offeringId: string }) {
  const { busy, msg, send } = useLearningSend();
  const [f, setF] = useState({ currency: "", amountMajor: "", accessDays: "365", note: "" });
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); send({ action: "propose_price", offeringId, currency: f.currency, amountMajor: Number(f.amountMajor), accessDays: f.accessDays === "" ? null : Number(f.accessDays), note: f.note }, "Proposed. A Learning Price Approver must approve it before anyone can buy at this price."); }}>
      <label className="text-[12.5px] text-gray-700">Currency<input className={`${input} ml-1 w-20`} value={f.currency} onChange={e => setF({ ...f, currency: e.target.value.toUpperCase() })} maxLength={3} required placeholder="ISO" aria-describedby="cur-hint" /><span id="cur-hint" className="sr-only">Three-letter ISO currency code</span></label>
      <label className="text-[12.5px] text-gray-700">Price<input className={`${input} ml-1 w-32`} inputMode="decimal" value={f.amountMajor} onChange={e => setF({ ...f, amountMajor: e.target.value })} required /></label>
      <label className="text-[12.5px] text-gray-700">Access days (blank: as long as the terms allow)<input className={`${input} ml-1 w-24`} inputMode="numeric" value={f.accessDays} onChange={e => setF({ ...f, accessDays: e.target.value })} /></label>
      <label className="text-[12.5px] text-gray-700">Note<input className={`${input} ml-1 w-56`} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></label>
      <button type="submit" className={primary} disabled={busy}>Propose price</button>
      <Message msg={msg} />
    </form>
  );
}

export function DecidePrice({ priceId }: { priceId: string }) {
  const { busy, msg, send } = useLearningSend();
  const [note, setNote] = useState("");
  return (
    <div className="flex flex-wrap items-end gap-2">
      <button type="button" className={primary} disabled={busy} onClick={() => send({ action: "decide_price", priceId, approve: true, note }, "Approved. It is now the current price in its currency.")}>Approve</button>
      <input className={`${input} w-64`} placeholder="Reason (needed to reject)" value={note} onChange={e => setNote(e.target.value)} aria-label="Reason" />
      <button type="button" className={ghost} disabled={busy} onClick={() => send({ action: "decide_price", priceId, approve: false, note }, "Rejected.")}>Reject</button>
      <Message msg={msg} />
    </div>
  );
}

export function AuthoriseCertificates({ versionId }: { versionId: string }) {
  const { busy, msg, send } = useLearningSend();
  const [cc, setCc] = useState(true), [ak, setAk] = useState(true), [note, setNote] = useState("");
  return (
    <form className="flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); send({ action: "authorise_certificates", versionId, outcomes: [cc && "course_completion", ak && "assessed_knowledge"].filter(Boolean), note }, "Authorised. Completed records of this version now receive these certificates."); }}>
      <label className="text-[12.5px] text-gray-700"><input type="checkbox" checked={cc} onChange={e => setCc(e.target.checked)} /> Course completion</label>
      <label className="text-[12.5px] text-gray-700"><input type="checkbox" checked={ak} onChange={e => setAk(e.target.checked)} /> Assessed knowledge</label>
      <input className={`${input} w-64`} placeholder="Note (optional)" value={note} onChange={e => setNote(e.target.value)} aria-label="Note" />
      <button type="submit" className={primary} disabled={busy}>Authorise certificates</button>
      <Message msg={msg} />
    </form>
  );
}

export function RevokeCertificate({ certificateId }: { certificateId: string }) {
  const { busy, msg, send } = useLearningSend();
  const [reason, setReason] = useState("");
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); send({ action: "revoke_certificate", certificateId, reason }, "Revoked. Its verification page now says so."); }}>
      <input className={`${input} w-64`} placeholder="Why it is revoked" value={reason} onChange={e => setReason(e.target.value)} required aria-label="Reason" />
      <button type="submit" className={ghost} disabled={busy}>Revoke</button>
      <Message msg={msg} />
    </form>
  );
}

export function GrantAccess({ offerings }: { offerings: { id: string; code: string; title: string }[] }) {
  const { busy, msg, send } = useLearningSend();
  const [f, setF] = useState({ userId: "", offeringId: offerings[0]?.id ?? "", days: "", note: "" });
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); send({ action: "grant_access", userId: f.userId.trim(), offeringId: f.offeringId, days: f.days === "" ? null : Number(f.days), note: f.note }, "Access granted. The member can now enrol on the course."); }}>
      <label className="text-[12.5px] text-gray-700">Member profile id<input className={`${input} ml-1 w-80`} value={f.userId} onChange={e => setF({ ...f, userId: e.target.value })} required /></label>
      <label className="text-[12.5px] text-gray-700">Course<select className={`${input} ml-1`} value={f.offeringId} onChange={e => setF({ ...f, offeringId: e.target.value })}>{offerings.map(o => <option key={o.id} value={o.id}>{o.code} {o.title}</option>)}</select></label>
      <label className="text-[12.5px] text-gray-700">Days (blank: no end)<input className={`${input} ml-1 w-20`} inputMode="numeric" value={f.days} onChange={e => setF({ ...f, days: e.target.value })} /></label>
      <label className="text-[12.5px] text-gray-700">Why<input className={`${input} ml-1 w-64`} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} required /></label>
      <button type="submit" className={primary} disabled={busy}>Grant access</button>
      <Message msg={msg} />
    </form>
  );
}

export function PolicyEditor({ policy }: { policy: any }) {
  const { busy, msg, send } = useLearningSend();
  const [f, setF] = useState({ offeringTypes: policy.offeringTypes.join(", "), formats: policy.formats.join(", "), levels: policy.levels.join(", "), checkAttempts: String(policy.checkAttempts), listingReviewWarningDays: String(policy.listingReviewWarningDays) });
  const list = (s: string) => s.split(",").map(x => x.trim()).filter(Boolean);
  const draft = () => ({ ...policy, offeringTypes: list(f.offeringTypes), formats: list(f.formats), levels: list(f.levels), checkAttempts: Number(f.checkAttempts), listingReviewWarningDays: Number(f.listingReviewWarningDays) });
  const row = (k: keyof typeof f, label: string) => <label className="block text-[12.5px] text-gray-700">{label}<input className={`${input} mt-1 w-full`} value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} /></label>;
  return (
    <div className="space-y-2">
      {row("offeringTypes", "Offering types (lowercase codes, comma-separated)")}{row("formats", "Formats")}{row("levels", "Levels")}{row("checkAttempts", "Attempts per knowledge check (1-20)")}{row("listingReviewWarningDays", "Warn this many days before a listing's review date")}
      <div className="flex gap-2">
        <button type="button" className={ghost} disabled={busy} onClick={() => send({ action: "policy_draft", policy: draft() }, "Draft saved. Publish it to apply it.")}>Save draft</button>
        <button type="button" className={primary} disabled={busy} onClick={() => send({ action: "policy_publish" }, "Published. The studio and catalogue use it now.")}>Publish policy</button>
      </div>
      <Message msg={msg} />
    </div>
  );
}
