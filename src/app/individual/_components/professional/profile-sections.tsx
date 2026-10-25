import type { PassportCredential, PassportEmployment } from "@/lib/individual/passport";
import { EVIDENCE_LABEL } from "@/lib/individual/passport";
import { changedFields, chainsOf, evidenceState, itemState, stateDetail, stateLabel, type ItemChain, type ProfileItem } from "@/lib/individual/professional/profile-records";
import type { ContextPeriod } from "@/lib/individual/professional/profile-store";
import { WITHDRAW_REASONS, type ItemKind, type RecordState } from "@/lib/individual/professional/profile-vocabulary";
import { Empty, fmtDate } from "./bits";
import ItemForm, { ChangeItem, WithdrawItem } from "./ItemForm";
import { AddPanel } from "./forms";

// Server-rendered pieces of the Professional profile (COMPETEN-PROFESSIONAL-PROFILE-01 GO s4, s5 and s9).
//
// ⚠ EVERY RECORD SAYS WHAT IT IS, IN WORDS. Self-declared and document-supported records are amber (neither is
// verified), expired, earlier and withdrawn ones grey. Green is kept for what an organisation verified, which
// appears here only from the Passport, read-only, labelled by the Passport's own class words.

const TONE: Record<RecordState, string> = {
  self_declared: "border-amber-300 bg-amber-50 text-amber-900",
  document_supported: "border-amber-300 bg-amber-50 text-amber-900",
  expired: "border-gray-300 bg-gray-100 text-gray-800",
  superseded: "border-gray-300 bg-gray-100 text-gray-700",
  withdrawn: "border-gray-300 bg-gray-100 text-gray-700",
};

export function StateBadge({ state }: { state: RecordState }) {
  return <span title={stateDetail(state)} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11.5px] font-semibold ${TONE[state]}`}>{stateLabel(state)}</span>;
}

function meta(i: ProfileItem): string {
  const span = i.started_on || i.ended_on
    ? `${fmtDate(i.started_on) ?? "?"} – ${i.ended_on ? fmtDate(i.ended_on) : i.section === "employment" ? "present" : ""}`.replace(/ – $/, "")
    : null;
  return [i.type_label, i.organisation, i.jurisdiction, i.self_declared_identifier && `No. ${i.self_declared_identifier} (as you recorded it)`, span,
    i.expires_on && `${i.expires_on < new Date().toISOString().slice(0, 10) ? "expired" : "expires"} ${fmtDate(i.expires_on)}`,
    i.target_on && `by ${fmtDate(i.target_on)}`].filter(Boolean).join(" · ");
}

export type SectionCtx = {
  accent: string; today: string;
  typeOptions: Partial<Record<ItemKind, { code: string; label: string }[]>>;
  titleOptions: Partial<Record<ItemKind, { code: string; label: string }[]>>;
  orgSuggestions: Partial<Record<ItemKind, string[]>>;
  documentKinds: readonly ItemKind[];
};

function Chain({ chain, kind, sc }: { chain: ItemChain; kind: ItemKind; sc: SectionCtx }) {
  const i = chain.current;
  const state = itemState(i, sc.today);
  const live = !i.withdrawn_at;
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[14.5px] font-semibold text-gray-900">{i.title}</p>
          {meta(i) && <p className="text-[12.5px] text-gray-600">{meta(i)}</p>}
          {i.detail && <p className="mt-1 whitespace-pre-wrap text-[13px] text-gray-700">{i.detail}</p>}
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <StateBadge state={state} />
            {/* An expired or withdrawn record still says what evidence it had. */}
            {(state === "expired" || state === "withdrawn") && <StateBadge state={evidenceState(i)} />}
            {i.document_name && (
              <a href={`/api/individual/professional/documents?type=profile&id=${i.id}`} className="text-[12.5px] font-semibold underline-offset-2 hover:underline" style={{ color: sc.accent }}>
                {i.document_name}
              </a>
            )}
            {i.withdrawn_reason && <span className="text-[12px] text-gray-500">{WITHDRAW_REASONS.find(([k]) => k === i.withdrawn_reason)?.[1]} · {fmtDate(i.withdrawn_at)}</span>}
          </div>
        </div>
        {live && (
          <div className="flex flex-wrap items-center gap-2">
            <ChangeItem kind={kind} accent={sc.accent} typeOptions={sc.typeOptions[kind]} titleOptions={sc.titleOptions[kind]} orgSuggestions={sc.orgSuggestions[kind]}
              allowDocument={sc.documentKinds.includes(kind)} existing={i} />
            <WithdrawItem id={i.id} reasons={WITHDRAW_REASONS} />
          </div>
        )}
      </div>
      {chain.earlier.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[12.5px] font-semibold text-gray-600">Earlier versions ({chain.earlier.length})</summary>
          <ol className="mt-2 space-y-2 border-l-2 border-gray-200 pl-3">
            {[i, ...chain.earlier].slice(0, -1).map((v, n) => {
              const before = chain.earlier[n];
              return (
                <li key={before.id} className="text-[12.5px] text-gray-600">
                  <span className="font-semibold text-gray-800">{before.title}</span>{meta(before) ? ` · ${meta(before)}` : ""}
                  <span className="block">Recorded {fmtDate(before.created_at)}, replaced {fmtDate(before.superseded_at)}{changedFields(v, before).length ? ` (changed: ${changedFields(v, before).join(", ")})` : ""}.</span>
                </li>
              );
            })}
          </ol>
        </details>
      )}
    </li>
  );
}

/** One kind's records: current ones, an add form, and withdrawn ones kept below. */
export function ItemBlock({ items, kind, sc, addLabel, emptyText, unreadable }: {
  items: ProfileItem[] | null; kind: ItemKind; sc: SectionCtx; addLabel: string; emptyText: string; unreadable: boolean;
}) {
  if (unreadable) return <Empty>These records could not be read just now. Nothing has been lost.</Empty>;
  const { live, withdrawn } = chainsOf(items, kind);
  return (
    <div>
      {live.length === 0 ? <Empty>{emptyText}</Empty> : <ul className="divide-y divide-gray-100">{live.map(c => <Chain key={c.current.id} chain={c} kind={kind} sc={sc} />)}</ul>}
      <AddPanel label={addLabel} accent={sc.accent} suggestOpen={false}>
        <ItemForm kind={kind} accent={sc.accent} typeOptions={sc.typeOptions[kind]} titleOptions={sc.titleOptions[kind]} orgSuggestions={sc.orgSuggestions[kind]} allowDocument={sc.documentKinds.includes(kind)} />
      </AddPanel>
      {withdrawn.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[12.5px] font-semibold text-gray-600">Withdrawn ({withdrawn.length})</summary>
          <ul className="divide-y divide-gray-100">{withdrawn.map(c => <Chain key={c.current.id} chain={c} kind={kind} sc={sc} />)}</ul>
        </details>
      )}
    </div>
  );
}

/** What organisations issued or verified, from the Passport. Read-only, labelled by the Passport's class. */
export function OrganisationRecords({ title, rows }: { title: string; rows: { key: string; name: string; meta: string; label: string }[] | null }) {
  if (rows === null) return <p className="mt-4 text-[13px] text-gray-600">Records from organisations could not be read just now.</p>;
  if (!rows.length) return null;
  return (
    <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-4">
      <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-gray-500">{title}</p>
      <ul className="mt-2 space-y-2">
        {rows.map(r => (
          <li key={r.key} className="text-[13.5px] text-gray-800">
            <span className="font-semibold">{r.name}</span>{r.meta ? ` · ${r.meta}` : ""}
            <span className="ml-2 inline-flex rounded-full border border-gray-300 bg-white px-2 py-0.5 text-[11.5px] font-semibold text-gray-800">{r.label}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[12px] text-gray-500">From your Competen Passport, as the organisation recorded it. You cannot change these here.</p>
    </div>
  );
}

export const credentialRows = (c: PassportCredential[] | null) => c === null ? null
  : c.map((x, n) => ({ key: `c${n}`, name: x.title, meta: [x.issuingBody, x.expiryDate && `expires ${fmtDate(x.expiryDate)}`].filter(Boolean).join(" · "), label: EVIDENCE_LABEL[x.evidence] }));
export const employmentRows = (e: PassportEmployment[] | null) => e === null ? null
  : e.map((x, n) => ({ key: `e${n}`, name: x.roleTitle, meta: [x.organisation, x.startDate && `${fmtDate(x.startDate)} – ${x.endDate ? fmtDate(x.endDate) : "present"}`].filter(Boolean).join(" · "), label: "Recorded by an organisation" }));

/** Earlier professional context, from 450's history (newest first). The open period is the current one. */
export function ContextHistory({ history }: { history: ContextPeriod[] | null }) {
  if (history === null) return <p className="mt-3 text-[13px] text-gray-600">Your earlier professional context could not be read just now.</p>;
  const earlier = history.filter(h => h.effective_to);
  if (!earlier.length) return <p className="mt-3 text-[12.5px] text-gray-500">No earlier professional context yet. When you change your profession, status, specialty or registration, the earlier one is kept here.</p>;
  return (
    <details className="mt-4">
      <summary className="cursor-pointer text-[13px] font-semibold text-gray-700">Earlier professional context ({earlier.length})</summary>
      <ol className="mt-2 space-y-2 border-l-2 border-gray-200 pl-3">
        {earlier.map((h, n) => (
          <li key={n} className="text-[12.5px] text-gray-700">
            <span className="font-semibold text-gray-900">{fmtDate(h.effective_from)} – {fmtDate(h.effective_to)}</span>
            <span className="block">{[h.self_declared_profession, h.self_declared_professional_status, h.self_declared_practice_jurisdiction, h.self_declared_primary_specialty,
              h.self_declared_practice_setting, h.self_declared_current_role, h.self_declared_registration_body].filter(Boolean).join(" · ") || "Nothing recorded"}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}
