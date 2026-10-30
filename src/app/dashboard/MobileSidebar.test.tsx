// @vitest-environment jsdom
/**
 * Owner report, 30 Oct: "on tablet/phone it is difficult to enter the superadmin workspace -- I stay on the
 * personal workspace". Below md the Personal Workspace renders neither the GlobalHeader (its switcher) nor
 * the sidebar (its role switcher) nor the "Open … →" banner, and this drawer listed personal pages only.
 * These pin the two ways back in: the bar's one-tap jump and the drawer's "Switch workspace" list.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
import MobileSidebar from "./MobileSidebar";

const OWNER_WORKSPACES = [
  { label: "Platform Admin", href: "/super-admin", icon: "🛡️" },
  { label: "Unit Manager", href: "/unit-manager", icon: "📊" },
  { label: "Personal Workspace", href: "/dashboard", icon: "⊞" },
];

afterEach(cleanup);

describe("Personal Workspace on a phone", () => {
  it("offers the Super Admin workspace in one tap from the top bar", () => {
    render(<MobileSidebar fullName="Owner" role="super_admin" isAdmin={false} workspaces={OWNER_WORKSPACES} primary={{ label: "Super Admin", href: "/super-admin" }} />);
    expect(screen.getByRole("link", { name: "Open Super Admin" }).getAttribute("href")).toBe("/super-admin");
  });

  it("lists every workspace the person may switch to at the top of the menu, minus the one they are in", () => {
    render(<MobileSidebar fullName="Owner" role="super_admin" isAdmin={false} workspaces={OWNER_WORKSPACES} primary={{ label: "Super Admin", href: "/super-admin" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const menu = screen.getByRole("dialog", { name: "Main navigation" });
    expect(within(menu).getByText("Switch workspace")).toBeTruthy();
    const hrefs = within(menu).getAllByRole("link").map(a => a.getAttribute("href"));
    expect(hrefs.slice(0, 3)).toEqual(["/dashboard", "/super-admin", "/unit-manager"]);
  });

  it("control: a personal-only person gets no jump and no switch section (nothing is invented)", () => {
    render(<MobileSidebar fullName="Nurse" role="nurse" isAdmin={false} workspaces={[OWNER_WORKSPACES[2]]} primary={null} />);
    expect(screen.queryByRole("link", { name: /^Open / })).toBeNull();
    expect(screen.queryByText("Switch workspace")).toBeNull();
  });
});
