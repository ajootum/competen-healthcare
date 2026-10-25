import { IMPACT_LABEL, NOT_VERIFIED_IMPACT, type LearningReflection } from "@/lib/individual/professional/learning-reflections";
import { ApiButton } from "./forms";
import { fmtDate } from "./bits";

// The person's own reflections on one CPD entry or learning record (LCPD-01 LCPD-3), with the impact they report, which
// they may change. Private: rendered only on their own Learning & CPD page.

export default function LearningReflectionList({ items }: { items: readonly LearningReflection[] }) {
  if (!items.length) return null;
  return (
    <ul className="mt-2 space-y-2">
      {items.map(r => (
        <li key={r.linkId} className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-gray-500">{r.templateLabel ?? "Reflection"} · {fmtDate(r.createdAt)} · private</p>
          <p className="mt-1 whitespace-pre-wrap text-[13.5px] leading-relaxed text-gray-800">{r.body}</p>
          <p className="mt-1.5 text-[12.5px] text-gray-700"><span className="font-semibold">{IMPACT_LABEL[r.impact]}.</span> {NOT_VERIFIED_IMPACT}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {(["completed", "understood", "applied"] as const).filter(i => i !== r.impact).map(i => (
              <ApiButton key={i} action="/api/individual/professional/learning-reflections" method="PATCH" body={{ id: r.linkId, impact: i }} label={`Change to: ${IMPACT_LABEL[i].toLowerCase()}`} />
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}
