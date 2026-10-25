import type { RecordGoal } from "@/lib/individual/professional/record-goals";
import { ApiForm, Field, inputCls } from "./forms";

// The goals one CPD entry or one Competen Learning record served, and linking it to another (LCPD-01 with PLAN-01,
// migration 480). Written through Stage 3's own route (/api/individual/professional/plan-links, kind "record"), which
// links the activity that references the record, or creates one. Nothing about the record is copied or changed.

export default function RecordGoalLink({ subject, served, goals, accent, idPrefix }: {
  subject: { cpdId: string } | { learningRecordId: string };
  served: readonly RecordGoal[]; goals: readonly { id: string; title: string }[]; accent: string; idPrefix: string;
}) {
  const choices = goals.filter(g => !served.some(s => s.goalId === g.id));
  if (!served.length && !choices.length) return null;
  return (
    <div className="mt-2">
      {served.length > 0 && <p className="text-[12.5px] text-gray-700">Serves {served.length === 1 ? "your goal" : "your goals"}: {served.map(s => s.title).join(", ")}</p>}
      {choices.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-[12.5px] font-semibold underline underline-offset-2" style={{ color: accent }}>Link to a goal in your plan</summary>
          <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50 p-4">
            <ApiForm action="/api/individual/professional/plan-links" submitLabel="Link to this goal" accent={accent} savedText="Linked in your development plan.">
              <input type="hidden" name="kind" value="record" />
              {"cpdId" in subject
                ? <input type="hidden" name="cpdId" value={subject.cpdId} />
                : <input type="hidden" name="learningRecordId" value={subject.learningRecordId} />}
              <Field label="Goal" htmlFor={`${idPrefix}-goal`}>
                <select id={`${idPrefix}-goal`} name="goalId" required defaultValue="" className={inputCls}>
                  <option value="" disabled>Choose a goal</option>
                  {choices.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
                </select>
              </Field>
            </ApiForm>
          </div>
        </details>
      )}
    </div>
  );
}
