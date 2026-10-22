import { EXPERIENCES, experienceHref } from "@/lib/individual/experiences";
import { EVIDENCE_LABEL, loadIndividualPassport } from "@/lib/individual/passport";
import { OWN_KIND_LABEL } from "@/lib/individual/professional/passport-records";
import { admitToEstate } from "@/lib/platform-membership";
import { estateRolesOf, type AppRole } from "@/lib/roles";
import { experiencePage } from "../../../_components/shell-context";
import { PageHeader, Unreadable, focusRing } from "../../../_components/chrome";

// THE COMPETEN PASSPORT IN COMPETEN INDIVIDUAL -- COMPETEN-IND-003 s2(5).
//
// The person's one existing Passport, read by their own id (src/lib/individual/passport.ts). Every item
// carries its evidence class in TEXT, never colour alone. The same page renders in both experiences
// because the Passport belongs to the person, not to an experience.
//
// ⚠ TWO CLASSES, LABELLED TWO WAYS (COMPETEN-IND-007 s5, owner ruling D3). What organisations issued is
// labelled by issuer. "Records you added" -- the person's own Competen Professional records -- is labelled
// by provenance, and nothing in it ever says verified.
//
// ⚠ SHARING STAYS ON THE EXISTING SURFACE. /dashboard/passport/share mints the revocable /verify links,
// and it sits behind gate 1. A person who also holds gate 1 is pointed there. A person who does not is
// told plainly that sharing from Competen Individual is not available yet -- rather than offered a link
// that bounces, or a second share mechanism that would duplicate the first. A person who holds Competen
// Professional shares from its share page, which mints the SAME passport_share_tokens link.

const fmt = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : null);

export const metadata = { title: "Competen Passport" };

export default async function PassportPage({ params }: { params: Promise<{ experience: string }> }) {
  const page = await experiencePage((await params).experience);
  if (!page) return null;
  const { ctx, experience } = page;
  const x = EXPERIENCES[experience];
  const passport = await loadIndividualPassport(ctx.admin, ctx.userId, new Date().toISOString().slice(0, 10));

  // Pointer only: the share surface re-checks gate 1 itself on arrival.
  const { data: roleRow } = await ctx.admin.from("profiles").select("role, roles").eq("id", ctx.userId).maybeSingle();
  const holdsEstate = (await admitToEstate(ctx.admin, ctx.userId, estateRolesOf(roleRow ?? null) as AppRole[])).admitted;

  const current = passport.competencies?.filter(c => c.current) ?? [];
  const notCurrent = passport.competencies?.filter(c => !c.current) ?? [];

  return (
    <>
      <PageHeader accent={x.accent} eyebrow="Your foundation" title="Competen Passport"
        intro="Your lifelong record of what you know and can do. It is the same Passport in Competen Scholar and Competen Professional, and it stays with you between organisations." />

      <Section title="Assessed competencies" note={`${EVIDENCE_LABEL.institution_issued}. Each one is the latest decision an organisation recorded for you.`}>
        {passport.competencies === null ? <Unreadable what="assessed competencies" />
          : passport.competencies.length === 0 ? <Empty>No assessed competencies on your record yet. When an organisation assesses you through Competen, the decision appears here.</Empty>
            : (
              <ul className="divide-y divide-gray-100">
                {[...current, ...notCurrent].map(c => (
                  <li key={c.competencyId} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
                    <div className="min-w-0">
                      <p className="text-[14.5px] font-semibold text-gray-900">{c.name}</p>
                      <p className="text-[12.5px] text-gray-500">{c.issuer ? `Issued by ${c.issuer}` : "Issuing organisation not recorded"}{c.decidedAt ? ` · ${fmt(c.decidedAt)}` : ""}</p>
                    </div>
                    <p className={`text-[12.5px] font-semibold ${c.current ? "text-green-800" : "text-gray-600"}`}>
                      {c.current ? "Current" : c.outcome.replace(/_/g, " ")}
                      {c.expiryDate ? ` · ${c.current ? "expires" : "expiry"} ${fmt(c.expiryDate)}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
      </Section>

      <Section title="Credentials and registrations" note="Each one says whether an organisation verified it or it was only declared.">
        {passport.credentials === null ? <Unreadable what="credentials" />
          : passport.credentials.length === 0 ? <Empty>No credentials on your record yet.</Empty>
            : (
              <ul className="divide-y divide-gray-100">
                {passport.credentials.map((c, i) => (
                  <li key={`${c.title}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
                    <div className="min-w-0">
                      <p className="text-[14.5px] font-semibold text-gray-900">{c.title}</p>
                      <p className="text-[12.5px] text-gray-500">{[c.issuingBody, c.type.replace(/_/g, " ")].filter(Boolean).join(" · ")}</p>
                    </div>
                    <p className={`text-[12.5px] font-semibold ${c.evidence === "institution_verified" ? "text-green-800" : "text-amber-800"}`}>
                      {EVIDENCE_LABEL[c.evidence]}{c.status !== "active" ? ` · ${c.status.replace(/_/g, " ")}` : ""}{c.expiryDate ? ` · expires ${fmt(c.expiryDate)}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
      </Section>

      <Section title="Employment" note={`${EVIDENCE_LABEL.institution_issued}. Kept after you leave.`}>
        {passport.employment === null ? <Unreadable what="employment history" />
          : passport.employment.length === 0 ? <Empty>No employment recorded through Competen.</Empty>
            : (
              <ul className="divide-y divide-gray-100">
                {passport.employment.map((e, i) => (
                  <li key={`${e.roleTitle}-${i}`} className="py-3">
                    <p className="text-[14.5px] font-semibold text-gray-900">{e.roleTitle}{e.organisation ? `, ${e.organisation}` : ""}</p>
                    <p className="text-[12.5px] text-gray-500">{fmt(e.startDate) ?? "Start not recorded"} – {e.endDate ? fmt(e.endDate) : "present"} · {e.status.replace(/_/g, " ")}</p>
                  </li>
                ))}
              </ul>
            )}
      </Section>

      <Section title="Records you added" note="Recorded by you in Competen Professional. Each one says whether a document is attached. None of them is verified.">
        {passport.own === null ? <Unreadable what="own records" />
          : passport.own.length === 0 ? <Empty>{ctx.live.includes("professional") ? "Nothing yet. Your registration, credentials, competency evidence and CPD from Competen Professional appear here." : "Nothing yet. Records you add in Competen Professional appear here."}</Empty>
            : (
              <ul className="divide-y divide-gray-100">
                {passport.own.map((o, i) => (
                  <li key={`${o.kind}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
                    <div className="min-w-0">
                      <p className="text-[14.5px] font-semibold text-gray-900">{o.title}</p>
                      <p className="text-[12.5px] text-gray-500">{[OWN_KIND_LABEL[o.kind], o.detail, o.date ? fmt(o.date) : null].filter(Boolean).join(" · ")}</p>
                    </div>
                    <p className="text-[12.5px] font-semibold text-amber-800">
                      {EVIDENCE_LABEL[o.evidence]}{o.expires ? ` · ${o.expires < new Date().toISOString().slice(0, 10) ? "expired" : "expires"} ${fmt(o.expires)}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
      </Section>

      <Section title="Sharing">
        {ctx.live.includes("professional") ? (
          <p className="text-[14px] text-gray-700">
            You can share a revocable, time-limited link to this Passport, including the records you added, from{" "}
            <a href={experienceHref("professional", "share")} className={`font-semibold underline underline-offset-2 ${focusRing}`} style={{ color: EXPERIENCES.professional.accent }}>Share your Passport</a>.
          </p>
        ) : holdsEstate ? (
          <p className="text-[14px] text-gray-700">
            You can share a revocable, time-limited verification link from{" "}
            <a href="/dashboard/passport/share" className={`font-semibold underline underline-offset-2 ${focusRing}`} style={{ color: x.accent }}>your Passport sharing page</a>.
          </p>
        ) : (
          <p className="text-[14px] text-gray-700">Sharing your Passport from Competen Individual is not available yet. Nothing is shared with anyone unless you choose to share it.</p>
        )}
      </Section>
    </>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mb-5 rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
      <h2 className="text-[16px] font-bold text-gray-900">{title}</h2>
      {note && <p className="mt-0.5 text-[12.5px] text-gray-500">{note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[14px] text-gray-600">{children}</p>;
}
