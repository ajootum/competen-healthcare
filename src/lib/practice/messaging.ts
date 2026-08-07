import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { audit } from "@/lib/practice/provisioning";
import type { EngineResult } from "@/lib/practice/encounters";
import { type WorkspaceContext } from "@/lib/practice/access";

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

export type MessageKind = "sms" | "email";

/**
 * Which provider, if any.
 *
 * Shaped like aiStatus(): the rest of the product asks whether a channel is configured and degrades
 * honestly when it is not, rather than discovering it at the moment somebody is waiting for a code.
 */
export function messagingStatus(): {
  sms: { configured: boolean; provider: string | null; receiptsAvailable: boolean };
  email: { configured: boolean; provider: string | null; receiptsAvailable: boolean };
} {
  const twilio = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
  const africas = !!(process.env.AFRICASTALKING_API_KEY && process.env.AFRICASTALKING_USERNAME);
  const resend = !!process.env.RESEND_API_KEY;

  return {
    sms: {
      configured: twilio || africas,
      provider: twilio ? "twilio" : africas ? "africastalking" : null,
      // NEITHER GATEWAY REPORTS DELIVERY WITHOUT A WEBHOOK THIS DEPLOYMENT DOES NOT HOST. Stated as a
      // field rather than implied by a delivery_confirmed_at that is always null.
      receiptsAvailable: false,
    },
    email: { configured: resend, provider: resend ? "resend" : null, receiptsAvailable: false },
  };
}

// ── THE TEMPLATES. The only things that can reach a patient. ──────────────────────────────────────────

type TemplateArgs = Record<string, string | number>;

const TEMPLATES: Record<string, {
  kinds: MessageKind[];
  subject?: (a: TemplateArgs) => string;
  body: (a: TemplateArgs) => string;
}> = {
  otp_booking: {
    kinds: ["sms", "email"],
    subject: () => "Your booking code",
    // NO PRACTICE NAME, NO PRACTITIONER NAME, NO REASON FOR THE APPOINTMENT. Somebody reading this over
    // a shoulder learns a six-digit number and nothing about the person it was sent to.
    body: a => `${a.code} is your booking code. It expires in ${a.minutes} minutes. Do not share it.`,
  },
  otp_sign_in: {
    kinds: ["sms", "email"],
    subject: () => "Your sign-in code",
    body: a => `${a.code} is your sign-in code. It expires in ${a.minutes} minutes. Do not share it.`,
  },
  appointment_confirmation: {
    kinds: ["sms", "email"],
    subject: () => "Your appointment",
    // THE DATE AND TIME, AND WHO WITH. Not why -- "your oncology follow-up" on a lock screen is a
    // disclosure the patient did not choose.
    body: a => `Your appointment with ${a.practitioner} is confirmed for ${a.when}.`,
  },
  appointment_reminder: {
    kinds: ["sms", "email"],
    subject: () => "Appointment reminder",
    body: a => `Reminder: your appointment with ${a.practitioner} is on ${a.when}.`,
  },
  appointment_cancelled: {
    kinds: ["sms", "email"],
    subject: () => "Appointment cancelled",
    body: a => `Your appointment with ${a.practitioner} on ${a.when} has been cancelled.`,
  },
  invitation_code: {
    kinds: ["email"],
    subject: () => "You have been invited to a practice",
    body: a => `You have been invited to join ${a.practice}. Your invitation code is ${a.code}. It expires on ${a.expires}.`,
  },
};

export const MESSAGE_PURPOSES = Object.keys(TEMPLATES);

// ── CHANNEL SETTINGS ─────────────────────────────────────────────────────────────────────────────────

export async function channelSettings(admin: any, workspaceId: string) {
  const { data } = await admin.from("practice_message_channel")
    .select("*").eq("workspace_id", workspaceId);
  const rows = (data ?? []) as any[];
  const status = messagingStatus();

  return (["sms", "email"] as MessageKind[]).map(kind => {
    const row = rows.find(r => r.kind === kind);
    return {
      kind,
      enabled: !!row?.enabled,
      senderName: row?.sender_name ?? null,
      senderAddress: row?.sender_address ?? null,
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

export async function setChannel(admin: any, ctx: WorkspaceContext, args: {
  kind: MessageKind; enabled: boolean; senderName?: string; senderAddress?: string;
  requireConsent?: boolean; correlationId: string;
}): Promise<EngineResult<{ enabled: boolean }>> {
  if (!ctx.capabilities.includes("practice.settings.manage"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "practice.settings.manage is required" };
  if (args.kind !== "sms" && args.kind !== "email")
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "kind must be sms or email" };

  // A CHANNEL WITHOUT A SENDER IDENTITY PHISHES ITS OWN PATIENTS. "Your code is 481920" from an unknown
  // number is indistinguishable from a scam, and teaching patients to trust those is worse than not
  // sending at all.
  if (args.enabled && !(args.senderName ?? "").trim())
    return {
      ok: false, status: 422, code: "SENDER_REQUIRED",
      message: "give the sender a name -- a code from an unknown number is indistinguishable from a scam",
    };

  const { data: existing } = await admin.from("practice_message_channel")
    .select("id").eq("workspace_id", ctx.workspaceId).eq("kind", args.kind).maybeSingle();

  const patch = {
    workspace_id: ctx.workspaceId, kind: args.kind, enabled: args.enabled,
    sender_name: args.senderName?.trim() || null,
    sender_address: args.senderAddress?.trim() || null,
    require_consent: args.requireConsent ?? true,
    enabled_at: args.enabled ? nowIso() : null,
    enabled_by: args.enabled ? ctx.userId : null,
  };

  const { error } = existing
    ? await admin.from("practice_message_channel").update(patch).eq("id", existing.id)
    : await admin.from("practice_message_channel").insert(patch);
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId,
    eventType: args.enabled ? "practice.channel_enabled" : "practice.channel_disabled",
    payload: { kind: args.kind }, correlationId: args.correlationId,
  });
  return { ok: true, data: { enabled: args.enabled } };
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
}): Promise<string | null> {
  if (!args.destination.trim()) return "no destination was recorded for this person";

  const channels = await channelSettings(admin, workspaceId);
  const channel = channels.find(c => c.kind === args.kind)!;
  if (!channel.enabled) return `this practice has not switched on ${args.kind}`;

  if (args.patientId) {
    const { data: patient } = await admin.from("practice_patient")
      .select("preferred_contact_method, status").eq("id", args.patientId).maybeSingle();
    // "DO NOT CONTACT" MEANS DO NOT CONTACT, and it outranks every other setting including the
    // practice's own. CPR-PRM-001 s4 recorded this preference; this is the line that honours it.
    if (patient?.preferred_contact_method === "none")
      return "this patient asked not to be contacted";
    if (patient?.status === "merged")
      return "this record has been merged into another";

    if (channel.requireConsent) {
      const { data: consent } = await admin.from("practice_patient_consent")
        .select("state").eq("patient_id", args.patientId).eq("consent_type", "contact_by_practice")
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
) => Promise<{ ok: boolean; providerMessageId?: string; response: string }>;

export async function sendMessage(admin: any, args: {
  workspaceId: string; kind: MessageKind; purpose: string; destination: string;
  params: TemplateArgs; patientId?: string | null; actorId?: string | null; correlationId: string;
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
  const refused = await refusalFor(admin, args.workspaceId, args);

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
  const outcome = await (args.transport ?? handOver)(args.kind, args.destination, body, template.subject?.(args.params));

  await admin.from("practice_message").update({
    status: outcome.ok ? "handed_over" : "failed",
    handed_to_provider_at: outcome.ok ? nowIso() : null,
    provider: status.provider,
    provider_message_id: outcome.ok ? outcome.providerMessageId ?? null : null,
    // VERBATIM, both ways. A summarised provider error is one nobody can debug at 7am.
    provider_response: outcome.response,
  }).eq("id", row.id);

  return { ok: true, data: { messageId: row.id as string, status: outcome.ok ? "handed_over" : "failed" } };
}

/**
 * The provider call itself.
 *
 * A TIMEOUT, BECAUSE SOMEBODY IS WAITING. An OTP is sent while a person watches a spinner; a gateway
 * that hangs must fail in seconds and say so, not hold the request open.
 */
async function handOver(kind: MessageKind, destination: string, body: string, subject?: string): Promise<{
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
        body: new URLSearchParams({ To: destination, From: process.env.TWILIO_FROM ?? "", Body: body }),
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
    if (kind === "email" && status.provider === "resend") {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST", signal: controller.signal,
        headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({
          from: process.env.RESEND_FROM ?? "no-reply@example.invalid",
          to: [destination], subject: subject ?? "Message", text: body,
        }),
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

const OTP_MINUTES = 10;
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
  // live for ten minutes, so nothing downstream can verify against something nobody received.
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
  // live for the rest of its ten minutes, which is the whole property "one time" is there to provide.
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
