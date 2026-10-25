import type { LearningReference } from "@/lib/learning/products";
import { findLearningHref, learningCertificateHref, learningProvenance, learningRecordHref } from "@/lib/individual/professional/learning";
import { focusRing } from "../chrome";
import { fmtDate } from "./bits";

// Completed learning, READ-ONLY, as Professional shows it beside the person's own entries (COMPETEN-LEARNING-01 H1).
// Provenance is always in words. Recorded by the platform is slate, not green: green is kept for what an organisation
// verified, and Learning verifies nothing. A self-declared external completion keeps Professional's amber.

export function LearningProvenance({ r }: { r: LearningReference }) {
  const platform = r.evidenceClass === "platform_recorded";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11.5px] font-semibold ${platform ? "border-slate-300 bg-slate-50 text-slate-800" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
      {learningProvenance(r)}
    </span>
  );
}

export default function LearningRefs({ refs, accent, competencies = false, certificates = false, below }: {
  refs: readonly LearningReference[]; accent: string; competencies?: boolean; certificates?: boolean;
  /** Anything the page shows under one record, for example the person's own reflections on it (LCPD-3). */
  below?: (r: LearningReference) => React.ReactNode;
}) {
  return (
    <ul className="divide-y divide-gray-100">
      {refs.map(r => (
        <li key={r.recordId} className="py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[14.5px] font-semibold text-gray-900">{r.title}</p>
              <p className="text-[12.5px] text-gray-500">
                Course · {fmtDate(r.completedOn) ?? "Completion date not recorded"} · {r.hours == null ? "no hours given" : `${r.hours} ${r.hours === 1 ? "hour" : "hours"}`}
                {r.provider ? ` · ${r.provider}` : ""} · version {r.versionNo}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <LearningProvenance r={r} />
              <a href={learningRecordHref(r.recordId)} className={`text-[12.5px] font-semibold underline underline-offset-2 ${focusRing}`} style={{ color: accent }}>
                Open in Competen Learning
              </a>
            </div>
          </div>
          {competencies && r.competencies.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {r.competencies.map(c => <li key={`${c.id}:${c.relation}`} className="text-[12.5px] text-gray-700">{c.relationLabel}: {c.name}</li>)}
            </ul>
          )}
          {certificates && r.certificates.length > 0 && (
            <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px]">
              {r.certificates.map(c => c.revoked
                ? <span key={c.no} className="text-gray-600">Certificate {c.no}, revoked</span>
                : <a key={c.no} href={learningCertificateHref(c.no)} className={`font-semibold underline underline-offset-2 ${focusRing}`} style={{ color: accent }}>Certificate {c.no}</a>)}
            </p>
          )}
          {below?.(r)}
        </li>
      ))}
    </ul>
  );
}

/**
 * Under a need or goal: completed learning that shares one of its competencies, and where to find more. A reference
 * computed on read (learningForCompetencies). It never marks the need or goal met: only the person does that.
 */
export function LearningServes({ matches, competencies, accent }: {
  matches: readonly LearningReference[]; competencies: readonly { id: string; name: string }[]; accent: string;
}) {
  if (!competencies.length) return null;
  return (
    <div className="mt-2 rounded-lg bg-gray-50 p-3 text-[12.5px] text-gray-700">
      {matches.length > 0 && (
        <>
          <p className="font-semibold text-gray-800">Learning you completed that serves this</p>
          <ul className="mt-0.5 space-y-0.5">
            {matches.map(r => (
              <li key={r.recordId}>
                <a href={learningRecordHref(r.recordId)} className={`underline underline-offset-2 ${focusRing}`} style={{ color: accent }}>{r.title}</a>
                {" "}· {learningProvenance(r)}{r.completedOn ? ` · ${fmtDate(r.completedOn)}` : ""}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-gray-600">Shown because it shares a competency. It does not mark this met: you decide that.</p>
        </>
      )}
      <p className={`flex flex-wrap gap-x-3 gap-y-1 ${matches.length ? "mt-1.5" : ""}`}>
        {competencies.slice(0, 3).map(c => (
          <a key={c.id} href={findLearningHref(c.id)} className={`inline-flex min-h-[24px] pointer-coarse:min-h-[var(--cmp-touch-min)] items-center font-semibold underline underline-offset-2 ${focusRing}`} style={{ color: accent }}>
            Find learning{competencies.length > 1 ? ` for ${c.name}` : ""}
          </a>
        ))}
      </p>
    </div>
  );
}
