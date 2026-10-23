import Link from "next/link";
import { experienceHref } from "@/lib/individual/experiences";
import type { DueItem } from "@/lib/individual/professional/renewals";
import { focusRing } from "../chrome";
import { fmtDate } from "./bits";

// The in-app reminder (COMPETEN-IND-007, migration 374): renewals due within the horizon, from the dates the
// person recorded. Rendered only while the person's in-app switch is on (the caller decides), and only
// inside Competen Professional -- never as an estate notification.

export function RenewalsDue({ items, today, linkToEvidence = false }: { items: DueItem[]; today: string; linkToEvidence?: boolean }) {
  if (!items.length) return null;
  return (
    <section aria-label="Renewals due" className="mb-5 rounded-2xl border border-amber-300 bg-amber-50 p-5">
      <h2 className="text-[15px] font-bold text-amber-900">Renewals due</h2>
      <ul className="mt-2 space-y-1 text-[14px] text-amber-900">
        {items.map(i => (
          <li key={`${i.kind}-${i.id ?? "registration"}`}>
            {i.title} {i.expiresOn < today ? "expired" : i.kind === "registration" ? "renews" : "expires"} on {fmtDate(i.expiresOn)}.
            {i.kind === "registration" && <> <Link href={experienceHref("professional", "registration")} className={`font-semibold underline ${focusRing}`}>Update it</Link></>}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[12.5px] text-amber-900/80">
        From the dates you recorded. Competen has not checked them with the issuer and does not know your regulator&apos;s renewal rules.
        {linkToEvidence && <> <Link href={experienceHref("professional", "evidence")} className={`font-semibold underline ${focusRing}`}>Credentials & evidence</Link></>}
      </p>
    </section>
  );
}
