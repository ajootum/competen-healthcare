"use client";

import { useState } from "react";
import Link from "next/link";
import { ACTIVITY_KINDS, PARTICIPATION, PARTICIPANT_ROLES } from "@/lib/practice/clinical-activity";
import { ClinicalRecordTable, type RecordColumn } from "@/components/practice/ClinicalRecordTable";
import { TimeInput } from "@/components/ui/wall-clock";
import { HHMM_RE, wallClockInZone } from "@/lib/practice/practice-time";

// CPR-PCA-HFE-012 -- the Procedures & Clinical Activity portfolio console.
//
// THE ACTIVITY RECORD IS THE PAGE (s5). Two quiet summary bands orient; the chronological record below
// them is the dominant element; the footer explains where rows come from. The five equal KPI cards this
// replaces gave "Competency links: --" the same visual weight as "Procedures: 3", which is a dashboard
// about what the product lacks rather than a record of what the clinician did.
//
// THE COMP'S "COMPLICATION RATE 2.1%" AND "SUCCESS RATE 97.9%" ARE STILL NOT HERE. Rates over a new
// practice's three procedures are sentences that sound like measurements and are not. Counts with
// denominators, always.
//
// s16/s20: THERE IS NO COMPETENCY COLUMN AND NO COMPETENCY TILE. The practice tenancy does not read the
// platform's competency records -- clinical-activity.ts declares this rather than implying it -- so the
// one honest sentence lives in the low-salience footer, not in an empty card wearing a dashboard's
// clothes.

const input = "w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";

/* eslint-disable @typescript-eslint/no-explicit-any */

// s11: frequently used categories are direct filters; the rest sit behind More. "procedure" is a
// projection filter, not an ACTIVITY_KINDS code -- the engine treats it as "the other source".
const DIRECT_FILTERS: [string, string][] = [
  ["procedure", "Procedures"], ["ward_round", "Ward rounds"], ["teaching", "Teaching"],
  ["training", "Training"], ["audit", "Audit / Governance"],
];
const MORE_FILTERS: [string, string][] = ACTIVITY_KINDS
  .filter(([k]) => !DIRECT_FILTERS.some(([d]) => d === k))
  .map(([k, l]) => [k, l]);

const PROCEDURE_STATUS_LABEL: Record<string, string> = {
  PERFORMED: "Performed", ATTEMPTED: "Attempted", ABANDONED: "Abandoned",
  CANCELLED: "Cancelled", DECLINED: "Declined",
};
const ROLE_LABEL = Object.fromEntries(PARTICIPANT_ROLES as readonly (readonly [string, string])[]);

// s20: category tints for the Type chip. INFORMATION CODING, NOT DECORATION -- one hue per kind
// family, the WORD always beside the tint, and none of them amber or red: those stay reserved for
// states that need acting on, which a category never is.
const KIND_TINT: Record<string, string> = {
  procedure: "bg-indigo-50 text-indigo-700",
  ward_round: "bg-emerald-50 text-emerald-700",
  clinic_session: "bg-teal-50 text-teal-700",
  supervision: "bg-teal-50 text-teal-700",
  teaching: "bg-sky-50 text-sky-700",
  training: "bg-sky-50 text-sky-700",
  audit: "bg-slate-100 text-slate-600",
};
const KIND_TINT_FALLBACK = "bg-gray-100 text-gray-600";

type Row = any;

export default function ActivityConsole({
  records, portfolio, locations, onlyMine, kind, me, timezone, today, periodQuery = "", monthGrid = null,
}: {
  records: Row[]; portfolio: any; locations: any[]; onlyMine: boolean; kind: string; me: string;
  /**
   * ⚠ THE PRACTICE'S CLOCK, READ BY THE PAGE AND PASSED DOWN -- for PREFILLING ONLY.
   *
   * A form that offers "now" has to offer the practice's now, and this component has no way to read a
   * workspace row. It must never be used to COMPOSE a stored instant: that happens in the route, where
   * the timezone is authoritative rather than a prop somebody could forget to pass.
   */
  timezone: string; today: string;
  /**
   * s6's Month view, computed by the PAGE (the timezone and the period live there) and null in List
   * view. weeks are Monday-first with null padding; buckets and hrefs are keyed by YYYY-MM-DD.
   */
  monthGrid?: {
    weeks: (string | null)[][];
    buckets: Record<string, { procedures: number; activities: number; cpdMinutes: number }>;
    hrefs: Record<string, string>;
    today: string;
  } | null;
  /**
   * ⚠ THE PERIOD, AS QUERY TEXT, ON EVERY LINK THIS CONSOLE BUILDS.
   *
   * These links rebuild the URL from scratch. Without this, choosing a period and then pressing
   * "Show everyone's" or a filter would silently widen the record back out to every date, under a
   * period control still lit as though it were narrow. Content filters and the range are separate
   * controls, and separate means neither resets the other.
   */
  periodQuery?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [open, setOpen] = useState(false);
  // The active filter may live behind More; it must not be invisible while lit.
  const [showMore, setShowMore] = useState(MORE_FILTERS.some(([k]) => k === kind));
  /**
   * ⚠ THE DEFAULT IS THE PRACTICE'S NOW, NOT UTC's (2026-08-17).
   *
   * Both forms below prefilled with `new Date().toISOString().slice(0, 16)`, which is UTC's wall clock
   * poured into a control the browser draws as local time. In Kampala that offered "now" as three
   * hours ago, on a form whose whole purpose is recording when something happened -- and a person has
   * no reason to doubt a time the machine filled in for them.
   *
   * The date and time are also SEPARATE fields now rather than one datetime-local: the instant is
   * composed by the route, in the practice's timezone, because this component cannot know it and its
   * machine's zone is not evidence of it.
   */
  const [form, setForm] = useState({
    kind: "ward_round", title: "", detail: "", participation: "participated",
    occurredDate: today, occurredTime: wallClockInZone(timezone),
    durationMinutes: "", cpdMinutes: "", locationId: "", portfolio: false,
  });
  // s13's explicit external-procedure workflow (migration 302) -- its own form, never a mode of the
  // activity log, so recording encounter work here stays structurally impossible.
  const [extOpen, setExtOpen] = useState(false);
  const [extForm, setExtForm] = useState({
    label: "", source: "", sourceRef: "", role: "operator", detail: "",
    performedDate: today, performedTime: wallClockInZone(timezone), cpdMinutes: "", portfolio: true,
  });
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  /**
   * ⚠ A TEXT FIELD DOES NOT GUARANTEE WHAT type="time" GUARANTEED.
   *
   * The native control the 24-hour swap replaced only ever handed back a valid HH:MM or an empty
   * string -- the browser enforced it. A text input will hold "9am", "0900" or a pasted paragraph, and
   * `pattern` blocks nothing here because both of these forms save from an onClick handler rather than
   * a native form submission. So the same check the attribute expresses is made in code, from the one
   * definition, and the refusal SAYS THE FORMAT rather than reporting that something went wrong.
   */
  const badTime = (v: string) => !HHMM_RE.test(v.trim());
  const TIME_SENTENCE = "Enter the time on the 24-hour clock, as HH:MM -- for example 09:00 or 14:30.";

  async function submitExternal() {
    if (badTime(extForm.performedTime)) {
      setNotice({ kind: "err", text: TIME_SENTENCE }); return;
    }
    setBusy(true); setNotice(null);
    const res = await fetch("/api/v1/practice/activities", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        externalProcedure: {
          label: extForm.label, source: extForm.source,
          sourceRef: extForm.sourceRef || null, role: extForm.role,
          detail: extForm.detail || undefined,
          // The wall clock, composed into an instant by the route in the practice's timezone.
          performedDate: extForm.performedDate, performedTime: extForm.performedTime.trim(),
          cpdMinutes: extForm.cpdMinutes ? Number(extForm.cpdMinutes) : null,
          portfolio: extForm.portfolio,
        },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNotice({ kind: "err", text: data?.error?.message ?? data?.error ?? "That did not work." });
      setBusy(false); return;
    }
    window.location.reload();
  }

  async function removeExternal(id: string) {
    setBusy(true); setNotice(null);
    const res = await fetch(`/api/v1/practice/activities?subject=external_procedure&id=${encodeURIComponent(id)}`,
      { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setNotice({ kind: "err", text: data?.error?.message ?? "That was not removed." }); setBusy(false); return; }
    window.location.reload();
  }

  async function submit() {
    if (badTime(form.occurredTime)) {
      setNotice({ kind: "err", text: TIME_SENTENCE }); return;
    }
    setBusy(true); setNotice(null);
    const res = await fetch("/api/v1/practice/activities", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: form.kind, title: form.title, detail: form.detail || undefined,
        participation: form.participation,
        // The wall clock, composed into an instant by the route in the practice's timezone.
        occurredDate: form.occurredDate, occurredTime: form.occurredTime.trim(),
        durationMinutes: form.durationMinutes ? Number(form.durationMinutes) : null,
        cpdMinutes: form.cpdMinutes ? Number(form.cpdMinutes) : null,
        locationId: form.locationId || null, portfolio: form.portfolio,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNotice({ kind: "err", text: data?.error?.message ?? data?.error ?? "That did not work." });
      setBusy(false); return;
    }
    window.location.reload();
  }

  async function togglePortfolio(a: Row) {
    setBusy(true);
    const res = await fetch("/api/v1/practice/activities", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: a.recordKind === "activity" ? "activity" : a.external ? "external_procedure" : "procedure",
        id: a.id, portfolio: !a.portfolio,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setNotice({ kind: "err", text: data?.error?.message ?? "That did not work." }); setBusy(false); return; }
    window.location.reload();
  }

  const hours = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);
  const locationName = new Map((locations ?? []).map((l: any) => [l.id, l.name]));
  const kindCount = (k: string) =>
    portfolio.activities.byKind.find((b: any) => b.kind === k)?.total ?? 0;
  const moreCount = MORE_FILTERS.reduce((n, [k]) => n + kindCount(k), 0);

  const chip = (active: boolean) =>
    `rounded-full border px-2.5 py-1 text-[11.5px] font-semibold ${active
      ? "border-[var(--cp-primary)] bg-[var(--cp-primary)]/10 text-[var(--cp-primary-deep)]"
      : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"}`;
  const filterHref = (k: string) =>
    `/practice/activity?mine=${onlyMine ? "1" : "0"}${k ? `&kind=${k}` : ""}${periodQuery}`;

  // ── s10's columns: Date/Time | Activity | Type | Context/Source | Outcome/Details | CPD ─────────
  const COLUMNS: RecordColumn<Row>[] = [
    { key: "when", label: "Date / Time", priority: "secondary",
      render: r => (
        <span className="text-[11.5px] text-gray-600 whitespace-nowrap">
          {String(r.occurredAt).slice(0, 16).replace("T", " ")}
        </span>
      ) },
    { key: "activity", label: "Activity", priority: "primary",
      render: r => <span className="font-semibold text-gray-800">{r.title}</span> },
    { key: "type", label: "Type", priority: "secondary",
      render: r => (
        // Never colour alone -- the word is the signal, the tint is an aid (KIND_TINT's header).
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${KIND_TINT[r.kind] ?? KIND_TINT_FALLBACK}`}>
          {r.kindLabel}
        </span>
      ) },
    { key: "source", label: "Context / Source", priority: "secondary",
      render: r => (
        // s12: where each row came from, so nobody has to remember what was auto-captured.
        <span className="text-[11.5px] text-gray-600">
          {r.recordKind === "procedure"
            ? (r.external ? `External · ${r.source}` : "Encounter")
            : r.performed_by === me
              ? "You"
              : (r.performedByName ?? (r.performedByNameUnavailable ? "name could not be read" : "practitioner"))}
          {r.recordKind === "activity" && r.location_id && locationName.has(r.location_id)
            ? ` · ${locationName.get(r.location_id)}` : ""}
        </span>
      ) },
    { key: "outcome", label: "Outcome / Details", priority: "secondary",
      render: r => r.recordKind === "procedure" ? (
        r.external ? (
          // s15 made structural: an external row HAS no complication column, so the screen says the
          // assessment never happened here rather than implying a clean one did.
          <span className="text-[11.5px] text-gray-700">
            {ROLE_LABEL[r.role] ?? r.role}
            <span className="ml-1 text-gray-400">· outcomes not assessed here</span>
          </span>
        ) : (
          <span className="text-[11.5px] text-gray-700">
            {/* s20's "quiet green icon/text where useful" -- a tick BESIDE the word, never instead. */}
            {r.status === "PERFORMED" && <span aria-hidden="true" className="mr-0.5 text-emerald-600">&#10003;</span>}
            {PROCEDURE_STATUS_LABEL[r.status] ?? r.status}
            {/* s15: visible without alarm-like presentation -- a word in amber, not a red row. And a
                failed outcome read is NOT rendered as complication-free: absence of evidence is said. */}
            {r.hasComplication && <span className="ml-1 font-semibold text-amber-700">· complication recorded</span>}
            {r.complicationsUnread && <span className="ml-1 text-gray-400">· outcomes not read</span>}
          </span>
        )
      ) : (
        <span className="text-[11.5px] text-gray-700">
          <span aria-hidden="true" className="mr-0.5 text-emerald-600">&#10003;</span>Completed
          {` · ${r.participation}`}
          {r.duration_minutes ? ` · ${hours(r.duration_minutes)}` : ""}
        </span>
      ) },
    { key: "cpd", label: "CPD", priority: "secondary", align: "right",
      render: r => r.cpd_minutes
        ? <span className="text-[11.5px] text-gray-700">{hours(r.cpd_minutes)}</span>
        : <span className="text-gray-300">&mdash;</span> },
  ];

  return (
    <>
      {notice && (
        <p className={`mt-3 rounded-lg px-3 py-2 text-[12px] ${
          notice.kind === "ok" ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]"
            : "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"}`}>
          {notice.text}
        </p>
      )}

      {/* ══ s5/s7/s8: TWO SUMMARY BANDS, PERCEPTUALLY DISTINCT ══════════════════════════════════════
          System-derived procedures wear the lavender; logged professional activity wears the pale
          neutral. Both are ORIENTATION, not the point of the page -- the record below is. */}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <section className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
          <h2 className="text-[11px] font-bold uppercase tracking-wide text-indigo-700">Procedures</h2>
          <p className="mt-0.5 text-[11px] text-gray-600">
            Captured automatically from your encounter records.
          </p>
          {portfolio.procedures.performed === 0 ? (
            <p className="mt-2 text-[12px] text-gray-600">No procedures recorded for this period.</p>
          ) : (
            <div className="mt-2 flex items-baseline gap-4 flex-wrap">
              <span>
                <span className="text-2xl font-bold text-gray-900">{portfolio.procedures.performed}</span>
                <span className="ml-1 text-[11px] text-gray-600">
                  performed{portfolio.procedures.abandoned > 0 ? `, ${portfolio.procedures.abandoned} abandoned` : ""}
                </span>
              </span>
              {/* s7: quiet unless non-zero, and NEVER a celebratory zero-KPI. A count and its
                  denominator; the reader divides. */}
              <span className={`text-[11px] ${portfolio.procedures.withComplication > 0
                ? "font-semibold text-amber-700" : "text-gray-600"}`}>
                complications {portfolio.procedures.withComplication} of {portfolio.procedures.complicationDenominator}
              </span>
              <span className="text-[11px] text-gray-600">
                CPD this period {hours(portfolio.cpdMinutes)}
                <span className="text-gray-400"> (procedures and logged activity)</span>
              </span>
            </div>
          )}
          {portfolio.procedures.external > 0 && (
            // Kept OUT of the headline count: the sentence above says the figures come from encounter
            // records, and externals are exactly the rows that do not.
            <p className="mt-1 text-[11px] text-gray-600">
              + {portfolio.procedures.external} recorded from outside this practice
            </p>
          )}
          <div className="mt-2 flex items-center gap-3 flex-wrap">
            <Link href={filterHref("procedure")}
              className="text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
              View all procedures &rarr;
            </Link>
            {/* s13: EXPLICIT and quiet -- a bordered secondary action, never the band's primary one.
                The automatic path is the normal path; this exists for work done somewhere else. */}
            <button type="button" onClick={() => setExtOpen(o => !o)}
              className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50">
              {extOpen ? "Cancel" : "Record external procedure"}
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-emerald-100 bg-emerald-50/30 p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-[11px] font-bold uppercase tracking-wide text-emerald-800">Other clinical activity</h2>
              <p className="mt-0.5 text-[11px] text-gray-600">
                Professional activity not recorded through patient encounters.
              </p>
            </div>
            {/* s8's one primary action. s13: this is NOT how procedures are recorded, and the form
                below offers no procedure kind -- the consultation is where those are written. */}
            <button type="button" onClick={() => setOpen(o => !o)}
              className="shrink-0 rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)]">
              {open ? "Cancel" : "+ Log activity"}
            </button>
          </div>
          {portfolio.activities.total === 0 ? (
            <p className="mt-2 text-[12px] text-gray-600">
              No other professional activity recorded for this period.
            </p>
          ) : (
            <div className="mt-2 flex items-baseline gap-4 flex-wrap">
              <span>
                <span className="text-2xl font-bold text-gray-900">{portfolio.activities.total}</span>
                <span className="ml-1 text-[11px] text-gray-600">activities logged</span>
              </span>
              <span className="text-[11px] text-gray-600">Ward rounds {kindCount("ward_round")}</span>
              <span className="text-[11px] text-gray-600">Teaching {kindCount("teaching")}</span>
              <span className="text-[11px] text-gray-600">Training {kindCount("training")}</span>
              {moreCount > 0 && <span className="text-[11px] text-gray-600">More {moreCount}</span>}
            </div>
          )}
        </section>
      </div>

      {extOpen && (
        <section className="mt-3 rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="text-[13px] font-bold text-gray-900">Record an external procedure</h3>
          <p className="mt-0.5 text-[11px] text-gray-500">
            Work done outside this practice &mdash; another hospital, a mission, before you joined.
            Procedures done HERE are recorded in the consultation and arrive automatically; recording
            one of those again would double it.
          </p>
          <form className="mt-3 flex flex-col gap-2" onSubmit={e => { e.preventDefault(); submitExternal(); }}>
            <div className="grid sm:grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-gray-500">What procedure *</span>
                <input required value={extForm.label} placeholder="e.g. Open appendicectomy"
                  onChange={e => setExtForm(f => ({ ...f, label: e.target.value }))}
                  className={`${input} ${extForm.label.trim().length >= 3 ? "" : "border-amber-300 bg-[var(--cmp-surface-warning)]"}`} />
              </label>
              <label className="flex flex-col gap-1">
                {/* The source is what makes an external record checkable, so the field wears its own
                    requirement the way every required field on this estate now does. */}
                <span className="text-[11px] font-semibold text-gray-500">Where it was done *</span>
                <input required value={extForm.source} placeholder="e.g. Mulago Hospital, general theatre"
                  onChange={e => setExtForm(f => ({ ...f, source: e.target.value }))}
                  className={`${input} ${extForm.source.trim().length >= 3 ? "" : "border-amber-300 bg-[var(--cmp-surface-warning)]"}`} />
              </label>
            </div>
            <div className="grid sm:grid-cols-4 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-gray-500">Your role</span>
                <select value={extForm.role} onChange={e => setExtForm(f => ({ ...f, role: e.target.value }))} className={input}>
                  {PARTICIPANT_ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-gray-500">When performed</span>
                {/* ⚠ A DATE AND A 24-HOUR TIME, NOT datetime-local. The native control draws the
                    operating system's locale, so this read "11:00 AM" on any US-locale machine in a
                    product that speaks 24-hour everywhere else -- and its offsetless value was being
                    turned into an instant in the BROWSER's zone. type="date" stays: its value is
                    unambiguous, it carries no zone to get wrong, and the native calendar is the
                    better control. They are stacked so this cell still occupies one grid column. */}
                <input type="date" required value={extForm.performedDate}
                  onChange={e => setExtForm(f => ({ ...f, performedDate: e.target.value }))} className={input} />
                <TimeInput value={extForm.performedTime} required className={input}
                  ariaLabel="Time it was performed, 24-hour clock"
                  onChange={v => setExtForm(f => ({ ...f, performedTime: v }))} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-gray-500">Reference</span>
                <input value={extForm.sourceRef} placeholder="logbook / op-note no."
                  onChange={e => setExtForm(f => ({ ...f, sourceRef: e.target.value }))} className={input} />
                <span className="text-[10px] text-gray-400">Optional. The same reference is refused twice.</span>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-gray-500">CPD minutes</span>
                <input type="number" min={0} max={1440} value={extForm.cpdMinutes} placeholder="minutes"
                  onChange={e => setExtForm(f => ({ ...f, cpdMinutes: e.target.value }))} className={input} />
              </label>
            </div>
            <textarea rows={2} value={extForm.detail} placeholder="Anything worth remembering (optional)"
              onChange={e => setExtForm(f => ({ ...f, detail: e.target.value }))} className={input} />
            <label className="flex items-center gap-2 text-[12px] text-gray-700">
              <input type="checkbox" checked={extForm.portfolio}
                onChange={e => setExtForm(f => ({ ...f, portfolio: e.target.checked }))} />
              Keep this in my portfolio
            </label>
            <button type="submit" disabled={busy || extForm.label.trim().length < 3 || extForm.source.trim().length < 3}
              className="self-start rounded-lg bg-[var(--cp-primary)] px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-40">
              Record it
            </button>
          </form>
        </section>
      )}

      {open && (
        <section className="mt-3 rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="text-[13px] font-bold text-gray-900">Log a professional activity</h3>
          <form className="mt-3 flex flex-col gap-2"
            onSubmit={e => { e.preventDefault(); submit(); }}>
            <div className="grid sm:grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-gray-500">What kind</span>
                <select value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value }))} className={input}>
                  {ACTIVITY_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-gray-500">Your part in it</span>
                <select value={form.participation} onChange={e => setForm(f => ({ ...f, participation: e.target.value }))} className={input}>
                  {PARTICIPATION.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
            </div>
            <input required value={form.title} placeholder="What was it?"
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className={input} />
            <textarea rows={2} value={form.detail} placeholder="Anything worth remembering (optional)"
              onChange={e => setForm(f => ({ ...f, detail: e.target.value }))} className={input} />
            <div className="grid sm:grid-cols-4 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-gray-500">When</span>
                {/* Same split as the external-procedure form above, and for the same two reasons. */}
                <input type="date" required value={form.occurredDate}
                  onChange={e => setForm(f => ({ ...f, occurredDate: e.target.value }))} className={input} />
                <TimeInput value={form.occurredTime} required className={input}
                  ariaLabel="Time it happened, 24-hour clock"
                  onChange={v => setForm(f => ({ ...f, occurredTime: v }))} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-gray-500">How long</span>
                <input type="number" min={1} max={1440} value={form.durationMinutes} placeholder="minutes"
                  onChange={e => setForm(f => ({ ...f, durationMinutes: e.target.value }))} className={input} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-gray-500">Of which CPD</span>
                <input type="number" min={0} max={1440} value={form.cpdMinutes} placeholder="minutes"
                  onChange={e => setForm(f => ({ ...f, cpdMinutes: e.target.value }))} className={input} />
                {/* Said where somebody is about to overstate it. */}
                <span className="text-[10px] text-gray-400">Cannot exceed the time it took.</span>
              </label>
              {locations.length > 0 && (
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold text-gray-500">Where</span>
                  <select value={form.locationId} onChange={e => setForm(f => ({ ...f, locationId: e.target.value }))} className={input}>
                    <option value="">Not recorded</option>
                    {locations.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </label>
              )}
            </div>
            <label className="flex items-center gap-2 text-[12px] text-gray-700">
              <input type="checkbox" checked={form.portfolio}
                onChange={e => setForm(f => ({ ...f, portfolio: e.target.checked }))} />
              Keep this in my portfolio
            </label>
            <button type="submit" disabled={busy || !form.title.trim()}
              className="self-start rounded-lg bg-[var(--cp-primary)] px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-40">
              Log it
            </button>
          </form>
        </section>
      )}

      {/* ══ s10: THE ACTIVITY RECORD -- THE DOMINANT ELEMENT ════════════════════════════════════════ */}
      <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <div>
            <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-700">Activity record</h2>
            <p className="mt-0.5 text-[11px] text-gray-500">
              A chronological record of your procedures and professional clinical activities.
            </p>
          </div>
          <Link href={`/practice/activity?mine=${onlyMine ? "0" : "1"}${kind ? `&kind=${kind}` : ""}${periodQuery}`}
            className="text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
            {onlyMine ? "Show everyone's" : "Show only mine"}
          </Link>
        </div>

        {/* s11: All + the frequent five; the rest behind More. Links, not JavaScript, so a filtered
            record is something somebody can bookmark or send. */}
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <Link href={filterHref("")} aria-current={kind === "" ? "page" : undefined} className={chip(kind === "")}>
            All
          </Link>
          {DIRECT_FILTERS.map(([k, l]) => (
            <Link key={k} href={filterHref(k)} aria-current={kind === k ? "page" : undefined} className={chip(kind === k)}>
              {l}
            </Link>
          ))}
          {!showMore ? (
            <button type="button" onClick={() => setShowMore(true)}
              className="rounded-full px-2.5 py-1 text-[11.5px] font-semibold text-gray-500 hover:text-gray-800">
              More &#9662;
            </button>
          ) : MORE_FILTERS.map(([k, l]) => (
            <Link key={k} href={filterHref(k)} aria-current={kind === k ? "page" : undefined} className={chip(kind === k)}>
              {l}
            </Link>
          ))}
        </div>

        {monthGrid ? (
          // ══ s6's MONTH GRID ══ Each cell is the two summary bands in miniature: procedures and
          // logged activities counted APART, in words and numbers -- never colour alone (s10). A cell
          // links to its own day as a single-day List, so the drill-down is one click and lands on a
          // period the control describes truthfully.
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[560px] table-fixed border-collapse"
              aria-label="Calendar of procedures and professional activities for this month">
              <thead>
                <tr>
                  {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => (
                    <th key={d} scope="col"
                      className="border-b border-gray-200 pb-1 text-left text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                      {d}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {monthGrid.weeks.map((week, wi) => (
                  <tr key={wi}>
                    {week.map((day, di) => day === null ? (
                      <td key={di} className="h-20 border border-gray-100 bg-gray-50/40" aria-hidden="true" />
                    ) : (
                      <td key={di} className="h-20 border border-gray-100 p-0 align-top">
                        <Link href={monthGrid.hrefs[day] ?? "#"}
                          aria-label={`Open ${day} as a list`}
                          className="flex h-full flex-col gap-0.5 p-1.5 hover:bg-gray-50">
                          <span className={`self-start rounded px-1 text-[11px] font-semibold ${
                            day === monthGrid.today
                              ? "bg-[var(--cp-primary)]/10 text-[var(--cp-primary-deep)] ring-1 ring-[var(--cp-primary-border)]"
                              : "text-gray-600"}`}>
                            {Number(day.slice(8, 10))}
                          </span>
                          {(monthGrid.buckets[day]?.procedures ?? 0) > 0 && (
                            <span className="rounded bg-indigo-50 px-1 text-[10px] font-semibold text-indigo-700">
                              {monthGrid.buckets[day]!.procedures} proc
                            </span>
                          )}
                          {(monthGrid.buckets[day]?.activities ?? 0) > 0 && (
                            <span className="rounded bg-gray-100 px-1 text-[10px] font-semibold text-gray-600">
                              {monthGrid.buckets[day]!.activities} act
                            </span>
                          )}
                        </Link>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1.5 text-[10.5px] text-gray-500">
              A day&apos;s counts are the record above filtered to that day &mdash; open one to read it
              as a list. Days shown empty were read successfully.
            </p>
          </div>
        ) : (
        <div className="mt-2 overflow-x-auto">
          <ClinicalRecordTable
            label="Procedures and professional activities, most recent first"
            columns={COLUMNS}
            empty={
              // s17: local and specific. The old empty line claimed nothing was logged even while
              // procedures existed; the All view is only empty when BOTH sources are, and says both.
              <p className="mt-2 text-[12px] text-gray-500">
                {kind === "procedure"
                  ? "No procedures recorded for this period."
                  : kind
                    ? `No ${(ACTIVITY_KINDS.find(([k]) => k === kind)?.[1] ?? kind).toLowerCase()} activity recorded for this period.`
                    : "No procedures or professional activities recorded for this period. Procedures arrive here from encounter records; anything else can be logged above."}
              </p>
            }
            records={records.map(r => ({
              id: `${r.recordKind}-${r.id}`,
              data: r,
              secondaryText: (r.recordKind === "activity" || r.external) && r.detail ? r.detail : undefined,
              actions: r.recordKind === "procedure" && r.external ? (
                r.performed_by === me ? (
                  <span className="inline-flex items-center gap-1.5">
                    <button type="button" disabled={busy} onClick={() => togglePortfolio(r)}
                      className="rounded-lg border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                      {r.portfolio ? "In portfolio" : "Add to portfolio"}
                    </button>
                    {/* Two clicks, in words -- the first names what the second will do. An external row
                        is the practitioner's own claim, so removing a mis-entry is theirs alone. */}
                    <button type="button" disabled={busy}
                      onClick={() => confirmRemove === r.id ? removeExternal(r.id) : setConfirmRemove(r.id)}
                      className={`rounded-lg px-2 py-0.5 text-[11px] font-semibold disabled:opacity-50 ${
                        confirmRemove === r.id
                          ? "border border-rose-300 text-rose-700 hover:bg-rose-50"
                          : "text-gray-500 hover:bg-gray-50"}`}>
                      {confirmRemove === r.id ? "Confirm remove" : "Remove"}
                    </button>
                  </span>
                ) : undefined
              ) : r.recordKind === "procedure" ? (
                // s23: the portfolio row LINKS to the encounter; it does not re-publish it. The
                // encounter page enforces its own permissions on arrival.
                <Link href={`/practice/encounters/${r.encounterId}`}
                  className="rounded-lg border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50">
                  View
                </Link>
              ) : r.performed_by === me ? (
                // Only the person who did it may change their own portfolio, so the button is not
                // offered to anyone else rather than offered-and-refused.
                <button type="button" disabled={busy} onClick={() => togglePortfolio(r)}
                  className="rounded-lg border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                  {r.portfolio ? "In portfolio" : "Add to portfolio"}
                </button>
              ) : undefined,
            }))}
          />
          {records.length > 0 && (
            // The comp's "Showing 1 to N" line, said the honest way: a COUNT of what is on screen.
            // The page-level truncation banner already covers the case where there was more.
            <p className="mt-2 flex items-baseline justify-between gap-2 text-[11px] text-gray-500">
              <span>Showing {records.length} in this period.</span>
              {kind !== "" && (
                <Link href={filterHref("")} className="font-semibold text-[var(--cp-primary-deep)] hover:underline">
                  View all activity &rarr;
                </Link>
              )}
            </p>
          )}
        </div>
        )}
      </section>

      {/* ══ s5's FOOTER: LOW-SALIENCE GUIDANCE, AND THE ONE HONEST COMPETENCY SENTENCE ═════════════ */}
      <p className="mt-4 rounded-xl border border-gray-100 bg-gray-50/60 px-4 py-3 text-[11px] text-gray-500">
        <strong className="text-gray-600">Procedures are captured automatically from encounter records</strong>
        {" "}&mdash; record them in the consultation and they appear here without re-entry. Log other
        professional activities to build your complete clinical portfolio. {portfolio.competencyNote}
      </p>
    </>
  );
}
