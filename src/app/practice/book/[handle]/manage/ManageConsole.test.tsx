// @vitest-environment jsdom
/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════════
 * CPR-BOOK-MGMT-006 §23 -- "Cancel then back out -> Appointment remains confirmed."
 *
 * ⚠ THE ONLY ROW IN THE MATRIX THAT CANNOT BE ANSWERED BY AN ENGINE TEST. Whether backing out of a
 * cancellation leaves the appointment alone is not a fact about `cancelManagedBooking` -- it is a fact
 * about whether the screen asked it anything. Every other row is decided server-side; this one is
 * decided by two clicks, and the failure mode is a destructive act that fires on the first of them.
 *
 * ⚠ AND IT IS WHY THIS FILE INTRODUCED A DOM. The repository's other component tests use
 * `renderToString`, which renders once and cannot click -- so this row sat uncovered while the file
 * next to it said so. jsdom + Testing Library are devDependencies; the `@vitest-environment` docblock
 * above scopes the DOM to this file, so the 400-odd node-environment tests are untouched.
 *
 * ⚠ THE NEGATIVE ASSERTION HERE IS WORTHLESS ALONE, so it is never made alone. "No cancellation was
 * sent" also passes when the cancel button is broken, when the panel never opened, and when the whole
 * screen failed to render -- which is the shape this codebase has recorded as the fixture that cannot
 * fail. Every back-out test below is paired with a control in the same file that performs the real
 * cancellation and watches the request go.
 * ════════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import ManageConsole from "./ManageConsole";

const IDENTITY = {
  displayName: "Amara Nsubuga", credentials: "MBChB", specialty: "General practice",
  initials: "AN", photoUrl: null,
};

const REFERENCE = "CP-DDC19D";
const SCHEDULED_AT = "2026-10-03T08:00:00.000Z";   // 11:00 Kampala, Saturday

const booking = {
  reference: REFERENCE, requestId: "req-1", appointmentId: "appt-1",
  status: "CONFIRMED", scheduledAt: SCHEDULED_AT, durationMinutes: 60,
  appointmentType: "new_consultation",
  locationId: "loc-tmr", locationName: "TMR International Hospital",
  locationMode: "in_person", locationAddress: "Plot 6, Nakasero Road, Kampala", locationMapUrl: null,
  instructions: null,
  canReschedule: true, canCancel: true, whyNot: null,
};

/** Every action the console posted, in order. The assertions are made against this. */
let posted: Array<Record<string, unknown>>;

/**
 * The manage endpoint, as far as this screen uses it.
 *
 * ⚠ IT ANSWERS `cancel` SUCCESSFULLY. A stub that refused would make the back-out test pass for the
 * wrong reason -- the appointment would survive because the server said no, not because the screen
 * never asked. The only thing standing between this fixture and a cancelled appointment is the second
 * click.
 */
function stubFetch() {
  return vi.fn(async (_url: string, init: any) => {
    const body = JSON.parse(String(init.body));
    posted.push(body);
    const reply = (data: unknown) => ({ ok: true, status: 200, json: async () => data });

    switch (body.action) {
      case "request_code": return reply({ challengeId: "chal-1", expiresAt: "later" });
      case "confirm_code": return reply({ token: "tok-1" });
      case "list": return reply({
        bookings: posted.some(p => p.action === "cancel")
          ? [{ ...booking, status: "CANCELLED", canReschedule: false, canCancel: false }]
          : [booking],
        past: [], pastWindowDays: 180, listIncomplete: false, referenceNote: "",
      });
      case "cancel": return reply({
        reference: REFERENCE, appointmentId: "appt-1", status: "CANCELLED",
        reasonStoredOnBooking: true, confirmationSent: true,
        confirmationNote: "This appointment has been cancelled, and a confirmation is on its way to you.",
      });
      default: return reply({});
    }
  });
}

beforeEach(() => {
  posted = [];
  vi.stubGlobal("fetch", stubFetch());
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** Verify an address and reach the appointment, which is where every test below starts. */
async function openMyAppointment() {
  render(<ManageConsole handle="elisham1" identity={IDENTITY as any} timezone="Africa/Kampala" />);

  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "patient@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: /send me a code/i }));

  fireEvent.change(await screen.findByLabelText("Six-digit verification code"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: /show my appointment/i }));

  // ⚠ THE PRECONDITION IS ASSERTED, NOT ASSUMED. If this never appeared, every "nothing was cancelled"
  // below would be true of a blank screen.
  //
  // findAll, not find: one test lists two appointments, and the singular query throws on the second
  // rather than returning either -- which would fail this helper for having succeeded twice over.
  expect((await screen.findAllByText("Your appointment is confirmed")).length).toBeGreaterThan(0);
}

const cancelRequests = () => posted.filter(p => p.action === "cancel");

describe("§23 -- cancel, then back out", () => {
  it("opening the confirmation does not cancel anything", async () => {
    await openMyAppointment();

    fireEvent.click(screen.getByRole("button", { name: /^cancel appointment$/i }));

    // §12: the confirmation restates what is being cancelled rather than asking against a heading alone.
    expect(await screen.findByText("Cancel this appointment?")).toBeTruthy();
    expect(screen.getByRole("button", { name: /keep appointment/i })).toBeTruthy();

    // ⚠ THE ROW ITSELF. Arming a destructive act is not performing it.
    expect(cancelRequests()).toEqual([]);
    expect(screen.getByText("Your appointment is confirmed")).toBeTruthy();
  });

  it("⚠ BACKING OUT LEAVES THE APPOINTMENT CONFIRMED, and sends nothing at all", async () => {
    await openMyAppointment();

    fireEvent.click(screen.getByRole("button", { name: /^cancel appointment$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /keep appointment/i }));

    // The confirmation is gone and the appointment is exactly as it was.
    await waitFor(() => expect(screen.queryByText("Cancel this appointment?")).toBeNull());
    expect(screen.getByText("Your appointment is confirmed")).toBeTruthy();
    // Both actions are still on offer -- backing out must not leave the card half-disarmed.
    expect(screen.getByRole("button", { name: /reschedule appointment/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^cancel appointment$/i })).toBeTruthy();

    expect(cancelRequests()).toEqual([]);
  });

  it("⚠ THE CONTROL: confirming really does cancel, so the two tests above mean something", async () => {
    // Without this, everything above passes on a screen whose cancel button does nothing -- and a
    // product where nobody can cancel would score full marks on this row.
    await openMyAppointment();

    fireEvent.click(screen.getByRole("button", { name: /^cancel appointment$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /yes, cancel appointment/i }));

    await waitFor(() => expect(cancelRequests()).toHaveLength(1));
    expect(cancelRequests()[0]).toMatchObject({ reference: REFERENCE, token: "tok-1" });
    // §20 / AC-18: the outcome is stated, and the list is re-read rather than patched in the browser.
    expect(await screen.findByText(/has been cancelled/i)).toBeTruthy();
    expect(await screen.findByText("Appointment cancelled")).toBeTruthy();
  });

  it("⚠ THE REASON IS DISCARDED WHEN THE PATIENT BACKS OUT", async () => {
    // Somebody types why they are cancelling, thinks better of it, and keeps the appointment. If the
    // box still held that text next time the panel opened, the next confirmation would carry a
    // sentence written about a decision that was reversed -- and it would be sent to the practice.
    await openMyAppointment();

    fireEvent.click(screen.getByRole("button", { name: /^cancel appointment$/i }));
    const reason = await screen.findByRole("textbox");
    fireEvent.change(reason, { target: { value: "Travelling that week" } });
    fireEvent.click(screen.getByRole("button", { name: /keep appointment/i }));

    fireEvent.click(screen.getByRole("button", { name: /^cancel appointment$/i }));
    expect((await screen.findByRole("textbox") as HTMLTextAreaElement).value).toBe("");
    expect(cancelRequests()).toEqual([]);
  });

  it("cancels the appointment the patient pointed at, where two are listed", async () => {
    // ⚠ §12's REASON FOR RESTATING THE DETAILS: "somebody cancelling the wrong one of two has no way
    // back from here". So the panel must open under the card that was clicked, and the request must
    // name that one -- a screen keying the panel on anything but the reference would open both.
    const second = { ...booking, reference: "CP-AAAAAA", requestId: "req-2", appointmentId: "appt-2",
      scheduledAt: "2026-10-10T08:00:00.000Z" };
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: any) => {
      const body = JSON.parse(String(init.body));
      posted.push(body);
      const reply = (data: unknown) => ({ ok: true, status: 200, json: async () => data });
      if (body.action === "request_code") return reply({ challengeId: "chal-1" });
      if (body.action === "confirm_code") return reply({ token: "tok-1" });
      if (body.action === "list")
        return reply({ bookings: [booking, second], past: [], pastWindowDays: 180, listIncomplete: false, referenceNote: "" });
      return reply({ reference: "CP-AAAAAA", status: "CANCELLED", confirmationNote: "Cancelled." });
    }));

    await openMyAppointment();

    // The second card, found by its own reference rather than by position.
    const card = screen.getByText("CP-AAAAAA").closest("section")!;
    fireEvent.click(within(card).getByRole("button", { name: /^cancel appointment$/i }));

    expect(within(card).getByText("Cancel this appointment?")).toBeTruthy();
    const first = screen.getByText(REFERENCE).closest("section")!;
    expect(within(first).queryByText("Cancel this appointment?")).toBeNull();

    fireEvent.click(within(card).getByRole("button", { name: /yes, cancel appointment/i }));
    await waitFor(() => expect(cancelRequests()).toHaveLength(1));
    expect(cancelRequests()[0].reference).toBe("CP-AAAAAA");
  });
});
