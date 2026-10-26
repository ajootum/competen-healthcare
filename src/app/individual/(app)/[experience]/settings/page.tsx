import { EXPERIENCES, EXPERIENCE_KEYS, experienceHref } from "@/lib/individual/experiences";
import { effectivePrimary } from "@/lib/individual/access";
import { experiencePage, gatedMetadata } from "../../../_components/shell-context";
import type { Metadata } from "next";
import { PageHeader } from "../../../_components/chrome";
import { SignOutButton } from "../../../_components/ShellNav";
import PrimaryChoice from "../../../_components/PrimaryChoice";
import { DATA_ROLES, entityLegal, type EntityLegal } from "@/lib/individual/legal";
import OwnProfileCard from "@/components/account/OwnProfileCard";
import { AiHelpBody, readAiHelp } from "../(scholar)/study/_components/shell-pieces";
import { EraseAll } from "../(scholar)/study/_components/client";
import { listMaterials } from "@/lib/individual/scholar/store";
import { professionalSelfAddEnabled } from "@/lib/individual/professional-add";
import AddProfessional from "../../../_components/AddProfessional";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

const nameOf = (l: EntityLegal) => l.registeredName ?? l.label;

// SETTINGS -- COMPETEN-IND-003 s2(3): the configurable primary experience, and what is active.
//
// It lists both experiences and says which are active, without offering to activate one. Activation is
// a grant (pilot) or, later, graduation or a subscription -- never a toggle on this page.

export async function generateMetadata(): Promise<Metadata> { return gatedMetadata({ title: "Settings" }); }

export default async function SettingsPage({ params }: { params: Promise<{ experience: string }> }) {
  const page = await experiencePage((await params).experience);
  if (!page) return null;
  const { ctx, experience } = page;
  const x = EXPERIENCES[experience];
  const primary = effectivePrimary(ctx.membership.primaryExperience, ctx.live) ?? experience;
  const study = experience === "scholar" ? await listMaterials(ctx.admin, ctx.userId) : null;
  const studyCount = study?.ok ? study.data.length : 0;
  // P5 (prepared, OFF): offered only in Scholar, only without Professional, and only while the server gate is on.
  const canAddProfessional = experience === "scholar" && !ctx.live.includes("professional") && (await professionalSelfAddEnabled(ctx.admin));

  return (
    <>
      <PageHeader accent={x.accent} title="Settings" intro="AI and privacy, reminders, your experiences and your account." />

      {/* HFE-01 Wave 2 (F14): Settings is AI & privacy, Notifications, Experiences, Account -- in that order. The
          Scholar AI consent below is the one consent home; the header chip and My Learning link here. */}

      {/* Scholar HFE redesign: the shell footer's "Privacy & AI controls" lands here. The consent panel is the
          existing one, unchanged: its notice, its version and its one-click withdrawal. */}
      {experience === "scholar" && (
        <section id="privacy" className="mb-5 rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
          <AiHelpBody help={await readAiHelp(ctx.admin, ctx.userId)} />
          <hr className="my-5 border-0 border-t border-gray-200" />
          <h3 className="text-[16px] font-bold text-gray-900">Private by default</h3>
          <p className="mt-1.5 text-[15px] text-gray-600">Your material, answers and practice history are yours. Adding a learning record to your Passport is a separate choice you make.</p>
          {/* HFE-01 Wave 4 (F9): the destructive erase lives here, beside the consent, and only when there is material to erase. */}
          {studyCount > 0 && <div className="mt-5"><EraseAll count={studyCount} /></div>}
        </section>
      )}

      {experience === "professional" && (
        <section id="privacy" className="mb-5 rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
          <h2 className="text-[16px] font-bold text-gray-900">AI &amp; privacy</h2>
          <p className="mt-1.5 text-[14.5px] text-gray-700">Your records are private. Nothing is shared unless you choose it, record by record, on a Passport view. Personal AI answers each question and then forgets it.</p>
          <p className="mt-2 text-[13.5px]"><a href={experienceHref("professional", "assistant")} className="font-semibold underline underline-offset-2" style={{ color: x.accent }}>What Personal AI can see</a></p>
        </section>
      )}

      {ctx.live.includes("professional") && (
        <section id="notifications" className="mb-5 rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
          <h2 className="text-[16px] font-bold text-gray-900">Notifications</h2>
          <p className="mt-1.5 text-[14.5px] text-gray-700">Renewal reminders for your credentials and registrations: in Competen, and by email if you turn that on.</p>
          <p className="mt-2 text-[13.5px]"><a href={`${experienceHref("professional", "evidence")}#reminders`} className="font-semibold underline underline-offset-2" style={{ color: EXPERIENCES.professional.accent }}>Choose your reminders</a></p>
        </section>
      )}

      <section className="mb-5 rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
        <h2 className="text-[16px] font-bold text-gray-900">Experiences on your account</h2>
        <ul className="mt-3 divide-y divide-gray-100">
          {EXPERIENCE_KEYS.map(k => {
            const e = EXPERIENCES[k];
            const on = ctx.live.includes(k);
            return (
              <li key={k} className="flex flex-wrap items-baseline justify-between gap-2 py-3">
                <div>
                  <p className="text-[14.5px] font-semibold" style={{ color: e.accent }}>{e.name}</p>
                  <p className="text-[13px] text-gray-600">{e.micro}</p>
                </div>
                <p className={`text-[12.5px] font-semibold ${on ? "text-green-800" : "text-gray-500"}`}>
                  {on ? (k === primary ? "Active · opens first" : "Active") : "Not active"}
                </p>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-[12.5px] text-gray-500">Competen Individual is in pilot. Experiences are added to your account by Competen.</p>
        {canAddProfessional && <AddProfessional accent={EXPERIENCES.professional.accent} />}
      </section>

      {ctx.live.length > 1 && (
        <section className="mb-5 rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
          <PrimaryChoice live={ctx.live} initial={primary} completeOnboarding={false} submitLabel="Save" />
        </section>
      )}

      <section className="mb-5 rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
        <h2 className="text-[16px] font-bold text-gray-900">Who runs your services</h2>
        <ul className="mt-2 space-y-1.5 text-[14px] text-gray-700">
          <li>{nameOf(entityLegal(DATA_ROLES.sharedFoundation.manager))} manages {DATA_ROLES.sharedFoundation.scope}.</li>
          {EXPERIENCE_KEYS.filter(k => ctx.live.includes(k)).map(k => (
            <li key={k}>{EXPERIENCES[k].name} is operated by {nameOf(entityLegal(DATA_ROLES.experienceService[k]))}.</li>
          ))}
        </ul>
        {!DATA_ROLES.confirmed && <p className="mt-2 text-[12.5px] text-gray-500">These arrangements are pending formal legal confirmation.</p>}
      </section>

      {/* My profile (owner GO 2026-10-23, PR D): the shared personal-profile card, behind this page's
          experiencePage guard. Professional's self-declared registration and credentials are a different
          store (migration 373) and stay on their own pages. */}
      <div className="mb-5">
        <OwnProfileCard credentialsNote={ctx.live.includes("professional")
          ? <>In Competen Professional, your registration and credentials are recorded separately, each labelled self-declared, never verified by this profile.</>
          : undefined} />
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
        <h2 className="text-[16px] font-bold text-gray-900">Account</h2>
        <p className="mt-1 text-[14px] text-gray-700">Signed in as {ctx.profile.email ?? ctx.profile.fullName ?? "your Competen account"}.</p>
        <div className="mt-3"><SignOutButton /></div>
      </section>
    </>
  );
}
