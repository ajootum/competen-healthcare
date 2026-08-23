import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { sendMessage, messagingStatus, MESSAGE_PURPOSES, type Transport } from "@/lib/practice/messaging";

// WhatsApp as a third delivery kind. The channel is template-closed and consent-gated exactly as SMS and
// email are, and these tests exist for the three things that are specific to WhatsApp and would otherwise
// only be discovered on a patient's handset:
//
//   1. Meta addresses template variables POSITIONALLY as {{1}}, {{2}}. Swapping two params silently sends
//      a date where a practitioner name belongs. Nothing in the type system catches that.
//   2. A purpose with no approved template must REFUSE rather than fall back to free text -- Meta would
//      reject it anyway, but the refusal has to be ours or the record claims a shape that never went.
//   3. The words we compose are NOT the words WhatsApp sends. body is our rendering; provider_template_name
//      is the only thing tying a delivered message to the version Meta held.

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Records what the engine hands the provider, and what it writes to practice_message. */
function stub(kind: string = "whatsapp") {
  const writes: { table: string; op: string; row: any }[] = [];
  const handed: { kind: string; destination: string; body: string; wa: any }[] = [];

  const admin: any = {
    from(table: string) {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        // channel enabled, consent not required -- the refusal paths have their own harness coverage.
        maybeSingle: async () => ({
          data: table === "practice_message_channel"
            ? { id: "ch-1", kind, enabled: true, require_consent: false, sender_name: "Dr Ajootum" }
            : { id: "row-1" },
          error: null,
        }),
        single: async () => ({ data: { id: "msg-1" }, error: null }),
        insert: (row: any) => { writes.push({ table, op: "insert", row }); return chain; },
        update: (row: any) => { writes.push({ table, op: "update", row }); return chain; },
        then: (res: any) => res({
          data: table === "practice_message_channel"
            ? [{ kind, enabled: true, require_consent: false, sender_name: "Dr Ajootum" }]
            : [],
          error: null,
        }),
      };
      return chain;
    },
  };

  const transport: Transport = async (kind, destination, body, _subject, wa) => {
    handed.push({ kind, destination, body, wa });
    return { ok: true, providerMessageId: "wamid.TEST", response: "{}" };
  };

  return { admin, transport, handed, writes };
}

const send = (purpose: string, params: Record<string, string | number>, kind = "whatsapp") => {
  // The channel row must match the kind under test -- a stub that always answers "whatsapp" refuses the
  // sms send before it reaches the transport, and the assertion then fails for the wrong reason.
  const s = stub(kind);
  return sendMessage(s.admin, {
    workspaceId: "ws-1", kind: kind as any, purpose, destination: "+256700000000",
    params, correlationId: "corr-1", transport: s.transport,
  }).then(result => ({ ...s, result }));
};

// ⚠ ENV IS SET PER TEST AND UNSTUBBED AFTER EACH, and finding out why cost a real bug in this file.
// vi.restoreAllMocks() does NOT undo vi.stubEnv, so the WhatsApp credentials set in the first describe
// block leaked into every test below it -- the send tests were passing because of a provider configured
// by an unrelated assertion three blocks earlier, and the SMS control failed for that reason rather
// than the one it names. A suite whose passes depend on execution order is not a suite.
beforeEach(() => {
  vi.stubEnv("WHATSAPP_TOKEN", "tok");
  vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "123");
  vi.stubEnv("TWILIO_ACCOUNT_SID", "AC_test");
  vi.stubEnv("TWILIO_AUTH_TOKEN", "tok");
  vi.stubEnv("TWILIO_FROM_NUMBER", "+15550000000");
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("whatsapp is configured independently of sms and email", () => {
  it("is not configured without BOTH a token and a phone number id", () => {
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "");   // token stays set by beforeEach
    expect(messagingStatus().whatsapp.configured).toBe(false);
  });

  it("is configured with both, and reports NO receipts because we host no webhook", () => {
    const w = messagingStatus().whatsapp;
    expect(w).toMatchObject({ configured: true, provider: "whatsapp_cloud", receiptsAvailable: false });
    // WhatsApp does emit receipts; claiming them without the webhook would make delivery_confirmed_at
    // read as a permanent failure.
  });
});

describe("the template contract with Meta", () => {
  it("hands over the APPROVED TEMPLATE NAME, never the composed body", async () => {
    const { handed } = await send("appointment_reminder", { practitioner: "Dr Ajootum", when: "Tue 3pm" });

    expect(handed).toHaveLength(1);
    expect(handed[0].wa?.template).toBe("appointment_reminder");
  });

  it("orders parameters to match the body text — the swap nothing else would catch", async () => {
    const { handed } = await send("appointment_reminder", { practitioner: "Dr Ajootum", when: "Tue 3pm" });

    // {{1}} is the practitioner, {{2}} is the time. Reversed, a patient is told their appointment is
    // with "Tue 3pm" on "Dr Ajootum".
    expect(handed[0].wa?.params).toEqual(["Dr Ajootum", "Tue 3pm"]);
    // Pinned against the body so the two renderings cannot drift apart silently.
    expect(handed[0].body).toBe("Reminder: your appointment with Dr Ajootum is on Tue 3pm.");
  });

  it("orders the OTP parameters as code then minutes", async () => {
    const { handed } = await send("otp_booking", { code: "481920", minutes: 10 });
    expect(handed[0].wa?.params).toEqual(["481920", "10"]);
  });

  it("RECORDS which approved template was invoked, so body is never the only evidence", async () => {
    const { writes } = await send("appointment_confirmation", { practitioner: "Dr Ajootum", when: "Tue 3pm" });

    const upd = writes.find(w => w.table === "practice_message" && w.op === "update");
    expect(upd?.row.provider_template_name).toBe("appointment_confirmation");
  });

  it("records NO template for sms, where the body genuinely is the message", async () => {
    const { writes, handed } = await send("appointment_confirmation", { practitioner: "Dr A", when: "Tue" }, "sms");

    expect(handed[0].wa).toBeUndefined();
    const upd = writes.find(w => w.table === "practice_message" && w.op === "update");
    expect(upd?.row.provider_template_name).toBeNull();
  });
});

describe("the closed list still closes", () => {
  it("refuses a purpose that has no template at all", async () => {
    const { result } = await send("send_the_patient_anything_i_type", {});
    expect(result.ok && result.data.status).not.toBe("handed_over");
    if (!result.ok) expect(result.code).toBe("UNKNOWN_PURPOSE");
  });

  it("refuses a purpose whose template does not admit whatsapp", async () => {
    // invitation_code is email-only: it names a practice and carries a joining code.
    const { result, handed } = await send("invitation_code", { practice: "X", code: "Y", expires: "Z" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("WRONG_CHANNEL");
    expect(handed).toHaveLength(0);   // nothing reached the provider
  });

  it("NO purpose can reach WhatsApp without an approved template — asserted unconditionally", async () => {
    // ⚠ THIS TEST WAS VACUOUS ON ITS FIRST WRITING and the break-test caught it: the assertion sat inside
    // `if (r.ok && s.handed.length)`, so a refused send skipped it silently and removing the guard in
    // handOver reded nothing. A conditional assertion is not an assertion.
    //
    // The invariant, stated so every purpose must satisfy one arm or the other: a whatsapp send either
    // REFUSES with WRONG_CHANNEL, or reaches the provider WITH a mapping. Never reaches it without one --
    // which is what adding "whatsapp" to a template's kinds and forgetting the mapping would produce, and
    // Meta rejects free text outside a 24-hour window, so it would fail only in production.
    expect(MESSAGE_PURPOSES.length).toBeGreaterThan(0);

    for (const purpose of MESSAGE_PURPOSES) {
      const s = stub();
      const r = await sendMessage(s.admin, {
        workspaceId: "ws-1", kind: "whatsapp", purpose, destination: "+256700000000",
        params: { code: "1", minutes: "2", practitioner: "P", when: "W", practice: "X", expires: "Z" },
        correlationId: "c", transport: s.transport,
      });

      const refusedChannel = !r.ok && r.code === "WRONG_CHANNEL";
      const handedWithTemplate = s.handed.length === 1 && !!s.handed[0].wa?.template;
      expect(refusedChannel || handedWithTemplate,
        `${purpose}: neither refused as WRONG_CHANNEL nor handed over with a template`).toBe(true);
      // And never both-ways-wrong: nothing may reach the provider without a mapping.
      expect(s.handed.some(h => !h.wa), `${purpose} reached the provider with no approved template`).toBe(false);
    }
  });
});
