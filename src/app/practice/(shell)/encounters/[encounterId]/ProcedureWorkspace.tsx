"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  PANEL, SectionHeader, Badge, Tip, EmptyState,
} from "@/components/practice/EncounterKit";
import {
  ClinicalRecordTable, type RecordColumn, type RowState,
} from "@/components/practice/ClinicalRecordTable";
import {
  BAND_RECORD, BAND_SHORTCUTS, BAND_WORK,
} from "@/lib/practice/encounter-band-constants";
// ⚠ FROM THE CONSTANTS FILE, NEVER FROM procedures.ts. That module reaches access.ts and next/headers,
// and one string imported from it into a "use client" component drags the whole server module into the
// browser bundle -- which tsc and eslint both wave through and only `next build` catches. It has
// happened three times in this codebase; procedure-constants.ts exists precisely so it cannot here.
import {
  LATERALITIES, CONSENT_STATUSES, PROCEDURE_STATUSES, PROCEDURE_STATUSES_NEEDING_REASON,
  PROCEDURE_STATUSES_NOT_DONE, procedureBand,
  OUTCOME_TYPES, OUTCOME_SEVERITIES, SEVERITY_REQUIRED_FOR,
  procedureFieldPlan, procedureReadiness, type ProcedureTypeShape,
} from "@/lib/practice/procedure-constants";

// ⚠ THE ENGINE'S OWN LIST, WIDENED TO string SO THE SCREEN CANNOT HOLD A SECOND OPINION. If this were
// retyped here, the day somebody added a status needing a reason the engine would refuse the batch and
// the field asking for that reason would never be drawn.
const NEEDS_REASON: readonly string[] = PROCEDURE_STATUSES_NEEDING_REASON;

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CPR-PROC-HFE-005: select the clinical object first, then reveal only the fields that matter for it.
//
// ⚠ THE BUG THIS FIXES IS NOT A LAYOUT BUG. page.tsx has always loaded the procedure catalogue and
// passed it down; EncounterConsole declared the prop and used it nowhere; this screen was a free-text
// box that never sent `procedure_type_id`. So `type` was ALWAYS NULL inside recordProcedure, and its two
// safety rules -- a SIDED procedure cannot be recorded without a side, a CONSENT_REQUIRED procedure
// cannot be recorded as "not recorded" -- could never fire from the encounter workspace. A practice
// could mark Joint injection sided and consent-required and this screen would record it with neither.
//
// s7's four steps, which are now the actual shape of the screen:
//   1  search the catalogue, or take a shortcut          -> nothing is recorded
//   2  the procedure joins the working set               -> as its own item
//   3  only the fields that apply to IT are drawn        -> s3, s8, s9, s10
//   4  what is still missing is named on the item        -> s12's readiness
//   5  the practitioner records the ready set explicitly -> s13's batch
//
// ⚠ THE CLIENT'S READINESS RULES ARE A MIRROR, NOT A SECOND RULEBOOK. procedureReadiness() copies checks
// that already exist in procedures.ts and invents none. The server still refuses, by name, per item --
// see procedure-constants.ts for why the two directions of disagreement are not equally survivable.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

type Item = {
  key: string;
  /** Null for a free-text procedure: the practitioner named something not in the catalogue. */
  procedureTypeId: string | null;
  label: string;
  site: string;
  laterality: string;
  consentStatus: string;
  status: string;
  indication: string;
  immediateOutcome: string;
  abandonedReason: string;
  /** s8's answers to the catalogue-declared fields, keyed by field key. */
  details: Record<string, string>;
  /** CPR-TRT-PROC-003 s10. Only meaningful while the status is SCHEDULED, and required by the engine then. */
  scheduledAt: string;
  /** s12: the item's own optional detail, open only when the practitioner opens it. */
  open: boolean;
  outcome?: { ok: boolean; message?: string };
};

type Recorded = {
  id: string; label: string; site?: string | null; laterality?: string | null;
  status?: string | null; immediate_outcome?: string | null;
};

/**
 * ⚠ THE CATALOGUE ROW IS PASSED THROUGH WHOLE AND HANDED TO procedureFieldPlan, NOT PICKED APART HERE.
 * Migration 297 took the definition from two booleans to nine columns, and a component that copied out
 * the fields it happened to need would be a second, quieter opinion about what a procedure requires --
 * silently dropping any rule added after it was written.
 */
type CatalogueType = {
  id: string; name: string; category?: string | null;
  sided?: boolean; consent_required?: boolean;
  site_rule?: string | null; laterality_rule?: string | null; consent_rule?: string | null;
  allowed_lateralities?: string[] | null; allowed_statuses?: string[] | null;
  default_status?: string | null; outcome_required?: boolean; detail_fields?: unknown;
};

type Frequent = {
  procedureTypeId: string | null; label: string; timesRecorded: number; favourite?: boolean;
};

// CP-UI-TABLE-001 s5 + CPR-PROC-HFE-005 s5: Procedure | Status | Time | Site | Actions.
const PROCEDURE_COLUMNS: RecordColumn<Recorded>[] = [
  { key: "label", label: "Procedure", priority: "primary",
    render: p => {
      const band = procedureBand(p.status ?? "");
      return (
        <>
          <span className={band.struck ? "font-semibold text-gray-500 line-through" : "font-semibold text-gray-800"}>
            {p.label}
          </span>
          {p.laterality && p.laterality !== "not_applicable" && (
            <span className="ml-1.5"><Badge tone="neutral">{p.laterality}</Badge></span>
          )}
        </>
      );
    } },
  // ⚠ EVERY STATUS IS NAMED, INCLUDING PERFORMED. Before the lifecycle existed this column drew a badge
  // only when something was NOT performed, so the absence of a badge was the only thing separating a
  // completed procedure from one nobody had done. In a column that is a blank cell.
  { key: "status", label: "Status", priority: "status",
    render: p => p.status === "PERFORMED"
      ? <span className="text-[11.5px] text-gray-600">performed</span>
      : (
        <Badge tone={p.status === "ATTEMPTED" || p.status === "ABANDONED" ? "needs" : "muted"}>
          {(PROCEDURE_STATUSES.find(([k]) => k === p.status)?.[1] ?? p.status ?? "unknown").toLowerCase()}
        </Badge>
      ) },
  { key: "site", label: "Site", priority: "secondary",
    render: p => p.site ? <span className="text-[11.5px] text-gray-600">{p.site}</span>
      : <span className="text-gray-500">&mdash;</span> },
  { key: "outcome", label: "Immediate outcome", priority: "secondary",
    render: p => p.immediate_outcome
      ? <span className="text-[11.5px] text-gray-600">{p.immediate_outcome}</span>
      : <span className="text-gray-500">&mdash;</span> },
];

let seq = 0;

/**
 * ⚠ PERFORMED IS THE DEFAULT AND s11 PERMITS IT: "if the current workflow is specifically recording
 * performed procedures, Performed may be the QUIET default." It is not a preselected claim hiding in a
 * dropdown any more -- every working item prints the word, and the other five statuses are one click
 * away on the item itself rather than behind a scroll.
 */
const newItem = (seed: Partial<Item> = {}): Item => ({
  key: `p${++seq}`, procedureTypeId: null, label: "", site: "", laterality: "not_applicable",
  consentStatus: "not_recorded", status: "PERFORMED",
  indication: "", immediateOutcome: "", abandonedReason: "", scheduledAt: "", details: {}, open: false,
  ...seed,
});

// CPR-MOB-001 s10/s16 — every field on the procedure card wears this one string, so the 44px floor and
// the 16px iOS anti-zoom size are bought here once for Side, Consent, Indication, Reason, Immediate
// outcome, Site and Scheduled-for. `max-md:` only: the desktop card is unchanged, and the htmlFor ids
// that tie each label to its control (and that the harness pins) are untouched by a class edit.
const input =
  "w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12.5px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10 max-md:min-h-[var(--cp-touch)] max-md:text-[16px]";
const FIELD_LABEL = "text-[10.5px] font-semibold uppercase tracking-wide text-gray-500";

export default function ProcedureWorkspace(props: {
  encounterId: string;
  recorded: Recorded[];
  editable: boolean;
  canRecord: boolean;
  /** s7 step 1. The catalogue this screen never used to read. */
  catalogue: CatalogueType[];
  /** s6's shortcuts, derived from what this practice has recorded. */
  frequent: { items: Frequent[]; permitted: boolean; unavailable: boolean; detail: string | null };
}) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [query, setQuery] = useState("");

  const byId = useMemo(() => {
    const m = new Map<string, CatalogueType>();
    for (const t of props.catalogue ?? []) m.set(t.id, t);
    return m;
  }, [props.catalogue]);

  // ⚠ THE WHOLE ROW, NOT A COPY OF THE FIELDS I HAPPEN TO NEED. See CatalogueType.
  const shapeOf = (it: Item): ProcedureTypeShape =>
    (it.procedureTypeId ? byId.get(it.procedureTypeId) : undefined) ?? null;

  // s7 step 1. Substring on the name, because a practitioner types what they call it rather than a code.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return (props.catalogue ?? []).filter(t => t.name.toLowerCase().includes(q)).slice(0, 8);
  }, [query, props.catalogue]);

  // ⚠ ADDING NEVER RECORDS (s6, s21). A shortcut and a search result both do exactly this: put the
  // procedure in the working set and stop. "Do not auto-record a procedure merely because a shortcut
  // was selected" is the rule, and the reason is that a shortcut is a typing convenience -- treating
  // one click as a clinical assertion would put procedures on records nobody performed.
  const addFromCatalogue = (t: CatalogueType) => {
    // ⚠ s11's QUIET DEFAULT, AND IT IS A SEED RATHER THAN A LOCK. The catalogue's default_status only
    // decides what the item OPENS as; every allowed status is still one click away on the item, and the
    // engine applies the same default only when the caller sent nothing. A default that overrode a
    // choice would be the PERFORMED coercion this engine already carries a warning about.
    setItems(p => [...p, newItem({
      procedureTypeId: t.id, label: t.name, open: true,
      status: t.default_status ?? "PERFORMED",
    })]);
    setQuery("");
    setNotice(null);
  };
  const addFreeText = (label: string) => {
    setItems(p => [...p, newItem({ label: label.trim(), open: true })]);
    setQuery("");
    setNotice(null);
  };
  const addShortcut = (f: Frequent) => {
    const t = f.procedureTypeId ? byId.get(f.procedureTypeId) : undefined;
    if (t) addFromCatalogue(t); else addFreeText(f.label);
  };

  // ⚠ OUTCOME RECORDING, CARRIED OVER RATHER THAN LOST. The tab this workspace replaces held TWO
  // writers: the procedure form, and this. Recording an outcome against an ALREADY-RECORDED procedure is
  // what lets somebody walk from "this wound got infected" back to the day it was made, and the first
  // attempt at an earlier rewrite deleted it silently -- it survived only because eslint reported an
  // orphaned function. It hangs off the row it concerns rather than sitting in a separate form.
  //
  // ⚠ THE OBSERVING ENCOUNTER IS THIS ONE, which is the whole point: the outcome is attributed to the
  // consultation that noticed it, not to the one that performed the procedure.
  const [outcomeFor, setOutcomeFor] = useState<string | null>(null);
  const [outcome, setOutcome] = useState({ outcomeType: "healing", severity: "mild", detail: "" });

  const saveOutcome = async (procedureId: string) => {
    setBusy(true); setNotice(null);
    try {
      const res = await fetch(`/api/v1/practice/procedures/${procedureId}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          observedAtEncounterId: props.encounterId,
          outcomeType: outcome.outcomeType,
          // ⚠ SEVERITY BELONGS TO A COMPLICATION AND TO NOTHING ELSE, and the engine enforces BOTH
          // directions -- so sending it on a "healing" outcome is refused rather than ignored.
          severity: SEVERITY_REQUIRED_FOR.includes(outcome.outcomeType) ? outcome.severity : undefined,
          detail: outcome.detail || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ kind: "err", text: json?.error?.message ?? "That outcome was not recorded." });
        return;
      }
      setNotice({ kind: "ok", text: "Outcome recorded against this procedure." });
      setOutcomeFor(null);
      setOutcome({ outcomeType: "healing", severity: "mild", detail: "" });
      router.refresh();
    } catch {
      setNotice({ kind: "err", text: "That did not reach the server, so no outcome was recorded." });
    } finally { setBusy(false); }
  };

  const pending = items.filter(i => !i.outcome?.ok);
  const readiness = pending.map(i => procedureReadiness(i, shapeOf(i)));
  const blocked = readiness.filter(r => !r.ready).length;
  const set = (key: string, patch: Partial<Item>) =>
    setItems(p => p.map(i => (i.key === key ? { ...i, ...patch } : i)));

  const commit = async () => {
    const chosen = items.map((it, i) => ({ it, i })).filter(({ it }) => !it.outcome?.ok);
    if (!chosen.length) return;
    setBusy(true); setNotice(null);
    try {
      const res = await fetch("/api/v1/practice/procedures/batch", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          encounterId: props.encounterId,
          items: chosen.map(({ it }) => {
            const plan = procedureFieldPlan(shapeOf(it));
            return {
              // ⚠ THE CATALOGUE ID, WHICH THIS SCREEN NEVER SENT. Without it the server's `sided` and
              // `consent_required` checks read a null type and pass everything.
              procedureTypeId: it.procedureTypeId ?? undefined,
              label: it.label.trim(), site: it.site.trim() || undefined,
              // ⚠ A HIDDEN SIDE FIELD SENDS not_applicable, WHICH IS WHAT THE CATALOGUE SAID. It is only
              // hidden because the procedure has no sides, and the engine refuses that value on a sided
              // type -- so a mis-hidden field is refused rather than silently recorded.
              laterality: plan.side === "hidden" ? "not_applicable" : it.laterality,
              consentStatus: it.consentStatus, status: it.status,
              indication: it.indication.trim() || undefined,
              immediateOutcome: it.immediateOutcome.trim() || undefined,
              // ⚠ ONLY WHERE THE STATUS ASKS FOR IT. Sending a reason on a completed procedure would
              // record why something was stopped that was not stopped. The test is the engine's list
              // rather than one hard-coded status, so the two cannot disagree about which need one.
              abandonedReason: NEEDS_REASON.includes(it.status)
                ? (it.abandonedReason.trim() || undefined) : undefined,
              // Likewise: a scheduled time is meaningless on anything but SCHEDULED, and required there.
              scheduledAt: it.status === "SCHEDULED" ? (it.scheduledAt || undefined) : undefined,
              // ⚠ s8's ANSWERS, SENT ONLY FOR A GOVERNED ITEM. A free-text procedure declares no fields,
              // so anything sitting in `details` from a type the practitioner switched away from must
              // not travel -- the engine drops undeclared keys anyway, and sending them would make the
              // request say something the screen never asked.
              details: plan.detailFields.length > 0 ? it.details : undefined,
            };
          }),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok && !Array.isArray(json?.results)) {
        setNotice({ kind: "err", text: json?.error?.message ?? "Nothing was recorded." });
        return;
      }
      // ⚠ MAPPED BY POSITION IN THE SUBMITTED LIST, not by item index. The two diverge the moment an
      // item is skipped, and mismatching them would attach one procedure's refusal to another's card.
      const results = (json.results ?? []) as { index: number; ok: boolean; message?: string }[];
      // ⚠ A RECORDED ITEM LEAVES THE WORKING SET, the same fix the Diagnoses tab needed after the owner
      // found a recorded entry showing twice -- once in the list above, once as a dead locked row below.
      // s22: "recorded procedures are visually distinct from the uncommitted working set."
      setItems(prev => {
        const next = [...prev];
        for (const out of results) {
          const target = chosen[out.index];
          if (target) next[target.i] = { ...next[target.i], outcome: { ok: out.ok, message: out.message }, open: !out.ok };
        }
        return next.filter(i => !i.outcome?.ok);
      });
      const okCount = results.filter(r => r.ok).length;
      const bad = results.length - okCount;
      setNotice({
        kind: bad ? "err" : "ok",
        text: bad
          ? `${okCount} recorded, ${bad} not. Each item below says why -- nothing was dropped silently.`
          : `${okCount} ${okCount === 1 ? "procedure" : "procedures"} recorded.`,
      });
      router.refresh();
    } catch {
      setNotice({ kind: "err", text: "That did not reach the server, so nothing was recorded." });
    } finally { setBusy(false); }
  };

  return (
    <section className={PANEL}>
      <SectionHeader
        title="Procedures"
        subtitle="Choose a procedure, fill in what it needs, then record the set together."
      />

      <div className="p-4">
        {/* ══ BAND 1 (s4, s16): THE RECORD ═══════════════════════════════════════════════════════════
            ⚠ THE OUTCOME FORM IS CP-UI-TABLE-001 s3.1's EXPANDABLE DETAIL, attached to the procedure it
            concerns. It used to be a second row hand-built here; the standard owns that shape now. */}
        <div className={`${BAND_RECORD} overflow-hidden`}>
          <ClinicalRecordTable
            label="Procedures recorded for this patient"
            columns={PROCEDURE_COLUMNS}
            empty={<EmptyState title="No procedure recorded for this encounter"
              reason="This was read successfully -- add one below if something was done." />}
            records={props.recorded.map(p => ({
              id: p.id,
              data: p,
              // ⚠ s4 RESERVES `warning` FOR CLINICALLY ACTIONABLE ISSUES. A cancelled or declined
              // procedure is a fact rather than a problem, so it reads as `stopped`, not as an alarm.
              state: (p.status && ["CANCELLED", "DECLINED"].includes(p.status) ? "stopped" : "normal") as RowState,
              stateLabel: p.status && p.status !== "PERFORMED" ? `${p.status.toLowerCase()} procedure` : undefined,
              actions: props.editable && props.canRecord ? (
                <button type="button" disabled={busy}
                  onClick={() => setOutcomeFor(outcomeFor === p.id ? null : p.id)}
                  aria-label={`Record an outcome for ${p.label}`}
                  className="rounded-lg border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                  {outcomeFor === p.id ? "Cancel" : "Record outcome"}
                </button>
              ) : undefined,
              expandedContent: outcomeFor === p.id ? (
                <form className="flex w-full flex-wrap items-end gap-2 rounded-lg bg-gray-50 p-2"
                  onSubmit={e => { e.preventDefault(); saveOutcome(p.id); }}>
                  <select value={outcome.outcomeType} disabled={busy} aria-label="Outcome"
                    onChange={e => setOutcome(o => ({ ...o, outcomeType: e.target.value }))}
                    className="rounded-lg border border-gray-200 px-2 py-1 text-[12px]">
                    {OUTCOME_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                  {/* s14: selecting a complication reveals the detail a complication needs. */}
                  {SEVERITY_REQUIRED_FOR.includes(outcome.outcomeType) && (
                    <select value={outcome.severity} disabled={busy} aria-label="Severity"
                      onChange={e => setOutcome(o => ({ ...o, severity: e.target.value }))}
                      className="rounded-lg border border-gray-200 px-2 py-1 text-[12px]">
                      {OUTCOME_SEVERITIES.map(sv => <option key={sv} value={sv}>{sv}</option>)}
                    </select>
                  )}
                  <input value={outcome.detail} disabled={busy} placeholder="What happened (optional)"
                    aria-label={`Outcome detail for ${p.label}`}
                    onChange={e => setOutcome(o => ({ ...o, detail: e.target.value }))}
                    className="min-w-[200px] flex-1 rounded-lg border border-gray-200 px-2 py-1 text-[12px]" />
                  <button type="submit" disabled={busy}
                    className="rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50">
                    Record outcome
                  </button>
                </form>
              ) : undefined,
            }))}
          />
        </div>

        {props.editable && props.canRecord && (
          <>
            {/* ══ BAND 3 (s4, s6, s16): SHORTCUTS ════════════════════════════════════════════════════
                Deliberately subordinate. It sits between the record and the work and competes with
                neither -- s4 calls it "low-contrast", s16 "subtle neutral/blue-grey". */}
            {(props.frequent.items.length > 0 || props.frequent.unavailable) && (
              <div className={`${BAND_SHORTCUTS} mt-3 p-3.5`}>
                <h3 className="text-[12.5px] font-bold text-gray-800">Frequently used procedures</h3>
                {props.frequent.unavailable ? (
                  // ⚠ THREE STATES, NEVER TWO. A failed read is not an empty list, and printing one as
                  // the other would tell this practice it has never performed a procedure.
                  <p className="mt-1.5 text-[11.5px] text-[var(--cmp-text-critical)]">
                    These could not be read, so this is not a statement that there are none.
                  </p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {props.frequent.items.map(f => (
                      <button key={`${f.procedureTypeId ?? "free"}:${f.label}`} type="button" disabled={busy}
                        onClick={() => addShortcut(f)}
                        className="rounded-full border border-gray-300 bg-white px-2.5 py-1 text-[11.5px] font-semibold text-gray-700 hover:border-[var(--cp-primary)]/50 hover:bg-[var(--cp-primary)]/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-primary)] focus-visible:ring-offset-1 disabled:opacity-50">
                        {f.label}
                        <span className="ml-1 font-normal text-gray-500">{f.timesRecorded}x</span>
                      </button>
                    ))}
                  </div>
                )}
                {/* ⚠ s6: "shortcuts are workflow conveniences, NOT PATIENT-SPECIFIC RECOMMENDATIONS."
                    The same sentence the treatment shortcuts carry, for the same reason: a list of
                    frequent items beside a patient's record reads as advice unless it says otherwise. */}
                <p className="mt-2 text-[11px] text-gray-500">
                  What this practice records most. A shortcut adds the procedure below &mdash; it records
                  nothing, and Competen is not suggesting any of these for this patient.
                </p>
              </div>
            )}

            {/* ══ BAND 4 (s4, s16): THE ACTIVE WORK ══════════════════════════════════════════════════
                s12: "the Procedures to record area is the primary locus of interaction", and s3 gives
                the active task the strongest boundary on the page. */}
            <div className={`${BAND_WORK} mt-3 p-4`}>
              <h3 className="text-[13px] font-bold text-gray-900">Add procedures</h3>

              {/* s7 step 1, and s22's first acceptance criterion: the screen no longer BEGINS with a
                  universal empty row containing every possible field. It begins with a question. */}
              <div className="mt-2">
                <label className={FIELD_LABEL} htmlFor="procedure-search">Search the procedure catalogue</label>
                <input id="procedure-search" value={query} disabled={busy} autoComplete="off"
                  placeholder="Start typing a procedure name..."
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    if (matches.length === 1) addFromCatalogue(matches[0]);
                    else if (query.trim()) addFreeText(query);
                  }}
                  className={`${input} mt-1`} />
                {query.trim() && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {matches.map(t => (
                      <button key={t.id} type="button" disabled={busy} onClick={() => addFromCatalogue(t)}
                        className="rounded-lg border border-[var(--cp-primary)]/40 bg-white px-2.5 py-1 text-[11.5px] font-semibold text-[var(--cp-primary-deep)] hover:bg-[var(--cp-primary)]/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-primary)] disabled:opacity-50">
                        + {t.name}
                        {/* s13: the applicability is named in words on the chip, so a practitioner knows
                            BEFORE adding it why one procedure will ask for a side and another will not. */}
                        {t.sided && <span className="ml-1 font-normal text-gray-500">sided</span>}
                        {t.consent_required && <span className="ml-1 font-normal text-gray-500">consent</span>}
                      </button>
                    ))}
                    {/* ⚠ FREE TEXT SURVIVES, AND IT HAS TO. The catalogue is not complete and a
                        consultation cannot wait for it to be. What a free-text item loses is the
                        catalogue's field rules -- so it shows every field and demands none, rather than
                        pretending to know that the procedure has no sides. */}
                    <button type="button" disabled={busy} onClick={() => addFreeText(query)}
                      className="rounded-lg border border-dashed border-gray-300 px-2.5 py-1 text-[11.5px] font-semibold text-gray-600 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-primary)] disabled:opacity-50">
                      + &ldquo;{query.trim()}&rdquo; as typed
                    </button>
                  </div>
                )}
              </div>

              {/* ── s12's WORKING SET ──────────────────────────────────────────────────────────────── */}
              <div className="mt-3.5">
                <h4 className="text-[12px] font-bold text-gray-800">
                  Procedures to record{pending.length > 0 ? ` (${pending.length})` : ""}
                </h4>

                {pending.length === 0 ? (
                  <p className="mt-1.5 text-[12px] text-gray-600">
                    Nothing selected yet. Search above, or use a shortcut &mdash; then fill in what the
                    procedure asks for.
                  </p>
                ) : (
                  <ul className="mt-2 flex flex-col gap-2">
                    {pending.map((it, n) => {
                      const shape = shapeOf(it);
                      const plan = procedureFieldPlan(shape);
                      const ready = readiness[n];
                      const named = it.label || `item ${n + 1}`;
                      // s14, mirroring the engine: required only where the procedure actually happened.
                      const outcomeDemanded = plan.outcomeRequired
                        && !(PROCEDURE_STATUSES_NOT_DONE as readonly string[]).includes(it.status);
                      return (
                        <li key={it.key} className="rounded-xl border border-slate-200 bg-white p-3">
                          {/* ⚠ THE READINESS INDICATOR KEEPS ONE LOCATION ACROSS EVERY ITEM (s21), and
                              REMOVE IS KEPT AWAY FROM DETAILS (s21: "keep Remove, Details and Record
                              actions spatially distinct"). */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-[13px] font-semibold text-gray-900">{it.label}</p>
                              <p className="text-[11px] text-gray-500">
                                {PROCEDURE_STATUSES.find(([k]) => k === it.status)?.[1] ?? it.status}
                                {plan.governed ? "" : " · not in the catalogue"}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              {/* s16: "Ready -- green icon/text indicator; do not flood-fill the entire
                                  item." "Needs attention -- amber icon/count." Both carry a WORD, because
                                  s16 and CPR-HFE-TRT-004 s13 forbid colour as the only carrier. */}
                              {ready.ready ? (
                                <span className="rounded-full border border-emerald-200 bg-[var(--cmp-surface-success)] px-2 py-0.5 text-[11px] font-semibold text-[var(--cmp-text-success)]">
                                  &#10003; Ready
                                </span>
                              ) : (
                                <span className="rounded-full border border-amber-300 bg-[var(--cmp-surface-warning)] px-2 py-0.5 text-[11px] font-semibold text-[var(--cmp-text-warning)]">
                                  &#9888; {ready.missing.length} required
                                </span>
                              )}
                              <button type="button" disabled={busy} onClick={() => set(it.key, { open: !it.open })}
                                aria-expanded={it.open}
                                className="rounded-lg border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                                {it.open ? "Hide" : "Details"}
                              </button>
                            </div>
                          </div>

                          {/* ⚠ WHAT IS MISSING IS NAMED, NOT COUNTED ONLY (s12, s21). A badge saying
                              "2 required" over a collapsed item is a puzzle; the words are what let a
                              practitioner fix it without opening anything. */}
                          {!ready.ready && (
                            <p className="mt-1.5 text-[11.5px] text-[var(--cmp-text-warning)]">
                              Needs {ready.missing.join(", ")}.
                            </p>
                          )}
                          {it.outcome && !it.outcome.ok && (
                            <p className="mt-1.5 text-[11.5px] font-semibold text-[var(--cmp-text-critical)]">
                              {it.outcome.message}
                            </p>
                          )}

                          {it.open && (
                            <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
                              {/* ⚠ SIDE IS DRAWN ONLY WHERE IT MEANS SOMETHING (s9, s22). A catalogue
                                  entry with sided:false is the practice saying the procedure has no
                                  sides, so EEG and endotracheal intubation do not offer one. A free-text
                                  item is NOT such a statement, so it keeps the field. */}
                              {plan.side !== "hidden" && (
                                <div>
                                  <label className={FIELD_LABEL} htmlFor={`side-${it.key}`}>
                                    Side{plan.side === "required" ? " *" : ""}
                                  </label>
                                  <select id={`side-${it.key}`} value={it.laterality} disabled={busy}
                                    onChange={e => set(it.key, { laterality: e.target.value })}
                                    className={`${input} mt-1 ${plan.side === "required" && it.laterality === "not_applicable"
                                      ? "border-amber-300 bg-[var(--cmp-surface-warning)]" : ""}`}>
                                    {LATERALITIES
                                      // ⚠ A SIDED PROCEDURE IS NOT OFFERED "Not sided". It is the value
                                      // somebody picks to get past a required field, the engine refuses
                                      // it by name, and wrong-site is the canonical never-event.
                                      .filter(([k]) => !(plan.side === "required" && k === "not_applicable"))
                                      // s9: "show only valid CONFIGURED choices". A knee injection that
                                      // is only ever left or right does not offer bilateral. ⚠ An empty
                                      // list means UNRESTRICTED, never "no choices" -- reading it the
                                      // other way would leave every unrestricted procedure, which is
                                      // almost all of them, with an empty dropdown.
                                      .filter(([k]) => plan.lateralities.length === 0
                                        || k === "not_applicable" || plan.lateralities.includes(k))
                                      .map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                                  </select>
                                </div>
                              )}

                              <div>
                                <label className={FIELD_LABEL} htmlFor={`site-${it.key}`}>Site</label>
                                <input id={`site-${it.key}`} value={it.site} disabled={busy}
                                  placeholder="Optional"
                                  onChange={e => set(it.key, { site: e.target.value })}
                                  className={`${input} mt-1`} />
                              </div>

                              {/* s10: consent is prominent where the catalogue requires it, and behind
                                  the item's own disclosure where it does not -- rather than printing
                                  "Consent: Not recorded" on every procedure in the product. */}
                              <div>
                                <label className={FIELD_LABEL} htmlFor={`consent-${it.key}`}>
                                  Consent{plan.consent === "required" ? " *" : ""}
                                </label>
                                <select id={`consent-${it.key}`} value={it.consentStatus} disabled={busy}
                                  onChange={e => set(it.key, { consentStatus: e.target.value })}
                                  className={`${input} mt-1 ${plan.consent === "required" && it.consentStatus === "not_recorded"
                                    ? "border-amber-300 bg-[var(--cmp-surface-warning)]" : ""}`}>
                                  {CONSENT_STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                                </select>
                              </div>

                              <div>
                                <label className={FIELD_LABEL} htmlFor={`status-${it.key}`}>Status</label>
                                <select id={`status-${it.key}`} value={it.status} disabled={busy}
                                  onChange={e => set(it.key, { status: e.target.value })}
                                  className={`${input} mt-1`}>
                                  {PROCEDURE_STATUSES
                                    // s11's per-procedure lifecycle, with the same empty-means-
                                    // unrestricted rule as laterality above. The CURRENT value is always
                                    // offered even if it falls outside the list -- a catalogue narrowed
                                    // after an item was staged would otherwise leave the control showing
                                    // a value it does not contain, which browsers render as blank.
                                    .filter(([k]) => plan.statuses.length === 0
                                      || plan.statuses.includes(k) || k === it.status)
                                    .map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                                </select>
                              </div>

                              {/* ⚠ THE REASON FOLLOWS THE VOCABULARY, NOT ONE HARD-CODED STATUS. It used
                                  to test `=== "ABANDONED"`. With six statuses the engine requires a
                                  reason for ATTEMPTED, CANCELLED and DECLINED, and a hard-coded test
                                  would have left three of them refusing the batch over a field the
                                  screen never drew -- which a practitioner reads as a broken product. */}
                              {NEEDS_REASON.includes(it.status) && (
                                <div className="sm:col-span-2">
                                  <label className={FIELD_LABEL} htmlFor={`reason-${it.key}`}>Reason *</label>
                                  <input id={`reason-${it.key}`} value={it.abandonedReason} disabled={busy}
                                    placeholder={it.status === "ATTEMPTED"
                                      ? "Why was it not completed?" : `Why was it ${it.status.toLowerCase()}?`}
                                    onChange={e => set(it.key, { abandonedReason: e.target.value })}
                                    className={`${input} mt-1 ${it.abandonedReason.trim() ? "" : "border-amber-300 bg-[var(--cmp-surface-warning)]"}`} />
                                </div>
                              )}

                              {/* ⚠ AND SCHEDULED NEEDS THE TIME IT IS SCHEDULED FOR. The engine refuses
                                  without it rather than inventing now(), so drawing the status without
                                  drawing this field would put a dead end on the screen. It WAS a dead
                                  end until today for a different reason -- see PendingProcedure. */}
                              {it.status === "SCHEDULED" && (
                                <div className="sm:col-span-2">
                                  <label className={FIELD_LABEL} htmlFor={`when-${it.key}`}>Scheduled for *</label>
                                  <input id={`when-${it.key}`} type="datetime-local" value={it.scheduledAt}
                                    disabled={busy}
                                    onChange={e => set(it.key, { scheduledAt: e.target.value })}
                                    className={`${input} mt-1 ${it.scheduledAt ? "" : "border-amber-300 bg-[var(--cmp-surface-warning)]"}`} />
                                </div>
                              )}

                              <div className="sm:col-span-2">
                                <label className={FIELD_LABEL} htmlFor={`indication-${it.key}`}>Indication</label>
                                <input id={`indication-${it.key}`} value={it.indication} disabled={busy}
                                  placeholder="Optional"
                                  onChange={e => set(it.key, { indication: e.target.value })}
                                  className={`${input} mt-1`} />
                              </div>

                              {/* s14: outcome is progressive disclosure, not a field on every routine
                                  uncomplicated procedure -- EXCEPT where the catalogue says this
                                  procedure must document one, and then it is marked required and the
                                  item will not go Ready without it. ⚠ Only where something HAPPENED:
                                  asking the outcome of a procedure merely ordered invites an answer
                                  that contradicts the status above it, so the demand follows the
                                  engine's own not-done list. */}
                              <div className="sm:col-span-2">
                                <label className={FIELD_LABEL} htmlFor={`imm-${it.key}`}>
                                  Immediate outcome{outcomeDemanded ? " *" : ""}
                                </label>
                                <input id={`imm-${it.key}`} value={it.immediateOutcome} disabled={busy}
                                  placeholder={outcomeDemanded ? "What happened" : "Optional"}
                                  onChange={e => set(it.key, { immediateOutcome: e.target.value })}
                                  className={`${input} mt-1 ${outcomeDemanded && !it.immediateOutcome.trim()
                                    ? "border-amber-300 bg-[var(--cmp-surface-warning)]" : ""}`} />
                              </div>

                              {/* ── s8's PROCEDURE-SPECIFIC FIELDS ────────────────────────────────
                                  Declared by the catalogue entry, rendered only for the procedure that
                                  declares them. ⚠ Three kinds and no more: a clinical field whose kind
                                  the screen cannot validate is one the server cannot either, and
                                  parseDetailFields DROPS any definition it cannot read rather than
                                  drawing an input that would collect an unchecked answer. */}
                              {plan.detailFields.map(f => (
                                <div key={f.key} className={f.kind === "text" ? "sm:col-span-2" : ""}>
                                  <label className={FIELD_LABEL} htmlFor={`d-${it.key}-${f.key}`}>
                                    {f.label}{f.required ? " *" : ""}
                                  </label>
                                  {f.kind === "choice" ? (
                                    <select id={`d-${it.key}-${f.key}`} value={it.details[f.key] ?? ""}
                                      disabled={busy}
                                      onChange={e => set(it.key, { details: { ...it.details, [f.key]: e.target.value } })}
                                      className={`${input} mt-1 ${f.required && !(it.details[f.key] ?? "").trim()
                                        ? "border-amber-300 bg-[var(--cmp-surface-warning)]" : ""}`}>
                                      {/* ⚠ THE EMPTY OPTION IS FIRST AND IS NOT A VALUE. A required
                                          choice that pre-selects its first option records an answer
                                          nobody gave -- the same trap as "Not sided" on a sided
                                          procedure. */}
                                      <option value="">{f.required ? "Choose..." : "Not recorded"}</option>
                                      {f.options.map(o => <option key={o} value={o}>{o}</option>)}
                                    </select>
                                  ) : (
                                    <input id={`d-${it.key}-${f.key}`} value={it.details[f.key] ?? ""}
                                      disabled={busy}
                                      inputMode={f.kind === "number" ? "decimal" : undefined}
                                      placeholder={f.required ? "" : "Optional"}
                                      onChange={e => set(it.key, { details: { ...it.details, [f.key]: e.target.value } })}
                                      className={`${input} mt-1 ${f.required && !(it.details[f.key] ?? "").trim()
                                        ? "border-amber-300 bg-[var(--cmp-surface-warning)]" : ""}`} />
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          {/* s21: Remove sits apart from Details and from Record, at the foot of the
                              item, so a mis-click cannot discard work while reaching for a disclosure. */}
                          <div className="mt-2 flex justify-end">
                            <button type="button" disabled={busy}
                              onClick={() => setItems(p => p.filter(x => x.key !== it.key))}
                              aria-label={`Remove ${named} from the working set`}
                              className="rounded-lg px-2 py-0.5 text-[11px] font-semibold text-gray-500 hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 disabled:opacity-50">
                              Remove
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {notice && (
                  <p role="status" className={`rounded-lg px-2.5 py-1.5 text-[12px] ${notice.kind === "ok"
                    ? "bg-emerald-50 text-emerald-800" : "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"}`}>
                    {notice.text}
                  </p>
                )}
                <span className="ml-auto flex items-center gap-2">
                  {/* ⚠ s13: THE BUTTON IS DISABLED WHILE ANYTHING IS UNRESOLVED, AND THE SENTENCE BESIDE
                      IT SAYS WHY. A disabled button that cannot explain itself reads as a broken product
                      -- that exact defect was reported on the Treatment tab and it is not repeated here. */}
                  {blocked > 0 && (
                    <span className="text-[11.5px] text-[var(--cmp-text-warning)]">
                      {blocked === 1 ? "One procedure still needs" : `${blocked} procedures still need`} something
                      above.
                    </span>
                  )}
                  <button type="button" disabled={busy || pending.length === 0 || blocked > 0} onClick={commit}
                    className="rounded-lg bg-[var(--cp-primary)] px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-primary)] focus-visible:ring-offset-2 disabled:opacity-50">
                    {busy ? "Recording..."
                      : `Record ${pending.length} ${pending.length === 1 ? "procedure" : "procedures"}`}
                  </button>
                </span>
              </div>
            </div>

            {/* s15: the rule is enforced in the interface now, so the prose explaining it moves behind a
                disclosure instead of standing open above the workflow. */}
            <div className="mt-3">
              <Tip>
                <details>
                  <summary className="cursor-pointer font-semibold">How procedure fields are decided</summary>
                  <p className="mt-1.5">
                    A procedure chosen from the catalogue only shows the fields that procedure uses. One
                    marked as having sides must record left, right or bilateral and will not become ready
                    without one; one marked as needing consent must say whether it was obtained, refused
                    or not required. A procedure typed in by name is not in the catalogue, so nothing is
                    known about it &mdash; every field is offered and none is demanded.
                  </p>
                  <p className="mt-1.5">
                    The server checks all of this again when you record. Ready means nothing is missing
                    here, not that the record has been accepted.
                  </p>
                </details>
              </Tip>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
