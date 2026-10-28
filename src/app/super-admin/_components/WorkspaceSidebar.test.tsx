// @vitest-environment jsdom
/**
 * HQ-NAV-EXPAND-01 — the HQ sidebar's parents expand and collapse; only submenu rows navigate.
 *
 * Renders the REAL sidebar over the REAL registry (nav-tables.ts) and the real capability filter. Only the
 * router is stood in for: the pathname is a variable here, and next/link is a plain anchor so a row's
 * destination is its href.
 *
 * Acceptance (directive): "on a tablet, tapping Governance, Quality, AI or any other parent with children
 * opens its submenu without navigating. Navigation happens only on a submenu item, including Overview."
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

let pathname = "/super-admin";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

import WorkspaceSidebar from "./WorkspaceSidebar";
import HqMobileNav from "./HqMobileNav";

const sidebar = (over: Partial<React.ComponentProps<typeof WorkspaceSidebar>> = {}) => (
  <WorkspaceSidebar profileName="Test" roles={[]} activeRole={null} workspaces={[]} isOwner hqCapabilities={[]} {...over} />
);
const parent = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) });
const region = (btn: HTMLElement) => document.getElementById(btn.getAttribute("aria-controls")!)!;
const lit = () => [...document.querySelectorAll("a[aria-current=page]")].map(a => a.textContent?.trim());

// jsdom has no layout, so no scrollIntoView: the sidebar calls it to bring the lit row into view.
Element.prototype.scrollIntoView = vi.fn();

beforeEach(() => { pathname = "/super-admin"; try { sessionStorage.clear(); } catch { /* jsdom */ } });
afterEach(cleanup);

describe("parent modules are disclosures, not links", () => {
  it("tapping a workspace opens its submenu, tapping again closes it, and it is never a link", () => {
    render(sidebar());
    const gov = parent("Governance & Administration");
    expect(gov.tagName).toBe("BUTTON");
    expect(gov.closest("a")).toBeNull();
    expect(gov.getAttribute("aria-expanded")).toBe("false");
    expect(region(gov).hidden).toBe(true);
    fireEvent.click(gov);
    expect(gov.getAttribute("aria-expanded")).toBe("true");
    expect(region(gov).hidden).toBe(false);
    fireEvent.click(gov);
    expect(gov.getAttribute("aria-expanded")).toBe("false");
  });

  it("does not navigate: the click leaves the page where it was", () => {
    const before = window.location.href;
    render(sidebar());
    fireEvent.click(parent("AI & Intelligence"));
    expect(window.location.href).toBe(before);
  });

  it("an item with children (Competency Delivery) toggles too, and its submenu starts with Overview on the landing page", () => {
    render(sidebar());
    fireEvent.click(parent("Competency Frameworks"));
    const delivery = parent("Competency Delivery");
    expect(delivery.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(delivery);
    const links = within(region(delivery)).getAllByRole("link");
    expect(links[0].textContent?.trim()).toBe("Overview");
    expect(links[0].getAttribute("href")).toBe("/super-admin/delivery");
    expect(links.map(l => l.getAttribute("href"))).toContain("/super-admin/delivery/reminders");
  });

  it("control: a parent WITHOUT children is still a plain link that navigates (Command Centre)", () => {
    render(sidebar());
    const cc = screen.getByRole("link", { name: /Command Centre/ });
    expect(cc.getAttribute("href")).toBe("/super-admin/command-centre");
  });

  it("several parents can be open at once (no accordion)", () => {
    render(sidebar());
    fireEvent.click(parent("Products"));
    fireEvent.click(parent("Platform Operations"));
    expect(parent("Products").getAttribute("aria-expanded")).toBe("true");
    expect(parent("Platform Operations").getAttribute("aria-expanded")).toBe("true");
  });

  it("is operable by keyboard: Enter and Space on a focused parent toggle it", async () => {
    const user = userEvent.setup();
    render(sidebar());
    const ai = parent("AI & Intelligence");
    ai.focus();
    await user.keyboard("{Enter}");
    expect(ai.getAttribute("aria-expanded")).toBe("true");
    await user.keyboard(" ");
    expect(ai.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("the active page", () => {
  it("opens its workspace and its parent item by itself, and lights exactly the child", () => {
    pathname = "/super-admin/cgr/risk";
    render(sidebar());
    expect(parent("Competency Frameworks").getAttribute("aria-expanded")).toBe("true");
    expect(parent("Governance & Regulation Home").getAttribute("aria-expanded")).toBe("true");
    expect(lit()).toEqual(["Exception, Escalation & Risk"]);
  });

  it("on a parent's landing page, Overview is the one lit row", () => {
    pathname = "/super-admin/delivery";
    render(sidebar());
    expect(parent("Competency Delivery").getAttribute("aria-expanded")).toBe("true");
    expect(lit()).toEqual(["Overview"]);
  });

  it("closing the active parent sticks on that page, and it re-opens on arrival at another page inside it", () => {
    pathname = "/super-admin/governance/risk";
    const { rerender } = render(sidebar());
    const gov = parent("Governance & Administration");
    fireEvent.click(gov);
    expect(gov.getAttribute("aria-expanded")).toBe("false");
    pathname = "/super-admin/governance/audit";
    rerender(sidebar());
    expect(parent("Governance & Administration").getAttribute("aria-expanded")).toBe("true");
  });

  it("what you open stays open as you move to another page", () => {
    const { rerender } = render(sidebar());
    fireEvent.click(parent("Platform Operations"));
    pathname = "/super-admin/command-centre";
    rerender(sidebar());
    expect(parent("Platform Operations").getAttribute("aria-expanded")).toBe("true");
  });
});

describe("authority is unchanged", () => {
  it("a viewer is offered only the parents their capabilities open", () => {
    render(sidebar({ isOwner: false, hqCapabilities: ["hq.quality.case.author"] }));
    expect(screen.getAllByRole("button").map(b => b.getAttribute("title"))).toEqual(["Learning & Knowledge"]);
  });
});

describe("tablet and phone", () => {
  it("parents carry the coarse-pointer touch target (pointer-coarse, never a viewport width)", () => {
    render(sidebar());
    for (const b of screen.getAllByRole("button")) expect(b.className).toContain("pointer-coarse:min-h-[var(--cp-touch)]");
  });

  it("in the drawer, tapping a parent keeps the drawer open; tapping a submenu row closes it", () => {
    render(<HqMobileNav title="HQ">{sidebar()}</HqMobileNav>);
    fireEvent.click(screen.getByRole("button", { name: "Open Competen HQ navigation" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^Products/ }));
    expect(screen.queryByRole("dialog")).not.toBeNull();
    fireEvent.click(within(dialog).getByRole("link", { name: /Enterprise Overview/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
