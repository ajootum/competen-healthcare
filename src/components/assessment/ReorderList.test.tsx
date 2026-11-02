// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { useState } from "react";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { ReorderList } from "./ReorderList";

afterEach(cleanup);

interface Row { id: string; name: string }
const ROWS: Row[] = [{ id: "a", name: "Alpha" }, { id: "b", name: "Bravo" }, { id: "c", name: "Charlie" }];

function Box({ onReorder }: { onReorder?: (r: Row[]) => void }) {
  const [rows, setRows] = useState(ROWS);
  return <ReorderList items={rows} getKey={(r) => r.id} getLabel={(r) => r.name} ariaLabel="Sections" renderItem={(r) => <span>{r.name}</span>} onReorder={(n) => { setRows(n); onReorder?.(n); }} />;
}
const order = () => Array.from(document.querySelectorAll("li[data-reorder-key]")).map((l) => l.textContent?.match(/Alpha|Bravo|Charlie/)?.[0]);

describe("ReorderList", () => {
  it("Move down and Move up reorder, and announce the move", () => {
    const seen = vi.fn();
    render(<Box onReorder={seen} />);
    fireEvent.click(screen.getByRole("button", { name: "Move Alpha down" }));
    expect(order()).toEqual(["Bravo", "Alpha", "Charlie"]);
    expect(seen.mock.calls[0][0].map((r: Row) => r.id)).toEqual(["b", "a", "c"]);
    expect(screen.getByRole("status").textContent).toBe("Moved Alpha to position 2 of 3.");
    fireEvent.click(screen.getByRole("button", { name: "Move Charlie up" }));
    expect(order()).toEqual(["Bravo", "Charlie", "Alpha"]);
    expect(screen.getByRole("status").textContent).toBe("Moved Charlie to position 2 of 3.");
  });

  it("the first Move up and the last Move down are disabled", () => {
    render(<Box />);
    expect((screen.getByRole("button", { name: "Move Alpha up" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Move Charlie down" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a pointer drag from one row's grip to another reorders; a tap does not", () => {
    const seen = vi.fn();
    render(<Box onReorder={seen} />);
    const rows = Array.from(document.querySelectorAll("li[data-reorder-key]")) as HTMLElement[];
    const grip = screen.getByRole("button", { name: /Drag Alpha/ });
    // jsdom has no layout: point the hit test at the third row
    (document as unknown as { elementFromPoint: () => Element }).elementFromPoint = () => rows[2].firstElementChild!;
    fireEvent.pointerDown(grip, { clientX: 0, clientY: 0, button: 0 });
    act(() => { window.dispatchEvent(new MouseEvent("pointermove", { clientX: 0, clientY: 2 })); });
    act(() => { window.dispatchEvent(new MouseEvent("pointerup")); });
    expect(seen).not.toHaveBeenCalled();
    fireEvent.pointerDown(grip, { clientX: 0, clientY: 0, button: 0 });
    act(() => { window.dispatchEvent(new MouseEvent("pointermove", { clientX: 0, clientY: 40 })); });
    act(() => { window.dispatchEvent(new MouseEvent("pointerup")); });
    expect(order()).toEqual(["Bravo", "Charlie", "Alpha"]);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("disabled lists have no controls", () => {
    render(<ReorderList items={ROWS} getKey={(r) => r.id} getLabel={(r) => r.name} ariaLabel="Sections" renderItem={(r) => <span>{r.name}</span>} onReorder={() => undefined} disabled />);
    expect(screen.queryAllByRole("button").length).toBe(0);
  });
});
