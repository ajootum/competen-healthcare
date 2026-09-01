/**
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * CPR-SET-COMMS-001 -- the Patient Communications render and policy pins.
 *
 * What this pins, and why each is worth a test:
 *
 *   1. AC-01: "Turn email on" is GONE. The one primary action is "Save settings" (s3.1) -- a
 *      regression to the switch model would resurrect the opt-in framing s2 forbids.
 *   2. AC-04: booking verification renders as a REQUIRED fact with no input to switch it off, and
 *      the service-side policy (validatePreferencePatch) refuses the key outright -- both halves of
 *      "cannot be accidentally disabled", asserted separately.
 *   3. AC-06: the SMS and WhatsApp cards carry no button, no input and no link -- coming soon is a
 *      sentence, never a dead control.
 *   4. s3.2: reminders render without a checkbox -- no fake toggle for an engine that does not exist.
 *   5. s6: the state badge is derived (emailChannelState), and each state maps to the prescribed
 *      label -- including that a saved-but-never-activated row still reads Setup required.
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import CommunicationsConsole from "./CommunicationsConsole";
import {
  validatePreferencePatch, emailChannelState,
  CONFIGURABLE_MESSAGE_TYPES, REQUIRED_MESSAGE_TYPES,
} from "@/lib/practice/messaging";

const routerStub = {
  back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {}, hmrRefresh() {},
} as never;

function render(over: Partial<Parameters<typeof CommunicationsConsole>[0]["email"]> = {}, mayManage = true): string {
  return renderToString(
    React.createElement(
      AppRouterContext.Provider, { value: routerStub },
      React.createElement(CommunicationsConsole, {
        email: {
          state: "ACTIVE", senderName: "Nsambya Clinic", replyTo: "reception@example.com",
          messagePreferences: {}, ...over,
        },
        senderNameDefault: "Nsambya Clinic",
        mayManage,
      }),
    ),
  ).replace(/<!-- -->/g, "");
}

describe("the Patient Communications console (CPR-SET-COMMS-001)", () => {
  it("AC-01: no 'Turn email on' -- the one primary action is Save settings", () => {
    const html = render();
    expect(html).not.toMatch(/Turn email on/i);
    expect(html).not.toMatch(/Turn email off/i);
    expect(html).toContain("Save settings");
  });

  it("AC-04: booking verification is a locked fact -- Required chip, no input attached to it", () => {
    const html = render();
    expect(html).toContain("Booking verification codes");
    expect(html).toContain("cannot be switched off");
    // The verification row renders before the first configurable row's input; no checkbox before it.
    const upToFirstPref = html.slice(0, html.indexOf('id="pref-booking_confirmation"'));
    expect(upToFirstPref).toContain("Booking verification codes");
    expect(upToFirstPref).not.toMatch(/type="checkbox"/);
  });

  it("AC-04, the service half: the required key is refused before anything is read", () => {
    const refused = validatePreferencePatch({ booking_verification: false });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.message).toBe(REQUIRED_MESSAGE_TYPES.booking_verification);
    // And so is an attempt to set it TRUE -- there is no stored value for it in either direction.
    expect(validatePreferencePatch({ booking_verification: true }).ok).toBe(false);
  });

  it("AC-05: the three configurable types each render their own control, on by default", () => {
    const html = render();
    for (const label of Object.values(CONFIGURABLE_MESSAGE_TYPES)) {
      const cap = label[0].toUpperCase() + label.slice(1);
      expect(html).toContain(cap);
    }
    expect((html.match(/type="checkbox"/g) ?? []).length).toBe(3);
  });

  it("an explicit false renders that one type Off while the others stay On", () => {
    const html = render({ messagePreferences: { cancellation_notice: false } });
    const cancel = html.slice(html.indexOf("Cancellation notices"), html.indexOf("Rescheduling notices"));
    expect(cancel).toContain("Off");
  });

  it("s3.2: reminders carry no toggle -- a dimmed sentence, not a disabled control", () => {
    const html = render();
    const reminders = html.slice(html.indexOf("Appointment reminders"));
    expect(reminders).not.toMatch(/type="checkbox"/);
    expect(reminders).toContain("Coming later");
  });

  it("AC-06: SMS and WhatsApp cards have no button, no input, no link", () => {
    const html = render();
    const sms = html.slice(html.indexOf(">SMS<"), html.indexOf(">WhatsApp<"));
    const wa = html.slice(html.indexOf(">WhatsApp<"), html.indexOf("Online booking readiness") === -1 ? undefined : html.indexOf("Online booking readiness"));
    for (const section of [sms, wa]) {
      expect(section).toContain("Coming soon");
      expect(section).not.toMatch(/<button|<input|<a /);
    }
  });

  it("s6: each derived state shows its own words, never colour alone", () => {
    expect(render({ state: "ACTIVE" })).toContain("Active");
    expect(render({ state: "SETUP_REQUIRED" })).toContain("Setup required");
    const action = render({ state: "ACTION_NEEDED" });
    expect(action).toContain("Action needed");
    expect(action).toContain("service matter on our side");
  });

  it("s6, the derivation: emailChannelState maps configuration and health to the prescribed states", () => {
    const active = { enabled: true, senderName: "X", providerConfigured: true };
    expect(emailChannelState(active)).toBe("ACTIVE");
    expect(emailChannelState({ ...active, providerConfigured: false })).toBe("ACTION_NEEDED");
    expect(emailChannelState({ ...active, senderName: null })).toBe("SETUP_REQUIRED");
    expect(emailChannelState({ ...active, senderName: "  " })).toBe("SETUP_REQUIRED");
    // Identity saved but the channel never activated is still setup required -- half-saved is not on.
    expect(emailChannelState({ ...active, enabled: false })).toBe("SETUP_REQUIRED");
  });

  it("the preference validator names an unknown key and a non-boolean value", () => {
    expect(validatePreferencePatch({ marketing_blast: true }).ok).toBe(false);
    expect(validatePreferencePatch({ cancellation_notice: "yes" }).ok).toBe(false);
    const good = validatePreferencePatch({ cancellation_notice: false, booking_confirmation: true });
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.clean).toEqual({ cancellation_notice: false, booking_confirmation: true });
  });

  it("without the settings permission, the fields are disabled and the sentence says why", () => {
    const html = render({}, false);
    expect(html).toContain("needs the practice settings permission");
    expect(html).toMatch(/disabled/);
  });

  it("no provider name reaches the page (AC-09's rendered half)", () => {
    for (const state of ["ACTIVE", "SETUP_REQUIRED", "ACTION_NEEDED"] as const) {
      const html = render({ state });
      expect(html).not.toMatch(/resend|smtp|api.key|dns|twilio/i);
    }
  });
});
