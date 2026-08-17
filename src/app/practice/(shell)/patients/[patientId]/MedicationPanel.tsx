"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  MEDICATION_STATUS_CHIP, MEDICATION_STATUS_LABEL, MEDICATION_SOURCE_LABEL,
  WEIGHT_TONE, NOT_CHECKED_TONE, NOT_CHECKED_LABEL,
} from "@/lib/practice/medication-constants";
import type { PatientMedications, MedicationRow, LegacyTreatment } from "@/lib/practice/medication";

// CPR-MED-001 -- THE MEDICATION RECORD, AS A TAB IN THE PATIENT WORKSPACE.
//
// MED s8 lists the Patient Workspace first among its integrations and the design comp draws the record
// there. This is that surface: s2's list, s6's link into each timeline, the reconciliation state, and
// LCP s9's weight verdict.
//
// ⚠ FOUR THINGS ON THIS SCREEN ARE NOT DECORATION AND MUST NOT BE TIDIED AWAY:
//
//  1. THE NINE DEFERRED CHECKS ARE PRINTED BY NAME. MED s4 asks for maximum-dose, duplicate-therapy,
//     allergy and interaction checking. None of them runs, because each needs a licensed drug knowledge
//     base this product has not bought. A screen that simply lacked a warnings panel would look like a
//     screen that found nothing wrong -- so the panel is here, it lists what was not checked, and it is
//     never collapsed to nothing. This is migration 238's allergy lesson: "NO KNOWN ALLERGIES and NOBODY
//     HAS ASKED are different answers."
//
//  2. THE ALLERGIES ARE DISPLAYED AND ARE NOT MATCHED. The sentence beside them says so. Allergy
//     substances and medication names are both free text here, and a match on spelling would miss every
//     brand name while looking exactly like a check that passed.
//
//  3. THE LEGACY TREATMENT DECISIONS ARE A SEPARATE HEADING AND ARE NOT COUNTED AS MEDICATIONS.
//     practice_treatment.duration is free text with no computable end, so those rows cannot be known to
//     have stopped. The refusal in patient-workspace-constants.ts is still true about them. Carrying one
//     across is the only act that makes it current, and it is offered rather than performed.
//
//  4. AN ABSENT STORE SAYS SO. Until the migration lands there is no medication table, and "no
//     medications recorded" would be a clinical claim this deployment cannot make.
//
// ⚠ TYPE-ONLY IMPORT FROM THE ENGINE. medication.ts imports access.ts, which imports next/headers, and a
// value import here would drag that into the browser bundle -- `next build` fails where tsc and eslint
// pass. Same rule ParameterCollection.tsx and MonitoringPlanPanel.tsx state.

const CARD = "mt-4 rounded-xl border border-gray-200 bg-white p-4";
const BTN = "rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50";
const QUIET = "rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50";

export default function MedicationPanel({ record, canRecord, canVerify }: {
  record: PatientMedications;
  canRecord: boolean;
  canVerify: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function post(action: string, payload: Record<string, unknown>, key: string) {
    setBusy(key); setError(null);
    try {
      const res = await fetch("/api/v1/practice/medications", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error?.message ?? `That did not work (${res.status}).`);
        return;
      }
      router.refresh();
    } finally { setBusy(null); }
  }

  // ⚠ NOT PERMITTED IS ITS OWN SENTENCE. Rendering nothing would make a permissions boundary look like a
  // patient who takes nothing.
  if (!record.permitted) {
    return (
      <section id="record-medications" className={`scroll-mt-4 ${CARD}`}>
        <h2 className="text-[13px] font-bold text-gray-900">Medications</h2>
        <p className="mt-2 text-[12px] text-gray-500">
          You do not have permission to see this patient&rsquo;s medication record. This is not the same as
          the record being empty.
        </p>
      </section>
    );
  }

  return (
    <section id="record-medications" className={`scroll-mt-4 ${CARD}`}>
      <div className="flex items-baseline gap-2 flex-wrap">
        <h2 className="text-[13px] font-bold text-gray-900">Medications</h2>
        <span className="text-[11px] text-gray-500">
          {record.storeState === "present"
            ? `${record.active.length} in use · ${record.past.length} past · ${record.legacy.unavailable ? "?" : record.legacy.items.length} not carried across`
            : "record unavailable"}
        </span>
        <Link href="/practice/medications" className="ml-auto text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
          Practice medication worklist &rarr;
        </Link>
      </div>

      {/* ⚠ ABSENT IS NOT EMPTY. */}
      {record.storeState === "absent" && (
        <p className="mt-2 rounded-lg bg-[var(--cmp-surface-warning)] px-3 py-2 text-[12px] text-[var(--cmp-text-warning)]">
          {record.storeNotice}
        </p>
      )}
      {record.unavailable && (
        <p className="mt-2 rounded-lg bg-[var(--cmp-surface-critical)] px-3 py-2 text-[12px] text-[var(--cmp-text-critical)]">
          {record.detail} This is <strong>not</strong> the same as this patient taking nothing.
        </p>
      )}
      {error && (
        <p className="mt-2 rounded-lg bg-[var(--cmp-surface-critical)] px-3 py-2 text-[12px] text-[var(--cmp-text-critical)]">{error}</p>
      )}

      {/* ── RECONCILIATION. The verdict, not a tick. ─────────────────────────────────────────────── */}
      <p className={`mt-3 rounded-lg px-3 py-2 text-[12px] ${record.reconciliation.reassuring
        ? "bg-emerald-50 text-emerald-800" : "border border-dashed border-slate-300 bg-white text-slate-600"}`}>
        <span className="font-semibold">Reconciliation: </span>{record.reconciliation.text}
      </p>

      {/* ── LCP s9's WEIGHT VERDICT, because every weight-based dose depends on it. ──────────────── */}
      <div className="mt-2 flex items-start gap-2">
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${WEIGHT_TONE[record.weight.state]?.chip ?? NOT_CHECKED_TONE}`}>
          {WEIGHT_TONE[record.weight.state]?.mark ?? "–"} {WEIGHT_TONE[record.weight.state]?.label ?? NOT_CHECKED_LABEL}
        </span>
        <span className="text-[11px] text-gray-600">{record.weight.text}</span>
      </div>

      {/* ── IN USE ──────────────────────────────────────────────────────────────────────────────── */}
      <h3 className="mt-4 text-[12px] font-bold text-gray-900">In use now</h3>
      {record.active.length === 0 ? (
        <p className="mt-1 text-[12px] text-gray-400">
          {record.storeState === "present"
            ? "Nothing recorded as being taken. Nobody may have been asked — this is a record of what was entered here."
            : "Cannot be read."}
        </p>
      ) : (
        <ul className="mt-1 flex flex-col">
          {record.active.map(m => <Row key={m.id} m={m} canVerify={canVerify} busy={busy} onVerify={() => post("verify", { medicationId: m.id }, m.id)} />)}
        </ul>
      )}

      {/* ── PAST ────────────────────────────────────────────────────────────────────────────────── */}
      {record.past.length > 0 && (
        <>
          <h3 className="mt-4 text-[12px] font-bold text-gray-900">Past medications</h3>
          <ul className="mt-1 flex flex-col">
            {record.past.map(m => <Row key={m.id} m={m} canVerify={canVerify} busy={busy} onVerify={() => post("verify", { medicationId: m.id }, m.id)} />)}
          </ul>
        </>
      )}

      <p className="mt-2 text-[10px] text-gray-500">{record.boundary}</p>

      {/* ── LEGACY TREATMENT DECISIONS. Their own heading, deliberately. ─────────────────────────── */}
      {record.legacy.unavailable ? (
        <p className="mt-3 rounded-lg bg-[var(--cmp-surface-critical)] px-3 py-2 text-[12px] text-[var(--cmp-text-critical)]">
          {record.legacy.detail}
        </p>
      ) : record.legacy.items.length > 0 && (
        <div className="mt-4 rounded-lg border border-dashed border-gray-300 p-3">
          <h3 className="text-[12px] font-bold text-gray-900">
            Decided in a consultation, not carried into this record ({record.legacy.items.length})
          </h3>
          <ul className="mt-1 flex flex-col">
            {record.legacy.items.map((t: LegacyTreatment) => (
              <li key={t.id} className="flex items-baseline gap-2 border-b border-gray-100 py-1.5 last:border-0">
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-semibold text-gray-800">{t.label}</span>
                  <span className="block text-[10px] text-gray-500">
                    {[t.dose, t.route, t.frequency, t.duration].filter(Boolean).join(" · ") || "no dose recorded"}
                    {t.decidedAt ? ` · decided ${String(t.decidedAt).slice(0, 10)}` : ""}
                  </span>
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-2">
                  <Link href={`/practice/encounters/${t.encounterId}`} className="text-[10px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
                    Consultation
                  </Link>
                  {canRecord && (
                    <button className={QUIET} disabled={busy === t.id}
                      onClick={() => post("carryForward", { treatmentId: t.id }, t.id)}>
                      {busy === t.id ? "Carrying…" : "Carry across"}
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] text-gray-500">{record.legacyReason}</p>
        </div>
      )}

      {/* ── ALLERGIES: DISPLAYED, NEVER MATCHED. ─────────────────────────────────────────────────── */}
      <div className="mt-4 rounded-lg bg-gray-50 p-3">
        <h3 className="text-[12px] font-bold text-gray-900">Recorded allergies</h3>
        {record.allergies.unavailable ? (
          <p className="mt-1 text-[12px] text-[var(--cmp-text-critical)]">{record.allergies.detail}</p>
        ) : record.allergies.items.length === 0 ? (
          <p className="mt-1 text-[12px] text-gray-500">
            None are listed on this record. That is not the same as none existing &mdash; check whether anyone
            has asked.
          </p>
        ) : (
          <ul className="mt-1 flex flex-col gap-0.5">
            {record.allergies.items.map(a => (
              <li key={a.id} className="text-[12px] text-gray-800">
                <span className="font-semibold">{a.substance}</span>
                {a.severity && <span className="text-gray-500"> · {a.severity}</span>}
                {a.reaction && <span className="text-gray-500"> · {a.reaction}</span>}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[10px] text-gray-500">{record.allergyNotice}</p>
      </div>

      {/* ── ⚠ THE EIGHT CHECKS THAT DID NOT RUN. NEVER OMITTED, NEVER COLLAPSED TO SILENCE. ──────── */}
      <NotCheckedPanel checks={record.notChecked} />
    </section>
  );
}

function Row({ m, canVerify, busy, onVerify }: {
  m: MedicationRow; canVerify: boolean; busy: string | null; onVerify: () => void;
}) {
  return (
    <li className="flex items-baseline gap-2 border-b border-gray-100 py-1.5 last:border-0">
      <span className="min-w-0">
        <Link href={`/practice/medications?medicationId=${m.id}`} className="block truncate text-[12px] font-semibold text-gray-800 hover:underline">
          {m.genericName}{m.brandName ? ` (${m.brandName})` : ""}
        </Link>
        <span className="block text-[10px] text-gray-500">
          {[m.doseText, m.route, m.frequency, m.durationText].filter(Boolean).join(" · ")}
          {m.indication ? ` · for ${m.indication}` : ""}
        </span>
        <span className="block text-[10px] text-gray-500">{m.current.text}</span>
        {/* ⚠ UNVERIFIED IS SHOWN, ALWAYS. LCP s9. */}
        {m.verification.state === "unverified" && (
          <span className="mt-0.5 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
            {m.verification.text}
          </span>
        )}
        {m.review.state === "overdue" && (
          <span className="mt-0.5 ml-1 inline-block rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-800">
            {m.review.text}
          </span>
        )}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${MEDICATION_STATUS_CHIP[m.status] ?? "bg-slate-100 text-slate-600"}`}>
          {MEDICATION_STATUS_LABEL[m.status] ?? m.status}
        </span>
        <span className="text-[10px] text-gray-400">{MEDICATION_SOURCE_LABEL[m.source] ?? m.source}</span>
        {canVerify && m.verification.state === "unverified" && (
          <button className={BTN} disabled={busy === m.id} onClick={onVerify}>
            {busy === m.id ? "Saving…" : "Confirm"}
          </button>
        )}
      </span>
    </li>
  );
}

/**
 * ⚠ THE PANEL THAT EXISTS SO THE SCREEN CANNOT BE READ AS CLEARED.
 *
 * Shared by the patient tab, the encounter prescribing console and the practice worklist, so the three
 * cannot drift into saying different things about the same absence.
 */
export function NotCheckedPanel({ checks }: { checks: readonly { key: string; label: string; detail: string; wouldRequire: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4 rounded-lg border border-dashed border-slate-300 p-3">
      <div className="flex items-baseline gap-2 flex-wrap">
        <h3 className="text-[12px] font-bold text-slate-700">
          {checks.length} medication safety checks are <span className="underline decoration-dotted">not performed</span>
        </h3>
        <button className="ml-auto text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline"
          onClick={() => setOpen(o => !o)}>
          {open ? "Hide the reasons" : "Why, for each"}
        </button>
      </div>
      {/* ⚠ THIS PARAGRAPH IS A REFUSAL AND MUST READ AS ONE. "Not checked" softened into "no findings" is
          exactly the failure it exists to prevent, so it says what was DECLINED and why, in the words the
          decision was made in. */}
      <p className="mt-1 text-[11px] text-slate-600">
        This record has no drug knowledge base, and the rule tables that would hold one were{" "}
        <strong>proposed and declined</strong> rather than shipped empty &mdash; because an empty rule
        table makes every check return nothing to say, <strong>which a clinician reads as safe</strong>.
        Nothing below was checked. The absence of a warning on this screen carries{" "}
        <strong>no information about safety</strong>. Check against your own reference.
      </p>
      <ul className="mt-2 flex flex-wrap gap-1">
        {checks.map(c => (
          <li key={c.key} className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${NOT_CHECKED_TONE}`}>
            {c.label}: {NOT_CHECKED_LABEL}
          </li>
        ))}
      </ul>
      {open && (
        <ul className="mt-2 flex flex-col gap-2">
          {checks.map(c => (
            <li key={c.key} className="border-l-2 border-slate-200 pl-2">
              <span className="block text-[11px] font-semibold text-slate-700">{c.label}</span>
              <span className="block text-[10px] text-slate-600">{c.detail}</span>
              <span className="block text-[10px] text-slate-500">Would require: {c.wouldRequire}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
