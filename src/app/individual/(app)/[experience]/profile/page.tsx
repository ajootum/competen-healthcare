import { EXPERIENCES } from "@/lib/individual/experiences";
import { loadIndividualPassport } from "@/lib/individual/passport";
import { buildHistory, loadEntitlementHistory } from "@/lib/individual/history";
import { experiencePage } from "../../../_components/shell-context";
import { PageHeader, Unreadable } from "../../../_components/chrome";

// PROFILE & HISTORY -- COMPETEN-IND-003 s2(4). The shared personal profile and development history.
//
// The profile is the one Competen identity record (profiles), shown read-only. Editing it here is not
// built, and the page says where that happens rather than offering a form. The history is
// src/lib/individual/history.ts: the person's own timeline, identical in both experiences.

const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export const metadata = { title: "Profile & history" };

export default async function ProfilePage({ params }: { params: Promise<{ experience: string }> }) {
  const page = await experiencePage((await params).experience);
  if (!page) return null;
  const { ctx, experience } = page;
  const x = EXPERIENCES[experience];
  const [passport, entitlements] = await Promise.all([
    loadIndividualPassport(ctx.admin, ctx.userId, new Date().toISOString().slice(0, 10)),
    loadEntitlementHistory(ctx.admin, ctx.userId),
  ]);
  const history = buildHistory({ joinedAt: ctx.membership.grantedAt, entitlements, passport });
  const partial = entitlements === null || passport.competencies === null || passport.credentials === null || passport.employment === null;

  const rows: [string, string | null][] = [
    ["Name", ctx.profile.fullName],
    ["Email", ctx.profile.email],
    ["Country", ctx.profile.country],
    ["Experiences", ctx.live.map(k => EXPERIENCES[k].name).join(" and ")],
  ];

  return (
    <>
      <PageHeader accent={x.accent} eyebrow="Your foundation" title="Profile & history"
        intro="One Competen identity and one history, shared by every experience on your account." />

      <section className="mb-5 rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
        <h2 className="text-[16px] font-bold text-gray-900">Your profile</h2>
        <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt className="text-[12px] font-semibold uppercase tracking-wide text-gray-500">{k}</dt>
              <dd className="text-[14.5px] text-gray-900">{v ?? <span className="text-gray-500">Not recorded</span>}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-[12.5px] text-gray-500">Editing your profile from Competen Individual is not available yet.</p>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
        <h2 className="text-[16px] font-bold text-gray-900">Development history</h2>
        <p className="mt-0.5 text-[12.5px] text-gray-500">Newest first. It keeps everything when you graduate, add an experience or return to study.</p>
        {partial && <div className="mt-3"><Unreadable what="full history" /></div>}
        {history.length === 0 ? (
          <p className="mt-3 text-[14px] text-gray-600">Nothing dated on your record yet.</p>
        ) : (
          <ol className="mt-4 space-y-4 border-l-2 pl-5" style={{ borderColor: x.accentSoft }}>
            {history.map((h, i) => (
              <li key={`${h.date}-${i}`} className="relative">
                <span aria-hidden className="absolute -left-[27px] top-1.5 h-3 w-3 rounded-full ring-2 ring-white" style={{ background: x.accent }} />
                <p className="text-[12px] font-semibold text-gray-500"><time dateTime={h.date}>{fmt(h.date)}</time></p>
                <p className="text-[14.5px] font-semibold text-gray-900">{h.title}</p>
                <p className="text-[12.5px] text-gray-600">{[h.detail, h.source].filter(Boolean).join(" · ")}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
