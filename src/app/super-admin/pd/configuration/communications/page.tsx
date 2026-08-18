import Link from "next/link";
import { requireHqCapability } from "@/lib/hq/context";
import { domain, LADDER, refusalFor } from "@/lib/hq/pd-configuration";
import {
  ConfigHeader, Panel, Warn, Explain, Cite, DomainSections, RungSummary, NoReadNote, NotThisModule,
} from "../_components/config-ui";

// CPR-PD-011 §12 — COMMUNICATIONS.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 §7).
//
// ⚠ TWO THINGS ON THIS PAGE ARE CORRECTIONS TO THE SPECIFICATION'S OWN EXAMPLE LIST, AND BOTH MATTER.
//
//   ONE. §12 lists "email/SMS/WhatsApp/push" as the preference hierarchy. This product has TWO channel
//   kinds: practice_message_channel.kind is constrained to (sms, email). WhatsApp and push are not
//   disabled features, they are concepts the product does not have — so rendering a preference row for
//   them would invent a channel. There IS a table whose channel list mentions WhatsApp
//   (practice_contact_log), and it is a HUMAN CONTACT RECORD: its own comment says nothing there sends
//   anything, and its `whatsapp_external` value means a phone outside this product entirely. Mixing it
//   into channel configuration would be the sharpest available mistake in this domain.
//
//   TWO. §12 says Product Configuration must not activate an undeployed channel and that Releases &
//   Capabilities is authoritative. That is a boundary this page states and links, rather than a warning
//   it repeats — the whole reason a configuration screen is dangerous here is that enabling a channel
//   and deploying one look identical to a reader.

export const dynamic = "force-dynamic";

const D = domain("communications")!;

export default async function Page() {
  await requireHqCapability("hq.practice.configuration.view");

  return (
    <div data-wide className="space-y-4">
      <ConfigHeader
        title="Communications"
        purpose="Channel, notification, reminder and message behaviour — what the product can be configured to send, and the boundary between configuring a channel and deploying one."
        spec="CPR-PD-011 §12"
      />

      <Warn title="Configuring a channel is not deploying one, and they look the same on a screen">
        <p>
          §12 is explicit: Product Configuration must not activate an undeployed channel, and Releases
          &amp; Capabilities is authoritative for whether a capability is available at all. A switch
          reading &quot;SMS reminders: on&quot; is indistinguishable from a working SMS integration, and
          only one of them sends anything.{" "}
          <Link href="/super-admin/pd/releases/capabilities" className="font-semibold text-teal-700 hover:underline">
            Capabilities
          </Link>{" "}
          answers whether a channel exists; this module would only answer how it behaves once it does.
        </p>
      </Warn>

      <Panel title="The channels this product actually has"
        note="The channel list is constrained by the database to exactly two values. That is not a shortlist of what has been switched on — it is the whole vocabulary the product has.">
        <ul className="flex flex-col gap-2 text-[12px] leading-relaxed text-gray-700">
          <li>
            <span className="font-semibold text-gray-900">SMS</span> and{" "}
            <span className="font-semibold text-gray-900">email</span> — per workspace, each with an
            enabled flag, who enabled it and when, whether consent is required, and a sender identity.
          </li>
          <li>
            <span className="font-semibold text-[var(--cmp-text-critical)]">WhatsApp and push do not exist.</span>{" "}
            §12&apos;s example list names them; the channel enum does not. They are not disabled
            features awaiting a switch — the product has no concept of either, so a preference row for
            them would be inventing a channel rather than showing a disabled one.
          </li>
        </ul>
        <Explain summary="The look-alike table that must not be mistaken for a channel">
          practice_contact_log records that a HUMAN contacted somebody — its own comment states that
          nothing there sends anything — and its channel values include{" "}
          <span className="font-mono text-[11px]">whatsapp_external</span>, meaning a phone outside this
          product. It is a record of a conversation, not a delivery. Counting it as messaging
          configuration or as delivery telemetry would produce a WhatsApp channel that this product has
          never had.
        </Explain>
        <Cite>practice_message_channel.kind, constrained at migration 224:40-63.</Cite>
      </Panel>

      <Panel title="Handed over is not delivered, and the code already says so"
        note="A pre-existing honesty commitment in the Practice messaging engine that any configuration surface must not undo.">
        <p className="text-[12px] leading-relaxed text-gray-700">
          The message store distinguishes <span className="font-mono text-[11px]">queued</span>,{" "}
          <span className="font-mono text-[11px]">handed_over</span>,{" "}
          <span className="font-mono text-[11px]">failed</span> and{" "}
          <span className="font-mono text-[11px]">refused</span>, and keeps{" "}
          <span className="font-mono text-[11px]">delivery_confirmed_at</span> for a real receipt only.
          Where a channel cannot report one, the engine says receipts are unavailable rather than letting
          a null read as failure.{" "}
          <span className="font-semibold">
            A retry or suppression rule configured against the wrong one of those states would retry
            messages that arrived, or suppress messages that never did.
          </span>{" "}
          §12&apos;s retry and suppression parameters therefore depend on a distinction this module must
          preserve and does not own.
        </p>
      </Panel>

      <Panel title="Secrets are never editable here (§12, §31)"
        note="Stated as a standing rule rather than as a note about this build.">
        <p className="text-[12px] leading-relaxed text-gray-700">
          Provider credentials, API keys and sender secrets are not configuration in this module&apos;s
          sense and never appear on a Product Director surface. §31 puts it as a non-goal — not a
          secrets-management console — and §12 repeats it for this domain specifically. A sender
          IDENTITY (the from-name a patient sees) is product behaviour; the credential that authorises
          the send is not.
        </p>
      </Panel>

      <RungSummary rungs={LADDER} />
      <DomainSections domain={D} refusalWhy={refusalFor("cfg.practice_domain_settings").why} />

      <NotThisModule>
        §23: whether a channel is deployed is Releases &amp; Capabilities&apos;. §24: queue depth,
        hand-over rate, delivery confirmation and failure analysis are Product Health&apos;s — that
        telemetry is genuinely instrumented and it is 008G&apos;s subject, not this module&apos;s.
      </NotThisModule>

      <NoReadNote why="Every channel and messaging store is on the Practice plane and refused to it." />
    </div>
  );
}
