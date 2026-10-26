import type { SupabaseClient } from "@supabase/supabase-js";
import { SCHOLAR } from "@/lib/individual/experiences";
import { readConsent } from "@/lib/individual/scholar/store";
import { consentDocuments, consentStatus, type ConsentStatus } from "@/lib/individual/scholar/consent-gate";
import { SCHOLAR_STAGES } from "@/lib/individual/scholar/spaces";
import { DialogButton } from "../../../../../_components/Dialog";
import { Unreadable } from "../../../../../_components/chrome";
import { ConsentPanel } from "./client";

// The Scholar shell's own pieces (HFE redesign, 2026-10-26): the AI help switch at the right of every page
// heading, and the eight-stage journey. Server components: each reads what it shows, and the dialogs they
// open hold the existing panels unchanged -- the consent notice, its wording and its withdrawal included.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
export const headerBtn = `inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-[9px] border border-gray-200 bg-white px-4 py-2.5 text-[15px] font-semibold text-gray-900 hover:bg-[#e9f7f8] disabled:opacity-50 ${focusRing}`;
export const linkBtn = `inline-flex min-h-[32px] items-center text-left text-[15px] font-semibold underline-offset-2 hover:underline ${focusRing}`;

const LABEL: Record<ConsentStatus, string> = {
  on: "AI help on", off: "AI help off", outdated: "AI help: agree again", awaiting_legal: "AI help off",
};

/** The person's AI help, read from their own consent record (consent-gate.ts decides what it means). */
export async function readAiHelp(admin: SupabaseClient, userId: string) {
  const consent = await readConsent(admin, userId);
  const documents = consentDocuments();
  return { consent, documents, status: consent.ok ? consentStatus(consent.data, documents.published) : null };
}

/** The consent panel and what AI help does and does not change. Used by the heading switch and the Library. */
export function AiHelpBody({ help }: { help: Awaited<ReturnType<typeof readAiHelp>> }) {
  const { consent, documents, status } = help;
  return (
    <>
      <h2 className="text-[21px] font-bold tracking-tight text-gray-900">AI help with your material</h2>
      <p className="mt-2 text-[15px] leading-relaxed text-gray-600">
        Reading your material and what you have already saved stay available with AI help off. Turning it off stops new AI requests; it does not delete your material.
      </p>
      <div className="mt-4">
        {consent.ok
          ? <ConsentPanel status={status!} recorded={consent.data.granted} grantedAt={consent.data.grantedAt} revokedAt={consent.data.revokedAt} legal={documents.links} />
          : consent.notProvisioned
            ? <p className="text-[14px] text-gray-700">AI help is not set up here yet. Nothing on your account has changed.</p>
            : <Unreadable what="AI consent setting" />}
      </div>
    </>
  );
}

/** The switch at the right of every Scholar page heading. Its label is the person's state, in words. */
export async function AiHelpSwitch({ admin, userId }: { admin: SupabaseClient; userId: string }) {
  const help = await readAiHelp(admin, userId);
  const label = help.status ? LABEL[help.status] : "AI help";
  return (
    <DialogButton title="AI help with your material" className={headerBtn}
      label={<><span aria-hidden style={{ color: SCHOLAR.accent }}>✦</span>{label}</>}>
      <AiHelpBody help={help} />
    </DialogButton>
  );
}

/** docs/COMPETEN-SCHOLAR-PRODUCT-ARCHITECTURE.md: a flexible model, never an eight-screen wizard. */
export function JourneyButton({ label = "Your learning journey ↗", className = linkBtn }: { label?: string; className?: string }) {
  return (
    <DialogButton title="Your eight-stage learning journey" className={className} style={{ color: SCHOLAR.accent }} label={label}>
      <h2 className="text-[21px] font-bold tracking-tight text-gray-900">Your eight-stage learning journey</h2>
      <p className="mt-1.5 text-[15px] text-gray-600">A flexible model, not an eight-screen wizard.</p>
      <ol className="my-3 flex flex-wrap gap-2" aria-label="The eight stages">
        {SCHOLAR_STAGES.map(s => <li key={s.name} className="rounded-md bg-[#f2f6f7] px-2.5 py-1 text-[12px] text-gray-900">{s.name}</li>)}
      </ol>
      <dl className="space-y-2 text-[14px] leading-relaxed">
        {SCHOLAR_STAGES.map(s => (
          <div key={s.name}><dt className="inline font-bold text-gray-900">{s.name}. </dt><dd className="inline text-gray-600">{s.summary}</dd></div>
        ))}
      </dl>
      <p className="mt-4 text-[15px] text-gray-600">Move between Learn, Revise, Apply, Evaluate and Progress whenever useful. You do not need to finish one to open another.</p>
    </DialogButton>
  );
}
