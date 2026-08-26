import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { emailFrom, smsFrom, replyTo, resendEmailBody, channelProviders } from "@/lib/notifications/dispatch";

// The email payload and the four env resolvers behind it, tested by RUNNING them.
//
// ⚠ THE reply_to GAP THIS CLOSES. Neither send path set reply_to, so the FROM address was the reply
// target by default. Fine for a monitored mailbox, silently wrong for a no-reply one: a patient
// answering a booking confirmation -- "can I move this to Thursday?" -- reached nobody, and nothing
// reported a failure, because there was none. The message was delivered. The answer was not.
//
// ⚠ AND THE PAYLOAD IS NOW BUILT IN ONE PLACE. dispatch.ts and messaging.ts each wrote their own
// object literal, which is exactly how they came to disagree about sender variable names -- a
// deployment setting one got half its messaging working while the other half reported "not ready".

const KEYS = [
  "NOTIFY_FROM_EMAIL", "RESEND_FROM", "TWILIO_FROM_NUMBER", "TWILIO_FROM",
  "NOTIFY_REPLY_TO", "RESEND_REPLY_TO", "RESEND_API_KEY",
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => { for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

describe("sender and reply-to resolution", () => {
  // ⚠ EITHER NAME CONFIGURES BOTH STACKS. The whole point of accepting two names is that one value
  // works everywhere; a test that only ever sets the preferred name would never notice the fallback
  // breaking.
  it("emailFrom accepts either variable, preferring its own historical name", () => {
    process.env.RESEND_FROM = "b@competenhealthcare.com";
    expect(emailFrom()).toBe("b@competenhealthcare.com");
    process.env.NOTIFY_FROM_EMAIL = "a@competenhealthcare.com";
    expect(emailFrom()).toBe("a@competenhealthcare.com");
  });

  it("smsFrom accepts either variable, same shape", () => {
    process.env.TWILIO_FROM = "+256700000000";
    expect(smsFrom()).toBe("+256700000000");
    process.env.TWILIO_FROM_NUMBER = "+256711111111";
    expect(smsFrom()).toBe("+256711111111");
  });

  it("replyTo accepts either variable and is null when neither is set", () => {
    expect(replyTo()).toBeNull();
    process.env.RESEND_REPLY_TO = "b@competenhealthcare.com";
    expect(replyTo()).toBe("b@competenhealthcare.com");
    process.env.NOTIFY_REPLY_TO = "a@competenhealthcare.com";
    expect(replyTo()).toBe("a@competenhealthcare.com");
  });
});

describe("resendEmailBody", () => {
  const base = { from: "hello@competenhealthcare.com", to: "p@example.com", subject: "S", text: "T" };

  it("builds the payload Resend expects, with `to` always an array", () => {
    expect(resendEmailBody(base)).toEqual({
      from: "hello@competenhealthcare.com", to: ["p@example.com"], subject: "S", text: "T",
    });
  });

  it("passes an array recipient through unchanged", () => {
    expect(resendEmailBody({ ...base, to: ["a@x.com", "b@x.com"] }).to).toEqual(["a@x.com", "b@x.com"]);
  });

  // ⚠ AN ABSENT REPLY-TO MUST BE AN ABSENT KEY. Resend treats an explicit null as a value and rejects
  // it, so `reply_to: null` would turn a missing setting into a provider error that reads like an
  // outage. `toEqual` above would pass with the key present and undefined; this asserts on the keys.
  it("OMITS reply_to entirely when none is configured", () => {
    const body = resendEmailBody(base);
    expect(Object.keys(body)).not.toContain("reply_to");
    expect("reply_to" in body).toBe(false);
  });

  it("includes reply_to from the environment when set", () => {
    process.env.NOTIFY_REPLY_TO = "reception@competenhealthcare.com";
    expect(resendEmailBody(base).reply_to).toBe("reception@competenhealthcare.com");
  });

  // An explicit argument is how a per-practice reply address would arrive later, so it must win over
  // the deployment-wide default rather than being ignored.
  it("an explicit replyTo argument overrides the environment", () => {
    process.env.NOTIFY_REPLY_TO = "deployment@competenhealthcare.com";
    expect(resendEmailBody({ ...base, replyTo: "clinic@competenhealthcare.com" }).reply_to)
      .toBe("clinic@competenhealthcare.com");
  });

  it("an explicit null argument falls back to the environment rather than forcing absence", () => {
    process.env.NOTIFY_REPLY_TO = "deployment@competenhealthcare.com";
    expect(resendEmailBody({ ...base, replyTo: null }).reply_to).toBe("deployment@competenhealthcare.com");
  });
});

describe("channelProviders", () => {
  // ⚠ A KEY WITHOUT A SENDER IS NOT A CONFIGURED PROVIDER. A deployment with only a key once reported
  // "configured" and then sent from an invalid domain, which Resend rejects.
  it("email is not ready with a key but no sender", () => {
    process.env.RESEND_API_KEY = "re_test";
    expect(channelProviders().email).toEqual({ ready: false, provider: null });
  });

  it("email is not ready with a sender but no key", () => {
    process.env.NOTIFY_FROM_EMAIL = "hello@competenhealthcare.com";
    expect(channelProviders().email).toEqual({ ready: false, provider: null });
  });

  it("email is ready only with both", () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.NOTIFY_FROM_EMAIL = "hello@competenhealthcare.com";
    expect(channelProviders().email).toEqual({ ready: true, provider: "resend" });
  });

  it("in-app is always deliverable and needs no provider", () => {
    expect(channelProviders().in_app).toEqual({ ready: true, provider: "internal" });
  });
});
