import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { audit } from "@/lib/practice/audit";
import type { EngineResult } from "@/lib/practice/encounters";
import { type WorkspaceContext } from "@/lib/practice/access";
import { formatDateTime } from "@/lib/datetime";
// The sender resolvers live with the platform dispatcher because that is where the older of the two
// variable names was introduced. Importing them rather than restating the fallback chain is the point:
// a second copy is how the two stacks drifted apart in the first place.
import { emailFrom, smsFrom, resendEmailBody } from "@/lib/notifications/dispatch";

// THE DELIVERY CHANNEL -- PIS-000 s11/s14, IAM-000 s3/s7, CPR-PRM-001 s10.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE CALLER NAMES A PURPOSE AND SUPPLIES PARAMETERS. IT NEVER SUPPLIES PROSE.
//
// An SMS is unencrypted and arrives on whatever handset holds that number -- a shared family phone, a
// stolen one, a work one. A diagnosis, a result, or even an appointment reason in a text message is a
// disclosure to whoever picks it up. So the body is composed HERE, from a fixed template, and there is
// no code path anywhere that puts caller-supplied text into a patient's message.
//
// "handed over" IS NOT "delivered". A provider accepting an SMS is not a phone buzzing in a pocket, and
// every product that calls the first one "sent" is overstating. The column is handed_to_provider_at;
// delivery_confirmed_at is set only from a real receipt, and where a channel cannot report one the
// engine says receiptsAvailable:false rather than letting a null read as failure.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

const nowIso = () => new Date().toISOString();

export type MessageKind = "sms" | "email" | "whatsapp";

/**
 * WHATSAPP IS A KIND, NOT A TRANSPORT FOR SMS. It carries its own consent, its own sender identity, its
 * own provider and its own refusals. A practice that switched SMS on has not agreed to message patients
 * on WhatsApp, and a patient who consented to a text has not consented to a business account writing to
 * them. Folding it into "sms" would make both of those consents unrepresentable.
 */

/**
 * Which provider, if any.
 *
 * Shaped like aiStatus(): the rest of the product asks whether a channel is configured and degrades
 * honestly when it is not, rather than discovering it at the moment somebody is waiting for a code.
 */
export function messagingStatus(): {
  sms: { configured: boolean; provider: string | null; receiptsAvailable: boolean };
  email: { configured: boolean; provider: string | null; receiptsAvailable: boolean };
  whatsapp: { configured: boolean; provider: string | null; receiptsAvailable: boolean };
} {
  const twilio = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
  const africas = !!(process.env.AFRICASTALKING_API_KEY && process.env.AFRICASTALKING_USERNAME);
  // A KEY WITHOUT A SENDER IS NOT A CONFIGURED PROVIDER. This read the api key alone, so a deployment
  // with a key and no from-address reported "configured" and then sent from no-reply@example.invalid,
  // which Resend rejects. The platform's channelProviders() has always required both -- this matches it.
  //
  // emailFrom()/smsFrom() accept EITHER stack's variable name (RESEND_FROM or NOTIFY_FROM_EMAIL,
  // TWILIO_FROM or TWILIO_FROM_NUMBER) so that one value configures both. See their definitions in
  // src/lib/notifications/dispatch.ts for why there were ever two.
  const resend = !!(process.env.RESEND_API_KEY && emailFrom());
  const whatsapp = !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);

  return {
    sms: {
      configured: twilio || africas,
      provider: twilio ? "twilio" : africas ? "africastalking" : null,
      // NEITHER GATEWAY REPORTS DELIVERY WITHOUT A WEBHOOK THIS DEPLOYMENT DOES NOT HOST. Stated as a
      // field rather than implied by a delivery_confirmed_at that is always null.
      receiptsAvailable: false,
    },
    email: { configured: resend, provider: resend ? "resend" : null, receiptsAvailable: false },
    // Meta WhatsApp Cloud API. A token without a phone number id cannot send, so both are required --
    // the same rule the other two channels learned the hard way.
    whatsapp: {
      configured: whatsapp,
      provider: whatsapp ? "whatsapp_cloud" : null,
      // WhatsApp DOES emit delivery and read receipts, but only to a webhook this deployment does not
      // host. Reporting true here would make delivery_confirmed_at read as a failure forever.
      receiptsAvailable: false,
    },
  };
}

// ── THE TEMPLATES. The only things that can reach a patient. ──────────────────────────────────────────

type TemplateArgs = Record<string, string | number>;

/**
 * THE WORDS BELOW ARE NOT THE WORDS WHATSAPP SENDS, and that is a fact about WhatsApp rather than a
 * shortcut taken here. Meta only permits a business to OPEN a conversation with a template it approved
 * in advance, so what reaches the handset is Meta's stored copy. `body` remains our rendering of the
 * same template -- the best evidence available, and not a transcript. `whatsapp.template` records which
 * approved template was invoked so a disputed message can be traced to the version Meta held.
 *
 * THE ORDER OF `params` IS THE CONTRACT. Meta addresses variables positionally as {{1}}, {{2}}, so a
 * reordering here silently swaps a date for a practitioner name on a real patient's phone. The tests
 * pin the order against the body text for exactly that reason.
 */
const TEMPLATES: Record<string, {
  kinds: MessageKind[];
  subject?: (a: TemplateArgs) => string;
  body: (a: TemplateArgs) => string;
  whatsapp?: { template: string; params: (a: TemplateArgs) => string[] };
}> = {
  otp_booking: {
    kinds: ["sms", "email", "whatsapp"],
    subject: () => "Your booking code",
    // NO PRACTICE NAME, NO PRACTITIONER NAME, NO REASON FOR THE APPOINTMENT. Somebody reading this over
    // a shoulder learns a six-digit number and nothing about the person it was sent to.
    body: a => `${a.code} is your booking code. It expires in ${a.minutes} minutes. Do not share it.`,
    whatsapp: { template: "otp_booking", params: a => [String(a.code), String(a.minutes)] },
  },
  otp_sign_in: {
    kinds: ["sms", "email", "whatsapp"],
    subject: () => "Your sign-in code",
    body: a => `${a.code} is your sign-in code. It expires in ${a.minutes} minutes. Do not share it.`,
    whatsapp: { template: "otp_sign_in", params: a => [String(a.code), String(a.minutes)] },
  },
  appointment_confirmation: {
    kinds: ["sms", "email", "whatsapp"],
    subject: () => "Your appointment",
    // THE DATE AND TIME, AND WHO WITH. Not why -- "your oncology follow-up" on a lock screen is a
    // disclosure the patient did not choose.
    body: a => `Your appointment with ${a.practitioner} is confirmed for ${a.when}.`,
    whatsapp: { template: "appointment_confirmation", params: a => [String(a.practitioner), String(a.when)] },
  },
  appointment_reminder: {
    kinds: ["sms", "email", "whatsapp"],
    subject: () => "Appointment reminder",
    body: a => `Reminder: your appointment with ${a.practitioner} is on ${a.when}.`,
    whatsapp: { template: "appointment_reminder", params: a => [String(a.practitioner), String(a.when)] },
  },
  appointment_cancelled: {
    kinds: ["sms", "email", "whatsapp"],
    subject: () => "Appointment cancelled",
    body: a => `Your appointment with ${a.practitioner} on ${a.when} has been cancelled.`,
    whatsapp: { template: "appointment_cancelled", params: a => [String(a.practitioner), String(a.when)] },
  },
  invitation_code: {
    kinds: ["email"],
    subject: () => "You have been invited to a practice",
    body: a => `You have been invited to join ${a.practice}. Your invitation code is ${a.code}. It expires on ${a.expires}.`,
  },
};

export const MESSAGE_PURPOSES = Object.keys(TEMPLATES);

// ── MESSAGE-TYPE PREFERENCES (CPR-SET-COMMS-001 s7) ──────────────────────────────────────────────────
//
// Per practice, per channel, keyed by message type, stored as jsonb on the channel row. AN ABSENT KEY
// MEANS ON: the default posture is that a patient is told what happened to their appointment, and
// switching a message off is a deliberate recorded act.
//
// BOOKING VERIFICATION CODES HAVE NO KEY HERE, ON PURPOSE. issueOtp never consults preferences, so
// "verification off" is not a forbidden value but an unrepresentable one -- a required transactional
// message cannot be disabled where doing so would break the workflow (s2).

export const CONFIGURABLE_MESSAGE_TYPES = {
  booking_confirmation: "booking confirmations",
  cancellation_notice: "cancellation notices",
  rescheduling_notice: "rescheduling notices",
} as const;
export type MessagePreferenceKey = keyof typeof CONFIGURABLE_MESSAGE_TYPES;

/** The message types a practice cannot switch off, each with the sentence a screen refuses with. */
export const REQUIRED_MESSAGE_TYPES = {
  booking_verification: "Booking verification codes are required for online booking and cannot be switched off.",
} as const;

/** Pure, so a screen and a test can ask the same question the service refuses with. */
export function validatePreferencePatch(patch: Record<string, unknown>):
  | { ok: true; clean: Partial<Record<MessagePreferenceKey, boolean>> }
  | { ok: false; message: string } {
  const clean: Partial<Record<MessagePreferenceKey, boolean>> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (key in REQUIRED_MESSAGE_TYPES)
      return { ok: false, message: REQUIRED_MESSAGE_TYPES[key as keyof typeof REQUIRED_MESSAGE_TYPES] };
    if (!(key in CONFIGURABLE_MESSAGE_TYPES))
      return { ok: false, message: `"${key}" is not a message type this practice can configure` };
    if (typeof value !== "boolean")
      return { ok: false, message: `${key} must be true or false` };
    clean[key as MessagePreferenceKey] = value;
  }
  return { ok: true, clean };
}

/**
 * The email channel's state as a practitioner sees it (CPR-SET-COMMS-001 s6). DERIVED, NEVER STORED:
 * computed from configuration and service health at read time, so it cannot go stale and cannot be
 * set by hand. A row with identity saved but the channel never activated is still SETUP_REQUIRED --
 * saving valid settings is what activates it, and half-saved is not active.
 */
export function emailChannelState(c: {
  enabled: boolean; senderName: string | null; providerConfigured: boolean;
}): "SETUP_REQUIRED" | "ACTIVE" | "ACTION_NEEDED" {
  if (!c.senderName?.trim() || !c.enabled) return "SETUP_REQUIRED";
  return c.providerConfigured ? "ACTIVE" : "ACTION_NEEDED";
}

// ── CHANNEL SETTINGS ─────────────────────────────────────────────────────────────────────────────────

export async function channelSettings(admin: any, workspaceId: string) {
  const { data } = await admin.from("practice_message_channel")
    .select("*").eq("workspace_id", workspaceId);
  const rows = (data ?? []) as any[];
  const status = messagingStatus();

  return (["sms", "email", "whatsapp"] as MessageKind[]).map(kind => {
    const row = rows.find(r => r.kind === kind);
    return {
      kind,
      enabled: !!row?.enabled,
      senderName: row?.sender_name ?? null,
      senderAddress: row?.sender_address ?? null,
      // FOR EMAIL, sender_address IS the reply-to (CPR-SET-COMMS-001 s3.1). The from-address is
      // platform-managed, so the one address a practice owns on this channel is where replies land.
      replyTo: row?.sender_address ?? null,
      // Absent column (pre-migration-361) and absent keys both read as {} -- every message type on.
      messagePreferences: (row?.message_preferences ?? {}) as Partial<Record<MessagePreferenceKey, boolean>>,
      requireConsent: row?.require_consent ?? true,
      enabledAt: row?.enabled_at ?? null,
      // WHETHER A PROVIDER EXISTS AT ALL, kept separate from whether the practice switched it on -- so
      // "it is on but nothing arrives" has a visible cause.
      providerConfigured: status[kind].configured,
      provider: status[kind].provider,
      receiptsAvailable: status[kind].receiptsAvailable,
      usable: !!row?.enabled && status[kind].configured,
    };
  });
}

/** Syntax only. Nothing here claims the mailbox exists -- "Saved" is the only state this can grant. */
const EMAIL_SYNTAX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function setChannel(admin: any, ctx: WorkspaceContext, args: {
  kind: MessageKind; enabled: boolean; senderName?: string; senderAddress?: string;
  /** Where a patient's reply lands (CPR-SET-COMMS-001 s3.1). Email only. Stored as sender_address. */
  replyTo?: string;
  requireConsent?: boolean; correlationId: string;
}): Promise<EngineResult<{ enabled: boolean }>> {
  if (!ctx.capabilities.includes("practice.settings.manage"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "practice.settings.manage is required" };
  if (args.kind !== "sms" && args.kind !== "email" && args.kind !== "whatsapp")
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "kind must be sms, email or whatsapp" };

  // A CHANNEL WITHOUT A SENDER IDENTITY PHISHES ITS OWN PATIENTS. "Your code is 481920" from an unknown
  // number is indistinguishable from a scam, and teaching patients to trust those is worse than not
  // sending at all.
  if (args.enabled && !(args.senderName ?? "").trim())
    return {
      ok: false, status: 422, code: "SENDER_REQUIRED",
      message: "give the sender a name -- a code from an unknown number is indistinguishable from a scam",
    };

  // s8: a reply-to that is not an address sends every patient reply nowhere. Optional, so empty
  // clears it -- only a non-empty value has a syntax to fail.
  const replyTo = args.replyTo?.trim() ?? "";
  if (args.replyTo !== undefined && replyTo && !EMAIL_SYNTAX.test(replyTo))
    return {
      ok: false, status: 422, code: "VALIDATION_ERROR",
      message: "the reply-to address is not a valid email address",
    };

  const { data: existing } = await admin.from("practice_message_channel")
    .select("id, enabled, sender_name, sender_address").eq("workspace_id", ctx.workspaceId).eq("kind", args.kind).maybeSingle();

  const patch = {
    workspace_id: ctx.workspaceId, kind: args.kind, enabled: args.enabled,
    sender_name: args.senderName?.trim() || null,
    sender_address: args.replyTo !== undefined ? (replyTo || null) : (args.senderAddress?.trim() || null),
    require_consent: args.requireConsent ?? true,
    enabled_at: args.enabled ? nowIso() : null,
    enabled_by: args.enabled ? ctx.userId : null,
  };

  const { error } = existing
    ? await admin.from("practice_message_channel").update(patch).eq("workspace_id", ctx.workspaceId).eq("id", existing.id)
    : await admin.from("practice_message_channel").insert(patch);
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  // s9: WHICH CATEGORY OF THING CHANGED, without the values. Sender identity and reply-to are audit
  // categories in their own right, not just riders on an enable/disable event.
  const changed: string[] = [];
  if ((existing?.enabled ?? false) !== args.enabled) changed.push("channel_state");
  if ((existing?.sender_name ?? null) !== patch.sender_name) changed.push("sender_name");
  if ((existing?.sender_address ?? null) !== patch.sender_address) changed.push("reply_to");

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId,
    eventType: args.enabled ? "practice.channel_enabled" : "practice.channel_disabled",
    payload: { kind: args.kind, changed }, correlationId: args.correlationId,
  });
  return { ok: true, data: { enabled: args.enabled } };
}

/**
 * Which of the configurable message types this practice sends (CPR-SET-COMMS-001 s3.2).
 *
 * A MERGE, NEVER A REPLACE: the caller names only the keys it is changing, so two screens saving
 * different preferences cannot silently reset each other. Required message types are refused by
 * validatePreferencePatch before anything is read -- there is no code path that stores a value for
 * them, which is what makes "verification off" unrepresentable rather than merely forbidden.
 */
export async function setMessagePreferences(admin: any, ctx: WorkspaceContext, args: {
  kind: MessageKind; preferences: Record<string, unknown>; correlationId: string;
}): Promise<EngineResult<{ preferences: Partial<Record<MessagePreferenceKey, boolean>> }>> {
  if (!ctx.capabilities.includes("practice.settings.manage"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "practice.settings.manage is required" };
  if (args.kind !== "sms" && args.kind !== "email" && args.kind !== "whatsapp")
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "kind must be sms, email or whatsapp" };

  const v = validatePreferencePatch(args.preferences);
  if (!v.ok) return { ok: false, status: 422, code: "PREFERENCE_REFUSED", message: v.message };
  if (Object.keys(v.clean).length === 0)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "no preference was named" };

  const { data: existing, error: readErr } = await admin.from("practice_message_channel")
    .select("id, message_preferences").eq("workspace_id", ctx.workspaceId).eq("kind", args.kind).maybeSingle();
  if (readErr)
    return {
      ok: false, status: 503, code: "CHANNEL_UNREADABLE",
      message: `nothing was changed because the channel could not be read: ${readErr.message}`,
    };
  // Preferences attach to a configured channel. Storing "cancellation notices off" for a channel that
  // does not exist yet would be a setting with nothing to be a setting of.
  if (!existing)
    return {
      ok: false, status: 409, code: "CHANNEL_NOT_CONFIGURED",
      message: "save the channel settings first -- preferences attach to a configured channel",
    };

  const merged = { ...((existing.message_preferences ?? {}) as Record<string, boolean>), ...v.clean };
  const { error } = await admin.from("practice_message_channel")
    .update({ message_preferences: merged }).eq("id", existing.id);
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId,
    eventType: "practice.channel_preferences_changed",
    payload: { kind: args.kind, changed: v.clean }, correlationId: args.correlationId,
  });
  return { ok: true, data: { preferences: merged } };
}

// ── SENDING ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * Every reason this product declines to send, in the order they are checked.
 *
 * ORDER MATTERS: consent is checked before the provider is, so a practice that never asked the patient
 * gets told that rather than "the gateway is down" -- the second is fixable by an engineer, the first
 * is not.
 */
async function refusalFor(admin: any, workspaceId: string, args: {
  kind: MessageKind; destination: string; patientId?: string | null;
  preferenceKey?: MessagePreferenceKey;
}, channel: Awaited<ReturnType<typeof channelSettings>>[number]): Promise<string | null> {
  if (!args.destination.trim()) return "no destination was recorded for this person";

  if (!channel.enabled) return `this practice has not switched on ${args.kind}`;

  // s3.2: A MESSAGE TYPE THE PRACTICE SWITCHED OFF IS A REFUSAL WITH THE PRACTICE'S OWN REASON ON IT,
  // recorded as a row like every other. Only an EXPLICIT false refuses -- an absent key means on.
  // Verification codes never pass a preferenceKey at all, so no preference can suppress one.
  if (args.preferenceKey && channel.messagePreferences?.[args.preferenceKey] === false)
    return `this practice switched off ${CONFIGURABLE_MESSAGE_TYPES[args.preferenceKey]}`;

  if (args.patientId) {
    // ⚠ WORKSPACE-SCOPED, and it was not until 2026-08-12. This read decides whether a person may be
    // contacted -- "do not contact" and merged-record both refuse from here -- and it was keyed on a
    // patient id alone, in a function that HAS workspaceId as a parameter. Not exploitable through any
    // caller today (every one derives patientId from a workspace-scoped read), but a consent gate that
    // trusts an unverified id is one refactor away from consulting the wrong patient's wishes.
    const { data: patient } = await admin.from("practice_patient")
      .select("preferred_contact_method, status")
      .eq("id", args.patientId).eq("workspace_id", workspaceId).maybeSingle();
    // "DO NOT CONTACT" MEANS DO NOT CONTACT, and it outranks every other setting including the
    // practice's own. CPR-PRM-001 s4 recorded this preference; this is the line that honours it.
    if (patient?.preferred_contact_method === "none")
      return "this patient asked not to be contacted";
    if (patient?.status === "merged")
      return "this record has been merged into another";

    if (channel.requireConsent) {
      const { data: consent } = await admin.from("practice_patient_consent")
        .select("state").eq("patient_id", args.patientId).eq("workspace_id", workspaceId)
        .eq("consent_type", "contact_by_practice")
        .order("recorded_at", { ascending: false }).limit(1).maybeSingle();
      const state = consent?.state ?? "not_recorded";
      if (state !== "given")
        return state === "not_recorded"
          ? "this patient has not been asked whether the practice may contact them"
          : `this patient has ${state} consent to be contacted`;
    }
  }

  if (!channel.providerConfigured) return `no ${args.kind} provider is configured for this deployment`;
  return null;
}

/**
 * Hand a templated message to the provider.
 *
 * THE REFUSAL IS RECORDED AS A ROW. "Why did my patient never get their code" is the question this log
 * exists to answer, and a refusal that wrote nothing answers it with silence.
 */
export type Transport = (
  kind: MessageKind, destination: string, body: string, subject?: string,
  // THE WHATSAPP MAPPING IS PART OF THE CONTRACT, not an implementation detail of handOver. An injected
  // transport that cannot see which template and parameters were chosen cannot assert on them -- and the
  // positional parameter order is the thing most worth asserting, because swapping two of them puts a
  // date where a practitioner name belongs on a real patient's phone.
  wa?: { template: string; params: string[] },
  // The practice's patient-facing identity (CPR-SET-COMMS-001 s3.1): the display name on the envelope
  // and where a reply lands. The ADDRESS stays platform-managed -- only the name is the practice's.
  identity?: { senderName?: string | null; replyTo?: string | null },
) => Promise<{ ok: boolean; providerMessageId?: string; response: string }>;

export async function sendMessage(admin: any, args: {
  workspaceId: string; kind: MessageKind; purpose: string; destination: string;
  params: TemplateArgs; patientId?: string | null; actorId?: string | null; correlationId: string;
  /**
   * Which configurable message type this send is, where it is one (CPR-SET-COMMS-001 s3.2). A send
   * with no key -- a verification code, an invitation -- consults no preference and cannot be
   * switched off. The KEY is the caller's claim about what kind of message this is, which is why the
   * reschedule path passes rescheduling_notice while sending the confirmation template: the template
   * is what is true to say, the key is what the practice chose to say it about.
   */
  preferenceKey?: MessagePreferenceKey;
  // INJECTABLE SO A TEST NEVER TEXTS A REAL PHONE. Defaults to the real provider call; the harness
  // passes a recorder. Not a "test mode" flag on the engine -- there is no branch here that behaves
  // differently in production, only a function that was handed in.
  transport?: Transport;
}): Promise<EngineResult<{ messageId: string; status: string; refusedReason?: string }>> {
  const template = TEMPLATES[args.purpose];
  if (!template)
    return { ok: false, status: 400, code: "UNKNOWN_PURPOSE", message: `nothing may be sent for "${args.purpose}"` };
  if (!template.kinds.includes(args.kind))
    return { ok: false, status: 400, code: "WRONG_CHANNEL", message: `${args.purpose} cannot be sent by ${args.kind}` };

  const body = template.body(args.params);
  // ONE READ FOR BOTH QUESTIONS. The channel row answers "may this send" (refusalFor) and "under
  // whose name" (identity below) -- reading it twice would let the two answers drift mid-request.
  const channels = await channelSettings(admin, args.workspaceId);
  const channel = channels.find(c => c.kind === args.kind)!;
  const refused = await refusalFor(admin, args.workspaceId, args, channel);

  if (refused) {
    const { data } = await admin.from("practice_message").insert({
      workspace_id: args.workspaceId, kind: args.kind, purpose: args.purpose,
      destination: args.destination, patient_id: args.patientId ?? null, body,
      status: "refused", refused_reason: refused,
      created_by: args.actorId ?? null, correlation_id: args.correlationId,
    }).select("id").single();
    return { ok: true, data: { messageId: data?.id ?? "", status: "refused", refusedReason: refused } };
  }

  const { data: row, error } = await admin.from("practice_message").insert({
    workspace_id: args.workspaceId, kind: args.kind, purpose: args.purpose,
    destination: args.destination, patient_id: args.patientId ?? null, body,
    status: "queued", created_by: args.actorId ?? null, correlation_id: args.correlationId,
  }).select("id").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  const status = messagingStatus()[args.kind];
  // The approved template this send invokes. Null for sms and email, where `body` IS the message.
  const wa = args.kind === "whatsapp" && template.whatsapp
    ? { template: template.whatsapp.template, params: template.whatsapp.params(args.params) }
    : undefined;
  const identity = args.kind === "email"
    ? { senderName: channel.senderName, replyTo: channel.replyTo }
    : undefined;
  const outcome = await (args.transport ?? handOver)(args.kind, args.destination, body, template.subject?.(args.params), wa, identity);

  await admin.from("practice_message").update({
    status: outcome.ok ? "handed_over" : "failed",
    handed_to_provider_at: outcome.ok ? nowIso() : null,
    provider: status.provider,
    provider_message_id: outcome.ok ? outcome.providerMessageId ?? null : null,
    // VERBATIM, both ways. A summarised provider error is one nobody can debug at 7am.
    provider_response: outcome.response,
    // WHICH APPROVED TEMPLATE WAS INVOKED. Without it practice_message.body would assert wording it
    // cannot prove was sent, because the text that reached the handset is Meta's copy, not ours.
    provider_template_name: wa?.template ?? null,
  }).eq("id", row.id);

  return { ok: true, data: { messageId: row.id as string, status: outcome.ok ? "handed_over" : "failed" } };
}

// ── APPOINTMENTS: THE THREE TEMPLATES THAT NOTHING CALLED ────────────────────────────────────────────
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE GAP THIS CLOSES. sendMessage() had exactly one caller -- issueOtp -- so appointment_confirmation,
// appointment_reminder and appointment_cancelled were three templates nothing could ever reach. The
// consequence was concrete: the day a provider key is configured, this product would send sign-in codes
// and NOTHING ELSE. A patient would still never hear that their appointment exists.
//
// ⚠ NOTHING BELOW CLAIMS TO SEND. Every path ends in one of three honest outcomes -- a message handed to
// a provider, a REFUSAL WITH A REASON WRITTEN AS A ROW, or a stated reason why nothing was attempted at
// all. There is no fourth outcome, and in particular there is no silent success: with no provider
// configured (which is the state today) every call here lands on refusalFor's last rung, "no <kind>
// provider is configured for this deployment", and writes that sentence into practice_message.
//
// That is issueOtp's own precedent, deliberately followed: it refuses with NOT_DELIVERED and spends the
// challenge rather than returning a code it could not deliver.
//
// ⚠ THE ENGINE DECIDES THE PURPOSE FROM THE APPOINTMENT'S OWN STATUS, not from the caller's intent. A
// caller that asked for a "confirmation" on a REQUESTED appointment would be asking this product to tell
// a patient something untrue -- "your appointment is confirmed" is a claim about the state machine, and
// only the state machine may make it. So the caller names an appointment and this reads what it is.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/** What actually happened. `attempted: null` is a first-class outcome, never an empty success. */
export type AppointmentNotice = {
  appointmentId: string;
  purpose: "appointment_confirmation" | "appointment_cancelled" | null;
  /** Present only when a message row was written -- handed_over, failed or refused. */
  attempted: { kind: MessageKind; status: string; messageId: string; refusedReason?: string } | null;
  /** Present only when nothing was written, with the reason. Exactly one of these two is null. */
  notAttempted: string | null;
};

/** Which status justifies which sentence. Nothing else may reach a patient. */
const STATUS_PURPOSE: Record<string, "appointment_confirmation" | "appointment_cancelled"> = {
  CONFIRMED: "appointment_confirmation",
  CANCELLED: "appointment_cancelled",
};

/**
 * Who the appointment is WITH, for the template's one name slot.
 *
 * practice_appointment records no practitioner column, so naming a person would be an invention on a
 * managed practice with several. An individual practice has exactly one practitioner and it is the
 * owner, so there the person's own name is the true answer; everywhere else the practice's name is, and
 * "your appointment with <practice> is confirmed" is as true as the sentence gets. Returning null means
 * neither could be read, and nothing is sent -- a message that names nobody is a message a patient
 * cannot place.
 */
async function appointmentCounterparty(admin: any, workspace: {
  id: string; name: string; type: string; owner_person_id: string | null;
}): Promise<string | null> {
  if (workspace.type === "individual_practice" && workspace.owner_person_id) {
    const { data } = await admin.from("practice_practitioner_identity")
      .select("display_name").eq("user_id", workspace.owner_person_id).maybeSingle();
    if (data?.display_name) return data.display_name as string;
  }
  return workspace.name?.trim() || null;
}

/**
 * The channel and address to use for one patient.
 *
 * PREFERENCE FIRST, THEN WHATEVER EXISTS. A patient who asked for email gets email. A patient whose
 * preference names no electronic channel -- "in_person", "via_relative", or the outright "none" -- still
 * resolves to a channel here ON PURPOSE, so that refusalFor writes the refusal row that answers "why did
 * my patient never hear from us". Resolving to nothing would answer it with silence.
 */
async function appointmentDestination(admin: any, args: {
  workspaceId: string; patientId: string | null; appointmentPhone: string | null;
}): Promise<{ kind: MessageKind; destination: string } | null> {
  let preferred: string | null = null;
  let phone = args.appointmentPhone?.trim() || "";
  let email = "";

  if (args.patientId) {
    const [{ data: patient }, { data: contacts }] = await Promise.all([
      // ⚠ BOTH SCOPED. The contacts read below carried .eq("workspace_id") from the day it was written
      // and the patient read one line above it did not -- the clearest possible sign that the omission
      // was an oversight rather than a decision.
      admin.from("practice_patient").select("preferred_contact_method")
        .eq("id", args.patientId).eq("workspace_id", args.workspaceId).maybeSingle(),
      admin.from("practice_patient_contact").select("contact_type, value, preferred")
        .eq("patient_id", args.patientId).eq("workspace_id", args.workspaceId),
    ]);
    preferred = (patient?.preferred_contact_method as string) ?? null;
    const rows = (contacts ?? []) as { contact_type: string; value: string; preferred: boolean }[];
    const best = (type: string) =>
      (rows.filter(r => r.contact_type === type).sort((a, b) => Number(b.preferred) - Number(a.preferred))[0]?.value ?? "").trim();
    phone = phone || best("phone");
    email = best("email");
  }

  const wants: MessageKind | null = preferred === "email" ? "email" : preferred === "sms" || preferred === "phone" ? "sms" : null;
  const order: MessageKind[] = wants === "email" ? ["email", "sms"] : wants === "sms" ? ["sms", "email"] : phone ? ["sms", "email"] : ["email", "sms"];
  for (const kind of order) {
    const destination = kind === "sms" ? phone : email;
    if (destination) return { kind, destination };
  }
  return null;
}

/**
 * Tell a patient that their appointment is confirmed, or that it is cancelled.
 *
 * ⚠ THIS CANNOT FAIL THE BOOKING. It returns an outcome and never throws; the caller books first and
 * tells the patient second, so a gateway outage can never be the reason an appointment does not exist.
 * The result is returned rather than swallowed so a screen can show the truth ("we could not reach
 * them, because...") instead of a confirmation tick that nothing earned.
 *
 * There is no `appointment_reminder` path here, and that is not an oversight -- see the note at the end
 * of this file.
 */
export async function notifyAppointment(admin: any, args: {
  workspaceId: string; appointmentId: string; actorId?: string | null; correlationId: string;
  /**
   * "rescheduled" when the moment being told about is a MOVE rather than the original booking
   * (CPR-SET-COMMS-001 s3.2). The sentence sent is the same true one -- the confirmation with the
   * new time -- but the practice's rescheduling-notice preference is what gets consulted, so
   * switching off "tell patients when I move them" does not also switch off "tell patients they
   * are booked".
   */
  trigger?: "rescheduled";
  transport?: Transport;
}): Promise<EngineResult<AppointmentNotice>> {
  const nothing = (reason: string, purpose: AppointmentNotice["purpose"] = null): EngineResult<AppointmentNotice> =>
    ({ ok: true, data: { appointmentId: args.appointmentId, purpose, attempted: null, notAttempted: reason } });

  const { data: appt, error } = await admin.from("practice_appointment")
    .select("id, workspace_id, patient_id, patient_phone, scheduled_at, status")
    .eq("id", args.appointmentId).eq("workspace_id", args.workspaceId).maybeSingle();
  // ⚠ A FAILED READ IS NOT AN ABSENT APPOINTMENT. Collapsing the two would report an outage as "there was
  // nobody to tell", which is the one answer that stops anybody looking.
  if (error)
    return {
      ok: false, status: 503, code: "APPOINTMENT_UNREADABLE",
      message: `nobody was told about this appointment because it could not be read: ${error.message}`,
    };
  if (!appt) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  const purpose = STATUS_PURPOSE[appt.status as string];
  if (!purpose)
    return nothing(`an appointment that is ${appt.status} has neither been confirmed nor cancelled, so there is nothing to tell the patient`);

  const { data: workspace, error: wsError } = await admin.from("practice_workspace")
    .select("id, name, type, timezone, owner_person_id").eq("id", args.workspaceId).maybeSingle();
  if (wsError || !workspace)
    return {
      ok: false, status: 503, code: "WORKSPACE_UNREADABLE",
      message: `nobody was told about this appointment because the practice could not be read: ${wsError?.message ?? "no practice row"}`,
    };

  const counterparty = await appointmentCounterparty(admin, workspace);
  if (!counterparty)
    return nothing("the practice has no name to send under, and a message naming nobody is one a patient cannot place", purpose);

  const target = await appointmentDestination(admin, {
    workspaceId: args.workspaceId, patientId: (appt.patient_id as string) ?? null,
    appointmentPhone: (appt.patient_phone as string) ?? null,
  });
  if (!target)
    return nothing("no phone number or email address is recorded for this patient", purpose);

  const sent = await sendMessage(admin, {
    workspaceId: args.workspaceId, kind: target.kind, purpose,
    destination: target.destination, patientId: (appt.patient_id as string) ?? null,
    // THE PRACTICE'S OWN CLOCK, not the server's and not the reader's. A patient told "14:30" must be
    // told the time the clinic means.
    params: { practitioner: counterparty, when: formatDateTime(appt.scheduled_at, workspace.timezone as string) },
    preferenceKey: purpose === "appointment_cancelled"
      ? "cancellation_notice"
      : args.trigger === "rescheduled" ? "rescheduling_notice" : "booking_confirmation",
    actorId: args.actorId ?? null, correlationId: args.correlationId, transport: args.transport,
  });
  if (!sent.ok) return sent;

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId ?? null,
    eventType: "practice.appointment_notice",
    payload: {
      appointmentId: args.appointmentId, purpose, kind: target.kind,
      status: sent.data.status, refusedReason: sent.data.refusedReason ?? null,
    },
    correlationId: args.correlationId,
  });

  return {
    ok: true,
    data: {
      appointmentId: args.appointmentId, purpose, notAttempted: null,
      attempted: {
        kind: target.kind, status: sent.data.status, messageId: sent.data.messageId,
        ...(sent.data.refusedReason ? { refusedReason: sent.data.refusedReason } : {}),
      },
    },
  };
}

/**
 * The shape every HTTP caller uses: never throws, never fails, always returns a sentence.
 *
 * An appointment is booked, moved or cancelled INSIDE a request that has already succeeded by the time
 * this runs. Letting a messaging failure surface as a 5xx would mean a patient's appointment appearing
 * not to exist because a gateway was slow. So the outcome is DEMOTED to a field on the response --
 * reported honestly, never allowed to overturn what already happened.
 */
export async function appointmentNotice(admin: any, args: {
  workspaceId: string; appointmentId: string; actorId?: string | null; correlationId: string;
  trigger?: "rescheduled";
  transport?: Transport;
}): Promise<AppointmentNotice> {
  try {
    const r = await notifyAppointment(admin, args);
    return r.ok ? r.data : { appointmentId: args.appointmentId, purpose: null, attempted: null, notAttempted: r.message };
  } catch (e) {
    return {
      appointmentId: args.appointmentId, purpose: null, attempted: null,
      notAttempted: `the patient could not be told: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300),
    };
  }
}

/**
 * Tell the person who just booked ONLINE that their appointment is confirmed (CPR-SET-COMMS-001 s3.2:
 * booking confirmations default on for online bookings).
 *
 * ⚠ WHY THIS IS NOT notifyAppointment. That function resolves a destination from the patient RECORD,
 * because a practice-side change must reach whoever the record says the patient is. An online booking
 * usually has no patient record yet -- what it has is a destination the person PROVED minutes ago by
 * entering the code sent to it. That verified address is the one right place to send, so it is passed
 * in rather than resolved: nothing a record could say would be more true than the proof.
 *
 * ⚠ SAME CONTRACT AS appointmentNotice: never throws, never fails the caller, and THE STATUS DECIDES
 * THE SENTENCE. A CONFIRMED appointment earns a confirmation -- which is also what a rescheduled one is,
 * carrying its new time -- and a CANCELLED one earns a cancellation. A REQUESTED appointment has been
 * confirmed by nobody and nothing here will claim otherwise. The caller never names the purpose: asking
 * this function to send a "confirmation" for an appointment the state machine has cancelled is exactly
 * the lie that rule forecloses.
 *
 * The practice's per-type preference is consulted like any other send; a practice that switched these
 * off gets a refusal row, not silence.
 */
export async function publicBookingNotice(admin: any, args: {
  workspaceId: string; appointmentId: string; kind: MessageKind; destination: string;
  correlationId: string; transport?: Transport;
}): Promise<AppointmentNotice> {
  const nothing = (reason: string): AppointmentNotice =>
    ({ appointmentId: args.appointmentId, purpose: null, attempted: null, notAttempted: reason });
  try {
    const { data: appt, error } = await admin.from("practice_appointment")
      .select("id, scheduled_at, status")
      .eq("id", args.appointmentId).eq("workspace_id", args.workspaceId).maybeSingle();
    if (error) return nothing(`no confirmation was sent because the appointment could not be read: ${error.message}`);
    if (!appt) return nothing("no confirmation was sent because the appointment could not be found");
    // ⚠ THE PURPOSE IS READ FROM THE STATE MACHINE, NEVER TAKEN FROM THE CALLER. STATUS_PURPOSE makes
    // the same argument for the practice-side path a few hundred lines up.
    const purpose = appt.status === "CONFIRMED" ? "appointment_confirmation"
      : appt.status === "CANCELLED" ? "appointment_cancelled"
        : null;
    if (!purpose)
      return nothing(`an appointment that is ${appt.status} has neither been confirmed nor cancelled, so there is nothing to tell the patient`);

    const { data: workspace, error: wsError } = await admin.from("practice_workspace")
      .select("id, name, type, timezone, owner_person_id").eq("id", args.workspaceId).maybeSingle();
    if (wsError || !workspace)
      return nothing(`no confirmation was sent because the practice could not be read: ${wsError?.message ?? "no practice row"}`);

    const counterparty = await appointmentCounterparty(admin, workspace);
    if (!counterparty)
      return nothing("the practice has no name to send under, and a message naming nobody is one a patient cannot place");

    const sent = await sendMessage(admin, {
      workspaceId: args.workspaceId, kind: args.kind, purpose,
      destination: args.destination, patientId: null,
      params: { practitioner: counterparty, when: formatDateTime(appt.scheduled_at, workspace.timezone as string) },
      // The preference follows the purpose. CPR-SET-COMMS-001 made these separate settings, so a
      // practice may switch cancellation notices off without switching confirmations off.
      preferenceKey: purpose === "appointment_cancelled" ? "cancellation_notice" : "booking_confirmation",
      actorId: null, correlationId: args.correlationId, transport: args.transport,
    });
    if (!sent.ok) return nothing(sent.message);

    await audit(admin, {
      workspaceId: args.workspaceId, actorId: null,
      eventType: "practice.appointment_notice",
      payload: {
        appointmentId: args.appointmentId, purpose, kind: args.kind,
        status: sent.data.status, refusedReason: sent.data.refusedReason ?? null, channel: "patient_self",
      },
      correlationId: args.correlationId,
    });

    return {
      appointmentId: args.appointmentId, purpose, notAttempted: null,
      attempted: {
        kind: args.kind, status: sent.data.status, messageId: sent.data.messageId,
        ...(sent.data.refusedReason ? { refusedReason: sent.data.refusedReason } : {}),
      },
    };
  } catch (e) {
    return nothing(`no confirmation was sent: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300));
  }
}

/**
 * ⚠ WHY THERE IS NO REMINDER PATH, STATED RATHER THAN LEFT AS AN ABSENCE.
 *
 * `appointment_reminder` is a template with no caller and it stays that way. A confirmation and a
 * cancellation both happen INSIDE a request somebody made -- there is a booking, a click, a state
 * change, and a message can ride along with it. A reminder has no such moment: it is defined entirely by
 * a time that has not arrived yet, so something has to wake up, find the appointments due tomorrow, and
 * attempt each one. Nothing in this deployment does that.
 *
 * vercel.json has two crons (/api/cron/reports daily, /api/cron/jobs hourly) and neither touches any
 * messaging table; practice_message.status='queued' is a value written and updated inside one HTTP
 * request, with no next_retry_at, no lock column and no poller. Writing a reminder path without a runner
 * would produce rows that look queued for ever -- the exact failure this table's own migration was
 * written to prevent.
 *
 * A reminder therefore needs a scheduled runner and a durable outbox, and neither is invented here.
 */

/**
 * The provider call itself.
 *
 * A TIMEOUT, BECAUSE SOMEBODY IS WAITING. An OTP is sent while a person watches a spinner; a gateway
 * that hangs must fail in seconds and say so, not hold the request open.
 */
async function handOver(
  kind: MessageKind, destination: string, body: string, subject?: string,
  // WhatsApp is handed a TEMPLATE NAME and ORDERED PARAMETERS, never `body` -- Meta rejects free
  // text outside a 24-hour window a patient opened. The other two channels ignore this.
  wa?: { template: string; params: string[] },
  identity?: { senderName?: string | null; replyTo?: string | null },
): Promise<{
  ok: boolean; providerMessageId?: string; response: string;
}> {
  const status = messagingStatus()[kind];
  if (!status.configured) return { ok: false, response: "no provider configured" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    if (kind === "sms" && status.provider === "twilio") {
      const sid = process.env.TWILIO_ACCOUNT_SID!;
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: "POST", signal: controller.signal,
        headers: {
          authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: destination, From: smsFrom() ?? "", Body: body }),
      });
      const text = await res.text();
      return { ok: res.ok, providerMessageId: safeJson(text)?.sid, response: text.slice(0, 2000) };
    }
    if (kind === "sms" && status.provider === "africastalking") {
      const res = await fetch("https://api.africastalking.com/version1/messaging", {
        method: "POST", signal: controller.signal,
        headers: {
          apiKey: process.env.AFRICASTALKING_API_KEY!,
          "content-type": "application/x-www-form-urlencoded", accept: "application/json",
        },
        body: new URLSearchParams({
          username: process.env.AFRICASTALKING_USERNAME!, to: destination, message: body,
          ...(process.env.AFRICASTALKING_FROM ? { from: process.env.AFRICASTALKING_FROM } : {}),
        }),
      });
      const text = await res.text();
      return { ok: res.ok, providerMessageId: safeJson(text)?.SMSMessageData?.Recipients?.[0]?.messageId, response: text.slice(0, 2000) };
    }
    if (kind === "whatsapp") {
      // A whatsapp send with no approved template is refused HERE rather than sent as free text. Meta
      // would reject it anyway, but the refusal has to be ours: a message that silently becomes a
      // different shape than the record claims is worse than one that does not go.
      if (!wa) return { ok: false, response: "no approved WhatsApp template for this purpose" };
      const res = await fetch(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
        method: "POST", signal: controller.signal,
        headers: { authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: destination,
          type: "template",
          template: {
            name: wa.template,
            language: { code: process.env.WHATSAPP_TEMPLATE_LOCALE ?? "en" },
            components: wa.params.length
              ? [{ type: "body", parameters: wa.params.map(text => ({ type: "text", text })) }]
              : [],
          },
        }),
      });
      const text = await res.text();
      return { ok: res.ok, providerMessageId: safeJson(text)?.messages?.[0]?.id, response: text.slice(0, 2000) };
    }
    if (kind === "email" && status.provider === "resend") {
      // THE PRACTICE'S NAME ON THE ENVELOPE (CPR-SET-COMMS-001 s3.1). sender_name was stored from the
      // day the channel existed and reached no email -- the From line was the platform address
      // verbatim, so the one thing the setting promised ("patients recognise messages from your
      // practice") never happened. The ADDRESS stays platform-managed: only the display name is the
      // practice's, stripped of the characters that would let a name smuggle in a second address.
      const platformFrom = emailFrom()!;
      const addr = platformFrom.match(/<([^>]+)>/)?.[1] ?? platformFrom;
      const displayName = identity?.senderName?.replace(/[<>"\r\n]/g, "").trim();
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST", signal: controller.signal,
        headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
        // No no-reply@example.invalid fallback. Sending from a deliberately invalid domain produces a
        // provider rejection that reads like an outage rather than a missing setting -- and the gate
        // above now refuses before we get here, so there is nothing left for a fallback to rescue.
        //
        // ⚠ ONE BUILDER FOR BOTH STACKS. This payload used to be written here AND in dispatch.ts, which
        // is how the two came to disagree about sender variable names. resendEmailBody also carries
        // reply_to, so a patient answering a booking confirmation reaches somebody rather than an
        // unattended from-address -- the practice's own reply-to when it set one, the platform's
        // otherwise (resendEmailBody's env fallback).
        body: JSON.stringify(resendEmailBody({
          from: displayName ? `"${displayName}" <${addr}>` : platformFrom,
          to: destination, subject: subject ?? "Message", text: body,
          replyTo: identity?.replyTo ?? undefined,
        })),
      });
      const text = await res.text();
      return { ok: res.ok, providerMessageId: safeJson(text)?.id, response: text.slice(0, 2000) };
    }
    return { ok: false, response: `no handler for ${kind} via ${status.provider}` };
  } catch (e) {
    return { ok: false, response: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

function safeJson(text: string): any {
  try { return JSON.parse(text); } catch { return null; }
}

// ── OTP (IAM-000 s7, PIS-000 s11) ────────────────────────────────────────────────────────────────────
//
// ⚠ THIS IS AN AUTHENTICATION SURFACE. Five properties below are load-bearing, and each one is here
// because its absence is a real, exploitable hole rather than an untidiness:
//
//   1. THE CODE IS NEVER STORED, LOGGED OR RETURNED. It exists in memory long enough to be handed to a
//      template and is then only ever a salted SHA-256. There is no branch anywhere -- not for
//      development, not for a harness -- that puts it in a response body or on a screen. The harness
//      reads it out of the MESSAGE, through an injected transport, which is where a patient would.
//
//   2. RATE LIMITS FAIL CLOSED. ⚠ THE COUNT USED TO BE READ AS `(count ?? 0)` WITH THE ERROR DISCARDED,
//      which meant an unreadable challenge table -- or PostgREST answering with a null count, which it
//      does -- read as "nought codes sent in the last hour" and permitted an UNLIMITED number. A rate
//      limit whose failure mode is "no limit" is not a rate limit. Both branches now refuse.
//
//   3. AN ATTEMPT THAT WAS NOT COUNTED DID NOT HAPPEN. ⚠ The attempt counter used to be a
//      read-modify-write whose error was discarded: two concurrent guesses both read attempts=0 and both
//      wrote 1, so five parallel workers could make far more than five guesses, and a failed UPDATE
//      raised the ceiling to infinity. It is now a compare-and-set on the value that was read, and a
//      write that does not land refuses the verification.
//
//   4. NOTHING HERE CONSULTS ANY RECORD KEYED ON THE DESTINATION. An issue path that looked up "is this
//      a patient of this practice?" would answer differently -- in body, in status or merely in the time
//      it took -- for a number that is known and one that is not, which is a patient-enumeration oracle
//      on an unauthenticated endpoint. The harness proves the absence by making practice_patient
//      unreadable and showing the answer does not change.
//
//   5. PER-SOURCE LIMITING IS EITHER REAL OR REFUSED. See sourceKey below.

// CNE-003 s8 states a FIVE minute expiry, verbatim: "Hashed OTP storage / 5-minute expiry". This was 10
// -- the ONLY number in the five CNE documents that disagreed with deployed code, and it disagreed in the
// LESS SAFE direction, so the shorter window wins on both counts. A live code is exposure, and five
// minutes is enough for somebody reading a message on the phone in their hand.
//
// The value is interpolated into the message body below rather than typed into the copy, so the number a
// patient reads and the number the row enforces cannot drift apart.
const OTP_MINUTES = 5;
const OTP_PER_DESTINATION_PER_HOUR = 5;
/**
 * Per SOURCE, and lower than the per-destination limit on purpose: one caller walking a list of numbers
 * is the abuse the per-destination limit cannot see, because each individual number looks untouched.
 */
const OTP_PER_SOURCE_PER_HOUR = 10;

/** Hashed with the row's own id, so two identical codes never share a hash. */
const hashCode = (challengeId: string, code: string) =>
  createHash("sha256").update(`${challengeId}:${code}`).digest("hex");

/**
 * A source is an IP, a device cookie or whatever the edge can be trusted to give -- all of them personal
 * data, none of them worth keeping. Only the hash is ever computed here, and the caller's raw value never
 * reaches a query, a log or a column.
 */
const hashSource = (sourceKey: string) =>
  createHash("sha256").update(`otp-source:${sourceKey}`).digest("hex");

export async function issueOtp(admin: any, args: {
  workspaceId?: string | null; purpose: "booking" | "sign_in" | "contact_verification";
  channel: MessageKind; destination: string; patientId?: string | null; correlationId: string;
  /**
   * ⚠ PER-SOURCE RATE LIMITING IS REAL OR IT REFUSES. THERE IS NO THIRD OPTION.
   *
   * practice_otp_challenge has no source column (migration 224 did not anticipate an unauthenticated
   * caller), so a source-limited request cannot be recorded and therefore cannot be limited. Rather than
   * silently degrade to per-destination only -- which would leave a caller believing a control is
   * running when it is not -- passing a sourceKey against a store that cannot hold it REFUSES.
   *
   * The alternative, an in-process Map, was considered and rejected: it survives neither a second
   * instance nor a restart, so it is a rate limit that an attacker removes by reconnecting. An
   * approximated auth control is worse than a named absent one.
   */
  sourceKey?: string | null;
  transport?: Transport;
}): Promise<EngineResult<{
  challengeId: string; expiresAt: string; delivery: string; refusedReason?: string;
  /** ⚠ THE LIMIT AS A FIELD. A caller can check whether the control it asked for actually ran. */
  sourceLimited: boolean;
}>> {
  const destination = args.destination.trim();
  if (!destination) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a destination is required" };

  const since = new Date(Date.now() - 3600_000).toISOString();

  // RATE LIMITED PER DESTINATION. Without this, anybody can use this endpoint to send a stranger a
  // hundred text messages -- the product becomes the harassment tool.
  //
  // ⚠ A FAILED COUNT IS NOT A COUNT OF NOUGHT, AND A NULL COUNT IS NOT A ZERO EITHER. See property 2.
  const { count, error: countErr } = await admin.from("practice_otp_challenge")
    .select("*", { count: "exact", head: true })
    .eq("destination", destination).gte("created_at", since);
  if (countErr || count === null || count === undefined)
    return {
      ok: false, status: 503, code: "RATE_LIMIT_UNREADABLE",
      message: `no code was issued because the codes already sent could not be counted: ${countErr?.message ?? "the count came back empty rather than as a number"}`,
    };
  if (count >= OTP_PER_DESTINATION_PER_HOUR)
    return {
      ok: false, status: 429, code: "TOO_MANY_CODES",
      message: "too many codes have been sent to that number in the last hour",
    };

  // PER SOURCE. Refuses outright where the register cannot hold a source -- see sourceKey's comment.
  const sourceHash = args.sourceKey ? hashSource(args.sourceKey) : null;
  if (sourceHash) {
    const { count: srcCount, error: srcErr } = await admin.from("practice_otp_challenge")
      .select("*", { count: "exact", head: true })
      .eq("source_hash", sourceHash).gte("created_at", since);
    if (srcErr || srcCount === null || srcCount === undefined)
      return {
        ok: false, status: 503, code: "SOURCE_LIMIT_UNAVAILABLE",
        message: `no code was issued because this request asked to be rate-limited by source and the challenge register cannot record one: ${srcErr?.message ?? "the count came back empty rather than as a number"}. An unrecorded source is an unlimited one.`,
      };
    if (srcCount >= OTP_PER_SOURCE_PER_HOUR)
      return {
        ok: false, status: 429, code: "TOO_MANY_CODES",
        message: "too many codes have been requested from here in the last hour",
      };
  }

  // ANY LIVE CODE FOR THIS DESTINATION AND PURPOSE IS SPENT FIRST. Two valid codes at once means the
  // older one still works after the newer was issued, which is exactly what a code being "one time"
  // is supposed to prevent.
  await admin.from("practice_otp_challenge")
    .update({ consumed_at: nowIso() })
    .eq("destination", destination).eq("purpose", args.purpose).is("consumed_at", null);

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(Date.now() + OTP_MINUTES * 60_000).toISOString();

  const { data: challenge, error } = await admin.from("practice_otp_challenge").insert({
    workspace_id: args.workspaceId ?? null, purpose: args.purpose, channel: args.channel,
    destination, code_hash: "pending", expires_at: expiresAt,
    // ⚠ WRITTEN ONLY WHEN ASKED FOR, AND THE INSERT IS ALLOWED TO FAIL IF THE COLUMN IS NOT THERE. The
    // read above and this write are the two halves of the same control: a limit that reads a column
    // nothing writes counts nought for ever, which is the failure mode this pairing forecloses.
    ...(sourceHash ? { source_hash: sourceHash } : {}),
  }).select("id").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  // The salt is the row's id, so the hash can only be written once the row exists.
  await admin.from("practice_otp_challenge")
    .update({ code_hash: hashCode(challenge.id, code) }).eq("id", challenge.id);

  const purposeToTemplate: Record<string, string> = {
    booking: "otp_booking", sign_in: "otp_sign_in", contact_verification: "otp_sign_in",
  };
  const sent = args.workspaceId
    ? await sendMessage(admin, {
      workspaceId: args.workspaceId, kind: args.channel, purpose: purposeToTemplate[args.purpose],
      destination, params: { code, minutes: OTP_MINUTES }, patientId: args.patientId ?? null,
      correlationId: args.correlationId, transport: args.transport,
    })
    : null;

  if (sent?.ok) await admin.from("practice_otp_challenge").update({ message_id: sent.data.messageId }).eq("id", challenge.id);

  // A CODE THAT COULD NOT BE SENT IS NOT A CODE. The challenge is spent immediately rather than left
  // live for its whole window, so nothing downstream can verify against something nobody received.
  const delivered = sent?.ok && sent.data.status === "handed_over";
  if (!delivered) {
    await admin.from("practice_otp_challenge").update({ consumed_at: nowIso() }).eq("id", challenge.id);
    return {
      ok: false, status: 502, code: "NOT_DELIVERED",
      message: sent?.ok ? (sent.data.refusedReason ?? "the code could not be sent") : "the code could not be sent",
    };
  }

  return {
    ok: true,
    data: {
      challengeId: challenge.id as string, expiresAt, delivery: "handed_to_provider",
      sourceLimited: sourceHash !== null,
    },
  };
}

export async function verifyOtp(admin: any, args: {
  challengeId: string; code: string;
}): Promise<EngineResult<{ verified: true; destination: string; purpose: string }>> {
  // ⚠ THE ERROR USED TO BE DISCARDED HERE. A read that failed produced `c = null`, which fell into the
  // same "not valid" refusal as a wrong code -- so it failed CLOSED, which is why this was survivable.
  // It is still wrong: it reported an outage as the patient's mistake, and the next person to reorder
  // these lines would have had nothing stopping them from letting a null read fall the other way. A
  // failed read is an error, named as one, and it is never a pass.
  const { data: c, error } = await admin.from("practice_otp_challenge")
    .select("*").eq("id", args.challengeId).maybeSingle();
  if (error)
    return {
      ok: false, status: 503, code: "VERIFICATION_STORE_UNREADABLE",
      message: `this code was not checked because the challenge could not be read: ${error.message}`,
    };

  // ONE REFUSAL FOR EVERY FAILURE MODE. Distinguishing "no such challenge" from "wrong code" from
  // "expired" tells somebody guessing which guess was close -- the position CPR-310 took on invitation
  // codes, for the same reason. (The unreadable-store refusal above is not one of these modes: it says
  // nothing about the code or the challenge, so it leaks nothing to a guesser -- and a caller that
  // cannot tell an outage from a wrong code retries forever against a database that is down.)
  const no = { ok: false as const, status: 400, code: "INVALID_CODE", message: "that code is not valid" };
  if (!c) return no;
  if (c.consumed_at) return no;
  if (c.expires_at <= nowIso()) return no;
  if (c.attempts >= c.max_attempts) return no;

  // ══ THE ATTEMPT IS COUNTED BEFORE IT IS JUDGED, ATOMICALLY, AND THE WRITE IS CHECKED ═══════════════
  //
  // ⚠ COMPARE-AND-SET ON THE VALUE THAT WAS READ. This was a bare update whose error was discarded, and
  // it had two holes at once. Concurrently: N guesses all read attempts=0, all write 1, and the limit of
  // five becomes a limit of five ROUNDS of however many workers an attacker runs -- a million-space code
  // falls in minutes. On failure: the counter never moved and the ceiling was never reached at all.
  //
  // `.eq("attempts", c.attempts)` makes exactly one concurrent guess win the increment; the losers get
  // zero rows back and are refused rather than judged. An attempt nobody counted did not happen.
  const { data: bumped, error: bumpErr } = await admin.from("practice_otp_challenge")
    .update({ attempts: c.attempts + 1 })
    .eq("id", c.id).eq("attempts", c.attempts)
    .select("id");
  if (bumpErr || ((bumped ?? []) as any[]).length !== 1)
    return {
      ok: false, status: 503, code: "ATTEMPT_NOT_COUNTED",
      message: `this code was not checked because the attempt could not be counted: ${bumpErr?.message ?? "another attempt on this challenge was in flight"}. An uncounted attempt is an unlimited one.`,
    };

  const expected = Buffer.from(c.code_hash, "utf8");
  const actual = Buffer.from(hashCode(c.id, args.code.trim()), "utf8");
  // CONSTANT TIME. A comparison that returns early leaks how much of the hash matched, one byte at a
  // time, to anybody who can measure it.
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return no;

  // SINGLE USE, AND THE SPEND IS CHECKED. A consume that silently failed would leave a verified code
  // live for the rest of its window, which is the whole property "one time" is there to provide.
  const { data: spent, error: spendErr } = await admin.from("practice_otp_challenge")
    .update({ consumed_at: nowIso() }).eq("id", c.id).is("consumed_at", null).select("id");
  if (spendErr || ((spent ?? []) as any[]).length !== 1)
    return {
      ok: false, status: 503, code: "CODE_NOT_SPENT",
      message: `this code was correct and was not accepted, because it could not be marked as used: ${spendErr?.message ?? "it had already been spent"}. A code that stays live after it is used is not single-use.`,
    };

  return { ok: true, data: { verified: true, destination: c.destination, purpose: c.purpose } };
}

/** What a practice can see about its own sending. Counts, and the refusals with their reasons. */
export async function messageLog(admin: any, ctx: WorkspaceContext, limit = 50) {
  const { data } = await admin.from("practice_message")
    .select("id, kind, purpose, destination, status, refused_reason, provider, handed_to_provider_at, delivery_confirmed_at, created_at")
    .eq("workspace_id", ctx.workspaceId).order("created_at", { ascending: false }).limit(limit);
  const rows = (data ?? []) as any[];
  const status = messagingStatus();

  return {
    messages: rows,
    handedOver: rows.filter(r => r.status === "handed_over").length,
    failed: rows.filter(r => r.status === "failed").length,
    refused: rows.filter(r => r.status === "refused").length,
    // THE FIELD THAT STOPS A NULL BEING READ AS A FAILURE. Nothing here knows whether a message arrived.
    receiptsAvailable: status.sms.receiptsAvailable || status.email.receiptsAvailable,
    deliveryNote: "This records what a provider accepted, not what arrived. No delivery receipts are collected, so a message shown as handed over may still not have reached the person.",
  };
}
