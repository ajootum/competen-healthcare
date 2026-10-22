import { EVIDENCE_LABEL } from "@/lib/individual/passport";
import { OWN_EVIDENCE_DETAIL, isOwnEvidenceClass } from "@/lib/individual/professional/vocabulary";

// Server-rendered pieces shared by the Professional pages.

export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : null;

export function Section({ title, note, children, id }: { title: string; note?: string; children: React.ReactNode; id?: string }) {
  return (
    <section aria-labelledby={id} className="mb-5 rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
      <h2 id={id} className="text-[16px] font-bold text-gray-900">{title}</h2>
      {note && <p className="mt-0.5 text-[12.5px] text-gray-500">{note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[14px] text-gray-600">{children}</p>;
}

/**
 * The evidence class, IN WORDS (COMPETEN-IND-002 s4.2: visible everywhere evidence appears). Amber for
 * both of Professional's own classes -- neither is verified, and green is kept for what an organisation
 * verified. The title attribute carries what the class does not mean.
 */
export function ClassLabel({ value }: { value: string }) {
  if (!isOwnEvidenceClass(value)) return null;
  return (
    <span title={OWN_EVIDENCE_DETAIL[value]} className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11.5px] font-semibold text-amber-900">
      {EVIDENCE_LABEL[value]}
    </span>
  );
}

/** A note for a store that is not set up on this environment (migration 373 not applied). */
export function NotProvisioned() {
  return (
    <p className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13.5px] text-amber-900">
      The Competen Professional record is not set up on this environment yet, so nothing can be saved here. Nothing on your account is affected.
    </p>
  );
}
