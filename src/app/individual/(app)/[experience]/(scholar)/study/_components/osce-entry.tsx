import Link from "next/link";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";
import { osceAvailability } from "@/lib/individual/scholar/osce-service";
import { OSCE_PRACTICE_LABEL, OSCE_UNAVAILABLE } from "@/lib/individual/scholar/osce";
import { withStudy } from "@/lib/individual/scholar/study-carry";

// The way into OSCE practice (SCHOLAR-PRACTICE-EXAMS-01, 720) on the Apply page. Nothing where policy does not offer it.
// Where 720 is not installed here, the card stays and says so plainly, without a link that could not work.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";

export async function OsceEntry({ admin, userId, studyId = null }: { admin: unknown; userId: string; studyId?: string | null }) {
  const a = await osceAvailability(admin, userId);
  if (a.state === "off") return null;
  return (
    <section aria-labelledby="osce-entry-h" className="mb-6 rounded-2xl border border-gray-200 bg-white p-5">
      <h2 id="osce-entry-h" className="text-[16px] font-bold text-gray-900">OSCE practice</h2>
      <p className="mt-1 text-[14px] text-gray-600">Timed practice stations on your own: read the scenario, write what you would say and do, then check yourself against the checklist.</p>
      <p className="mt-1 text-[12.5px] font-semibold text-[var(--cmp-app-text-secondary)]">{OSCE_PRACTICE_LABEL}</p>
      {a.state === "unavailable"
        ? <p className="mt-3 text-[13.5px] text-gray-700">{OSCE_UNAVAILABLE}</p>
        : <Link href={withStudy(experienceHref("scholar", "study/apply/osce"), studyId)} className={`mt-3 inline-flex min-h-[44px] items-center rounded-xl px-4 text-[14px] font-semibold text-white ${focusRing}`} style={{ background: SCHOLAR.accent }}>Practise a station</Link>}
    </section>
  );
}
