"use client";

import Link from "next/link";
import { useState } from "react";
import { IDENTIFIER_LABELS } from "@/lib/practice/patient-workspace-constants";
import StartEncounterAction from "../encounters/StartEncounterAction";
import { Absence, Boundary, CARD, day } from "./Honesty";
import type { FamilyView, Probe, ScreenCapabilities, SummaryView } from "./types";

// CPR-V5-006 s4 -- the patient summary panel: everything about the selected patient WITHOUT leaving the
// workspace.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// EVERY BLOCK CARRIES ITS OWN AVAILABILITY, BECAUSE THE ENGINE GIVES IT ONE.
//
// A summary whose medication read failed must not render as a patient on no medication; a follow-up
// block that was never permitted must not render as a patient with nothing outstanding. Each block here
// is fed a Probe and there is exactly one component that renders a Probe -- so there is no path through
// this file that turns a failure into an absence.
//
// TWO BLOCKS CARRY A BOUNDARY SENTENCE AND CANNOT BE RENDERED WITHOUT IT.
//   · Medications are what was DECIDED AT THIS PRACTICE, newest first. `duration` is free text, so no
//     course has a computable end and nothing here can say what somebody is currently taking.
//   · Pending results are what CAME BACK and nobody has read. There is no order register in this
//     product, so "outstanding investigations" is not a list that exists.
//
// THE ACTIONS ARE THE ONES THAT HAVE AN ENGINE BEHIND THEM. This panel's own engine is read-only, so
// every write goes to an API that already exists: the encounter launcher and the walk-in queue. Booking,
// editing and merging live on the full record, which is one click away, and are not restated here as
// buttons that would need a second implementation.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

const F = (r: Record<string, unknown>, k: string): string | null => (r[k] == null ? null : String(r[k]));

function Block({ title, probe, nothing, children, note }: {
  title: string;
  probe: Probe;
  nothing: string;
  note?: string;
  children: (rows: Record<string, unknown>[]) => React.ReactNode;
}) {
  return (
    <section className="border-t border-gray-100 px-4 py-3">
      <h3 className="text-[12px] font-bold uppercase tracking-wide text-gray-600">
        {title}
        {!probe.unavailable && probe.count !== null && (
          <span className="ml-1.5 font-normal normal-case tracking-normal text-gray-400">
            {probe.truncated ? `at least ${probe.count}` : probe.count}
          </span>
        )}
      </h3>
      {note && <p className="mt-0.5 text-[11px] text-gray-500">{note}</p>}
      {probe.unavailable || probe.rows.length === 0
        ? <Absence className="mt-1" reason={probe.reason} error={probe.error} nothing={nothing} />
        : <div className="mt-1.5">{children(probe.rows)}</div>}
    </section>
  );
}

export default function SummaryPanel({ summary, summaryError, family, capabilities }: {
  summary: SummaryView | null;
  summaryError: { status: number; code: string; message: string } | null;
  family: FamilyView | null;
  capabilities: ScreenCapabilities;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  if (summaryError) {
    return (
      <section className={`${CARD} p-4`}>
        <h2 className="text-[14px] font-bold text-gray-900">This patient could not be opened</h2>
        <p className="mt-1 text-[12px] text-gray-600">
          {summaryError.code === "FORBIDDEN"
            ? "Seeing a patient's details needs patient.view, which your role does not carry."
            : summaryError.code === "NOT_FOUND"
              ? "No such patient at this practice. A record in another practice answers the same way, deliberately — a different answer would confirm it exists."
              : summaryError.message}
        </p>
      </section>
    );
  }
  if (!summary) return null;

  const p = summary.patient;
  const ids = summary.identifiers;
  const active = p.status === "active";

  async function post(url: string, body: Record<string, unknown>) {
    setBusy(true); setNotice(null);
    try {
      const r = await fetch(url, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setNotice({ kind: "err", text: d?.error?.message ?? d?.error ?? `That did not work (HTTP ${r.status}).` });
        return null;
      }
      return d as Record<string, unknown>;
    } catch (e) {
      setNotice({ kind: "err", text: `That did not reach the server: ${e instanceof Error ? e.message : String(e)}` });
      return null;
    } finally {
      setBusy(false);
    }
  }

  // ⚠ THERE WAS A startConsultation() HERE AND IT WAS WRONG. It read
  //     const hasPrior = !s.recentEncounters.unavailable && s.recentEncounters.rows.length > 0;
  //   and launched on the result -- so a patient whose encounter list FAILED TO READ was filed as a
  //   `new_walk_in`. entry_pathway is written onto the encounter and never revised: that is the screen
  //   claiming a first visit for somebody who may have been coming here for years, made silently, on the
  //   strength of a read that did not answer. The two sibling implementations refused this exact case,
  //   and encounter-start.ts's own comment claimed this one did too.
  //
  //   It is <StartEncounterAction/> over startEncounterFor() now: one refusal, one place, in the module
  //   the harness runs. The panel keeps its own notice line and its own busy state, so the queue button
  //   still goes quiet while a consultation is opening.

  async function queue() {
    const d = await post("/api/v1/practice/registration-workspace", { queuePatientId: p.id });
    if (d) {
      setNotice({
        kind: "ok",
        text: d.alreadyWaiting ? "Already in the waiting queue — not added twice." : "Added to the waiting queue.",
      });
    }
  }

  return (
    <div className={`${CARD} overflow-hidden`}>
      <div className="p-4">
        <h2 className="text-[14px] font-bold text-gray-900">{p.displayName}</h2>
        <p className="mt-0.5 text-[12px] text-gray-500">
          Registered {day(p.createdAt)} · record {p.status}
          {p.mergedIntoPatientId && " · merged into another record"}
        </p>

        {notice && (
          <p className={`mt-2 rounded-lg px-3 py-2 text-[12px] ${notice.kind === "ok"
            ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]"
            : "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"}`}>
            {notice.text}
          </p>
        )}

        <div className="mt-2 flex flex-wrap gap-2">
          <Link
            href={`/practice/patients/${p.id}`}
            className="rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-[var(--cp-primary-deep)]"
          >
            Open full record
          </Link>
          {capabilities.mayStartEncounter && active && (
            <StartEncounterAction
              patientId={p.id}
              label="Start consultation"
              tone="secondaryAction"
              compact
              disabled={busy}
              onNotice={setNotice}
              onBusy={setBusy}
            />
          )}
          {capabilities.mayCreate && active && (
            <button
              type="button" disabled={busy} onClick={() => void queue()}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-[13px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Add to waiting queue
            </button>
          )}
        </div>
        <p className="mt-1.5 text-[11px] text-gray-400">
          Booking, editing demographics and merging a duplicate are on the full record, where the facility
          and appointment lists live. They are not repeated here as a second implementation.
        </p>
      </div>

      {/* ── Identity ───────────────────────────────────────────────────────────────────────────── */}
      <section className="border-t border-gray-100 px-4 py-3">
        <h3 className="text-[12px] font-bold uppercase tracking-wide text-gray-600">Demographics</h3>
        <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
          <dt className="text-gray-500">Date of birth</dt>
          <dd className="text-gray-800">
            {p.birthDate ?? (p.ageEstimateYears != null
              ? <span className="text-gray-500">not recorded · about {p.ageEstimateYears} years</span>
              : <span className="text-gray-400">not recorded</span>)}
          </dd>
          <dt className="text-gray-500">Age</dt>
          <dd className="text-gray-800">{summary.age ? summary.age.label : <span className="text-gray-400">not derivable</span>}</dd>
          <dt className="text-gray-500">Sex</dt>
          <dd className="text-gray-800">{p.sex}</dd>
          {p.preferredLanguage && (<><dt className="text-gray-500">Language</dt><dd className="text-gray-800">{p.preferredLanguage}</dd></>)}
          {p.preferredContactMethod && (<><dt className="text-gray-500">Contact by</dt><dd className="text-gray-800">{p.preferredContactMethod}</dd></>)}
        </dl>
        {p.tags && p.tags.length > 0 && (
          <ul className="mt-1.5 flex flex-wrap gap-1">
            {p.tags.map(t => <li key={t} className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">{t}</li>)}
          </ul>
        )}
      </section>

      {/* ── Identifiers, all of them, together ─────────────────────────────────────────────────── */}
      <section className="border-t border-gray-100 px-4 py-3">
        <h3 className="text-[12px] font-bold uppercase tracking-wide text-gray-600">Identifiers</h3>
        <ul className="mt-1.5 flex flex-col gap-1">
          <li className="flex items-baseline justify-between gap-2 text-[12px]">
            <span className="text-gray-500">Practice ID</span>
            <span className="font-mono text-gray-900">{ids.practiceId ?? <span className="font-sans text-gray-400">none issued</span>}</span>
          </li>
          {ids.hospitalNumbers.map(h => (
            <li key={h.id} className="flex items-baseline justify-between gap-2 text-[12px]">
              <span className="text-gray-500">
                {IDENTIFIER_LABELS[h.type] ?? h.type}
                {h.facilityName && <span className="block text-[11px] text-gray-400">{h.facilityName}</span>}
              </span>
              <span className="font-mono text-gray-900">{h.value}</span>
            </li>
          ))}
          {ids.otherIdentifiers.map(o => (
            <li key={o.id} className="flex items-baseline justify-between gap-2 text-[12px]">
              <span className="text-gray-500">{IDENTIFIER_LABELS[o.type] ?? o.type}</span>
              <span className="font-mono text-gray-900">{o.value}</span>
            </li>
          ))}
        </ul>
        {ids.hospitalNumbers.length === 0 && (
          <p className="mt-1 text-[11px] text-gray-400">No hospital number recorded at any facility.</p>
        )}
        {!summary.identifiersProbe.ok && (
          <p className="mt-1 text-[11px] text-[var(--cmp-text-warning)]">
            The identifier list could not be read: {summary.identifiersProbe.error ?? "no reason given"}. Treat this as
            incomplete rather than as a patient with no numbers.
          </p>
        )}
      </section>

      <Block title="Contact" probe={summary.contacts} nothing="No phone or email recorded.">
        {rows => (
          <ul className="flex flex-col gap-0.5 text-[12px]">
            {rows.map(r => (
              <li key={F(r, "id")} className="flex items-baseline justify-between gap-2">
                <span className="text-gray-500">{IDENTIFIER_LABELS[F(r, "contact_type") ?? ""] ?? F(r, "contact_type")}</span>
                <span className="text-gray-900">
                  {F(r, "value")}
                  {r.preferred === true && <span className="ml-1 text-[11px] text-gray-500">preferred</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Block>

      {/* ── Guardians and next of kin ──────────────────────────────────────────────────────────── */}
      <Block
        title="Guardian / next of kin"
        probe={summary.relationships}
        nothing="Nobody is recorded against this patient."
        note={summary.relationshipExpectation?.reason}
      >
        {rows => (
          <ul className="flex flex-col gap-1.5 text-[12px]">
            {rows.map(r => (
              <li key={F(r, "id")} className={r.live === false ? "opacity-50" : ""}>
                <span className="font-semibold text-gray-900">{F(r, "full_name")}</span>
                <span className="ml-1 text-gray-500">{F(r, "typeLabel") ?? F(r, "relationship_type")}</span>
                {r.is_legal_guardian === true && (
                  <span className="ml-1 rounded bg-violet-100 px-1 py-0.5 text-[10px] font-semibold text-violet-800">legal authority</span>
                )}
                {r.may_receive_information === true && (
                  <span className="ml-1 rounded bg-gray-100 px-1 py-0.5 text-[10px] text-gray-600">may be told</span>
                )}
                {r.live === false && <span className="ml-1 text-[11px] text-gray-500">ended {F(r, "effective_to")}</span>}
                <span className="block text-[11px] text-gray-500">
                  {[F(r, "phone"), F(r, "email")].filter(Boolean).join(" · ") || "no contact recorded"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Block>

      {/* ── Family: what is recorded, and what is only inferred ────────────────────────────────── */}
      {family && (
        <section className="border-t border-gray-100 px-4 py-3">
          <h3 className="text-[12px] font-bold uppercase tracking-wide text-gray-600">Family</h3>
          {family.unavailable ? (
            <Absence className="mt-1" reason={family.reason} error={family.error} nothing="" />
          ) : (
            <>
              {family.parents.length + family.guardians.length + family.namedSiblings.length === 0 && (
                <p className="mt-1 text-[12px] text-gray-400">No parent, guardian or sibling is recorded.</p>
              )}
              {[["Parents", family.parents], ["Guardians", family.guardians], ["Siblings named on this record", family.namedSiblings]]
                .filter(([, list]) => (list as typeof family.parents).length > 0)
                .map(([label, list]) => (
                  <div key={String(label)} className="mt-1.5">
                    <p className="text-[11px] font-semibold text-gray-500">{String(label)}</p>
                    <ul className="text-[12px] text-gray-800">
                      {(list as typeof family.parents).map(m => (
                        <li key={m.relationshipId}>
                          {m.fullName} <span className="text-gray-500">{m.relationshipLabel}</span>
                          {m.phone && <span className="text-[11px] text-gray-500"> · {m.phone}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}

              {family.inferredSiblings.length > 0 && (
                <div className="mt-2 rounded-lg border border-dashed border-gray-200 bg-gray-50/60 p-2">
                  <p className="text-[11px] font-semibold text-gray-600">
                    Possible siblings &mdash; inferred, not recorded
                  </p>
                  <ul className="mt-0.5 text-[12px] text-gray-800">
                    {family.inferredSiblings.map(s => (
                      <li key={s.patientId}>
                        <Link href={`/practice/patients/${s.patientId}`} className="font-semibold hover:underline">
                          {s.name ?? "name withheld"}
                        </Link>
                        <span className="block text-[11px] text-gray-500">
                          shares {s.sharedGuardian.fullName} ({s.sharedGuardian.relationshipType}) as a live guardian
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{family.inference.note}</p>
                </div>
              )}
              {!family.inference.ok && (
                <p className="mt-1 text-[11px] text-[var(--cmp-text-warning)]">
                  The sibling match could not be run: {family.inference.error ?? "no reason given"}.
                </p>
              )}
            </>
          )}
        </section>
      )}

      <Block title="Recent encounters" probe={summary.recentEncounters} nothing="This practice has never opened an encounter for this patient.">
        {rows => (
          <ul className="flex flex-col gap-1 text-[12px]">
            {rows.map(r => (
              <li key={F(r, "id")}>
                <Link href={`/practice/encounters/${F(r, "id")}`} className="font-semibold text-gray-900 hover:underline">
                  {day(F(r, "started_at"))}
                </Link>
                <span className="ml-1 rounded bg-gray-100 px-1 py-0.5 text-[10px] font-semibold text-gray-600">{F(r, "status")}</span>
                {F(r, "reason_for_visit") && <span className="block text-[11px] text-gray-500">{F(r, "reason_for_visit")}</span>}
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title="Active follow-ups" probe={summary.activeFollowUps} nothing="Nothing is outstanding.">
        {rows => (
          <ul className="flex flex-col gap-1 text-[12px]">
            {rows.map(r => (
              <li key={F(r, "id")}>
                <span className="font-semibold text-gray-900">{F(r, "due_on")}</span>
                <span className="ml-1 text-gray-500">{F(r, "status")}</span>
                <span className="block text-[11px] text-gray-600">{F(r, "reason")}</span>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title="Diagnoses" probe={summary.diagnoses} nothing="None recorded at this practice.">
        {rows => (
          <ul className="flex flex-col gap-0.5 text-[12px]">
            {rows.map(r => (
              <li key={F(r, "id")}>
                <span className="text-gray-900">{F(r, "label")}</span>
                <span className="ml-1 text-[11px] text-gray-500">
                  {F(r, "certainty")}{r.is_primary === true ? " · primary" : ""} · {day(F(r, "created_at"))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title="Problems" probe={summary.problems} nothing="No problem list at this practice.">
        {rows => (
          <ul className="flex flex-col gap-0.5 text-[12px]">
            {rows.map(r => (
              <li key={F(r, "id")}>
                <span className="text-gray-900">{F(r, "label")}</span>
                <span className="ml-1 text-[11px] text-gray-500">{F(r, "status")}</span>
              </li>
            ))}
          </ul>
        )}
      </Block>

      {/* ── What came back, which is not what was asked for ────────────────────────────────────── */}
      <Block title="Results arrived, not reviewed" probe={summary.pendingResults} nothing="Nothing has arrived unreviewed.">
        {rows => (
          <ul className="flex flex-col gap-0.5 text-[12px]">
            {rows.map(r => (
              <li key={F(r, "id")}>
                <span className="text-gray-900">{F(r, "title")}</span>
                <span className="ml-1 text-[11px] text-gray-500">
                  {F(r, "source")} · {F(r, "received_on")}{F(r, "priority") === "urgent" ? " · urgent" : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Block>
      <div className="px-4 pb-2"><Boundary>{summary.pendingResultsBoundary}</Boundary></div>

      <Block
        title="Investigations recorded as planned"
        probe={summary.recordedInvestigations}
        nothing="None recorded as planned."
        note="A practitioner's recorded intention inside a consultation. This product has no order register, so nothing here was transmitted to a lab."
      >
        {rows => (
          <ul className="flex flex-col gap-0.5 text-[12px]">
            {rows.map(r => (
              <li key={F(r, "id")}>
                <span className="text-gray-900">{F(r, "label")}</span>
                <span className="ml-1 text-[11px] text-gray-500">{F(r, "status")} · {day(F(r, "created_at"))}</span>
              </li>
            ))}
          </ul>
        )}
      </Block>

      {/* ── NOT a current-medication list, and the heading says so before the rows do ──────────── */}
      <Block title="Medications decided at this practice" probe={summary.medicationsDecided} nothing="Nothing has been prescribed here.">
        {rows => (
          <ul className="flex flex-col gap-1 text-[12px]">
            {rows.map(r => (
              <li key={F(r, "id")}>
                <span className="text-gray-900">{F(r, "label")}</span>
                <span className="block text-[11px] text-gray-500">
                  {[F(r, "dose"), F(r, "route"), F(r, "frequency"), F(r, "duration")].filter(Boolean).join(" · ")}
                </span>
                <span className="text-[11px] text-gray-400">{F(r, "status")} · decided {day(F(r, "created_at"))}</span>
              </li>
            ))}
          </ul>
        )}
      </Block>
      <div className="px-4 pb-2"><Boundary>{summary.medicationBoundary}</Boundary></div>

      <Block title="Procedures" probe={summary.procedures} nothing="None recorded.">
        {rows => (
          <ul className="flex flex-col gap-0.5 text-[12px]">
            {rows.map(r => (
              <li key={F(r, "id")}>
                <span className="text-gray-900">{F(r, "label")}</span>
                <span className="ml-1 text-[11px] text-gray-500">
                  {[F(r, "site"), F(r, "laterality"), day(F(r, "performed_at"))].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title="Documents" probe={summary.documents} nothing="No clinical document at this practice.">
        {rows => (
          <ul className="flex flex-col gap-0.5 text-[12px]">
            {rows.map(r => (
              <li key={F(r, "id")}>
                <span className="text-gray-900">{F(r, "title")}</span>
                <span className="ml-1 text-[11px] text-gray-500">{F(r, "doc_type")} · {F(r, "status")}</span>
              </li>
            ))}
          </ul>
        )}
      </Block>
    </div>
  );
}
