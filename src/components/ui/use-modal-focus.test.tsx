// @vitest-environment jsdom
/**
 * Owner report, 25 Oct 2026: typing in /super-admin/users "Add User" moved the cursor to the close X after
 * each keystroke. Cause: the caller passes an inline onClose, the hook listed onDismiss as an effect
 * dependency, so every re-render re-ran the focus-in step. These tests type into a field inside a Modal
 * whose onClose is a fresh closure every render, exactly as the caller does.
 *
 * Paired with controls, so a hook that never moves focus at all cannot pass: focus still lands inside on
 * open, Escape still calls the LATEST onClose, and focus still returns to the trigger on close.
 */
import { describe, it, expect, afterEach } from "vitest";
import React, { useState } from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Modal } from "./interactive";

afterEach(cleanup);

function Harness({ onEscape }: { onEscape?: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  return (
    <div>
      <button onClick={() => setOpen(true)}>Open</button>
      {open && (
        // A fresh closure on every render, as UsersWorkspace passes it.
        <Modal open title="Add User" initialIndex={1} onClose={() => { onEscape?.(name); setOpen(false); }}>
          <label>Full name<input aria-label="Full name" value={name} onChange={e => setName(e.target.value)} /></label>
          <label>Email<input aria-label="Email" /></label>
        </Modal>
      )}
    </div>
  );
}

describe("useModalFocus via Modal", () => {
  it("keeps focus in the field while typing, even though onClose is a new closure each render", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Open"));
    // Control: focus moved INTO the dialog on open. (jsdom has no layout, so the hook's visibility filter
    // finds no focusables and focuses the panel itself -- in a browser it lands on the first field.)
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    const field = screen.getByLabelText("Full name") as HTMLInputElement;
    field.focus(); // the person clicks into the field
    // With onDismiss as an effect dependency, each change below re-ran the focus-in step and pulled focus
    // off the field (to the panel here, to the close X in a browser).
    for (const v of ["C", "Co", "Com", "Competen E"]) {
      fireEvent.change(field, { target: { value: v } });
      expect(document.activeElement).toBe(field);
    }
    expect(field.value).toBe("Competen E");
  });

  it("control: Escape calls the latest onClose (it sees the typed value) and focus returns to the trigger", () => {
    const seen: string[] = [];
    render(<Harness onEscape={n => seen.push(n)} />);
    const trigger = screen.getByText("Open");
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Ada" } });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(seen).toEqual(["Ada"]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
