import { DOCUMENT_MAX_LABEL, EVIDENCE_KIND } from "@/lib/individual/professional/vocabulary";
import { ApiForm, Field, inputCls } from "./forms";

// EDITING what the person already recorded -- a CPD entry, an evidence item, a goal, a need -- instead of deleting and
// re-entering it (which, for a CPD entry or evidence, used to lose its document). Each is a disclosure on its row,
// filled with what is stored, submitted with PUT to the same route and the same checks as adding one. An attached
// document is kept unless a new one is chosen.

const summary = "cursor-pointer text-[12.5px] font-semibold underline underline-offset-2";
const Disclosure = ({ label, accent, children }: { label: string; accent: string; children: React.ReactNode }) => (
  <details className="mt-2">
    <summary className={summary} style={{ color: accent }}>{label}</summary>
    <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-4">{children}</div>
  </details>
);
const d = (v: string | null | undefined) => (v ? v.slice(0, 10) : "");

/** What the person may record now: the configured types, and whether 490's optional hours and decimal credits apply. */
export type CpdOptions = { types: { code: string; label: string }[]; flexible: boolean };

export function CpdEdit({ c, goals, today, accent, options }: {
  c: { id: string; title: string; activity_type: string; activity_date: string; hours: number | null; cpd_points: number | null; provider: string | null; reflection: string | null; goal_id: string | null; document_name: string | null };
  goals: { id: string; title: string }[]; today: string; accent: string; options: CpdOptions;
}) {
  // A type the configuration no longer offers is kept on an entry that already has it.
  const types = options.types.some(t => t.code === c.activity_type) ? options.types : [...options.types, { code: c.activity_type, label: c.activity_type.replace(/_/g, " ") }];
  const p = `cpd-${c.id}-e`;
  return (
    <Disclosure label="Edit" accent={accent}>
      <ApiForm action={`/api/individual/professional/cpd?id=${c.id}`} method="PUT" multipart reset={false} submitLabel="Save changes" accent={accent} savedText="Changes saved.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Activity" htmlFor={`${p}-title`}><input id={`${p}-title`} name="title" required minLength={3} maxLength={200} defaultValue={c.title} className={inputCls} /></Field>
          <Field label="Kind of activity" htmlFor={`${p}-type`}>
            <select id={`${p}-type`} name="activityType" required defaultValue={c.activity_type} className={inputCls}>{types.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}</select>
          </Field>
          <Field label="Date" htmlFor={`${p}-date`}><input id={`${p}-date`} name="activityDate" type="date" required max={today} defaultValue={d(c.activity_date)} className={inputCls} /></Field>
          <Field label={options.flexible ? "Hours (optional)" : "Hours"} htmlFor={`${p}-hours`}><input id={`${p}-hours`} name="hours" type="number" required={!options.flexible} min={0.1} max={1000} step={0.1} inputMode="decimal" defaultValue={c.hours ?? ""} className={inputCls} /></Field>
          <Field label={options.flexible ? "CPD credits (optional)" : "CPD points (optional)"} htmlFor={`${p}-points`}><input id={`${p}-points`} name="cpdPoints" type="number" min={0} step={options.flexible ? 0.1 : 1} defaultValue={c.cpd_points ?? ""} className={inputCls} /></Field>
          <Field label="Provider (optional)" htmlFor={`${p}-provider`}><input id={`${p}-provider`} name="provider" maxLength={160} defaultValue={c.provider ?? ""} className={inputCls} /></Field>
          <Field label="Goal it served (optional)" htmlFor={`${p}-goal`}>
            <select id={`${p}-goal`} name="goalId" defaultValue={c.goal_id ?? ""} className={inputCls}><option value="">None</option>{goals.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}</select>
          </Field>
          <Field label={c.document_name ? `Replace ${c.document_name} (optional)` : "Attach a document (optional)"} htmlFor={`${p}-doc`} hint={`PDF or image, up to ${DOCUMENT_MAX_LABEL}. Leave empty to keep what is attached.`}>
            <input id={`${p}-doc`} name="document" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className={`${inputCls} py-2.5`} />
          </Field>
        </div>
        <Field label="Reflection (optional)" htmlFor={`${p}-reflection`}><textarea id={`${p}-reflection`} name="reflection" rows={5} maxLength={5000} defaultValue={c.reflection ?? ""} className={inputCls} /></Field>
      </ApiForm>
    </Disclosure>
  );
}

export function EvidenceEdit({ e, needs, today, accent }: {
  e: { id: string; kind: string; title: string; detail: string | null; issuing_body: string | null; issued_on: string | null; expires_on: string | null; need_id: string | null;
    framework_id: string | null; framework_competency_id: string | null; document_name: string | null };
  needs: { id: string; title: string }[]; today: string; accent: string;
}) {
  const p = `ev-${e.id}-e`;
  return (
    <Disclosure label="Edit" accent={accent}>
      <ApiForm action={`/api/individual/professional/evidence?id=${e.id}`} method="PUT" multipart reset={false} submitLabel="Save changes" accent={accent} savedText="Changes saved.">
        {/* What the item is linked to stays as recorded. */}
        <input type="hidden" name="frameworkId" value={e.framework_id ?? ""} />
        <input type="hidden" name="frameworkCompetencyId" value={e.framework_competency_id ?? ""} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type" htmlFor={`${p}-kind`}><select id={`${p}-kind`} name="kind" required defaultValue={e.kind} className={inputCls}>{EVIDENCE_KIND.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Title" htmlFor={`${p}-title`}><input id={`${p}-title`} name="title" required minLength={3} maxLength={200} defaultValue={e.title} className={inputCls} /></Field>
          <Field label="Issuing body (credentials)" htmlFor={`${p}-body`}><input id={`${p}-body`} name="issuingBody" maxLength={160} defaultValue={e.issuing_body ?? ""} className={inputCls} /></Field>
          <Field label="Date issued or done (optional)" htmlFor={`${p}-issued`}><input id={`${p}-issued`} name="issuedOn" type="date" max={today} defaultValue={d(e.issued_on)} className={inputCls} /></Field>
          <Field label="Expiry date (optional)" htmlFor={`${p}-exp`}><input id={`${p}-exp`} name="expiresOn" type="date" defaultValue={d(e.expires_on)} className={inputCls} /></Field>
          <Field label="Need it supports (optional)" htmlFor={`${p}-need`}>
            <select id={`${p}-need`} name="needId" defaultValue={e.need_id ?? ""} className={inputCls}><option value="">None</option>{needs.map(n => <option key={n.id} value={n.id}>{n.title}</option>)}</select>
          </Field>
          <Field label={e.document_name ? `Replace ${e.document_name} (optional)` : "Attach a document (optional)"} htmlFor={`${p}-doc`} hint={`PDF or image, up to ${DOCUMENT_MAX_LABEL}. Leave empty to keep what is attached.`}>
            <input id={`${p}-doc`} name="document" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className={`${inputCls} py-2.5`} />
          </Field>
        </div>
        <Field label="Description (optional)" htmlFor={`${p}-detail`} hint="Never include patient-identifiable details."><textarea id={`${p}-detail`} name="detail" rows={3} maxLength={5000} defaultValue={e.detail ?? ""} className={inputCls} /></Field>
      </ApiForm>
    </Disclosure>
  );
}

export function GoalEdit({ g, needs, accent }: { g: { id: string; title: string; detail: string | null; target_date: string; need_id: string | null }; needs: { id: string; title: string }[]; accent: string }) {
  const p = `goal-${g.id}-e`;
  return (
    <Disclosure label="Edit" accent={accent}>
      <ApiForm action={`/api/individual/professional/goals?id=${g.id}`} method="PUT" reset={false} submitLabel="Save changes" accent={accent} savedText="Changes saved.">
        <Field label="Goal" htmlFor={`${p}-title`}><input id={`${p}-title`} name="title" required minLength={3} maxLength={200} defaultValue={g.title} className={inputCls} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Target date" htmlFor={`${p}-date`}><input id={`${p}-date`} name="targetDate" type="date" required defaultValue={d(g.target_date)} className={inputCls} /></Field>
          <Field label="Need it serves (optional)" htmlFor={`${p}-need`}>
            <select id={`${p}-need`} name="needId" defaultValue={g.need_id ?? ""} className={inputCls}><option value="">None</option>{needs.map(n => <option key={n.id} value={n.id}>{n.title}</option>)}</select>
          </Field>
        </div>
        <Field label="How you will do it (optional)" htmlFor={`${p}-detail`}><textarea id={`${p}-detail`} name="detail" rows={3} maxLength={2000} defaultValue={g.detail ?? ""} className={inputCls} /></Field>
      </ApiForm>
    </Disclosure>
  );
}

export function NeedEdit({ n, accent }: { n: { id: string; title: string; detail: string | null }; accent: string }) {
  const p = `need-${n.id}-e`;
  return (
    <Disclosure label="Edit" accent={accent}>
      <ApiForm action={`/api/individual/professional/needs?id=${n.id}`} method="PUT" reset={false} submitLabel="Save changes" accent={accent} savedText="Changes saved.">
        <Field label="What do you want to develop?" htmlFor={`${p}-title`}><input id={`${p}-title`} name="title" required minLength={3} maxLength={200} defaultValue={n.title} className={inputCls} /></Field>
        <Field label="Why, or what good looks like (optional)" htmlFor={`${p}-detail`}><textarea id={`${p}-detail`} name="detail" rows={3} maxLength={2000} defaultValue={n.detail ?? ""} className={inputCls} /></Field>
      </ApiForm>
    </Disclosure>
  );
}
