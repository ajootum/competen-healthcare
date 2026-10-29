import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ usePathname: () => "/super-admin" }));
import { sidebarMatches } from "./WorkspaceSidebar";

// Owner 29 Oct 2026: a filter at the top of the HQ sidebar. It lists matching rows (children included) once each,
// with where they live, from the viewer's already capability-filtered tables.

const ws = [{ label: "Competency Frameworks", sections: [
  { key: "a", group: "Competency Studio", plain: true, items: [
    { key: "auth", label: "Competency Authoring", href: "/super-admin/competencies/authoring", icon: "x" },
    { key: "pub", label: "Framework Publication", href: "/super-admin/competencies/publication", icon: "x" },
  ] },
  { key: "b", group: "Studio Toolkit", items: [
    { key: "m", label: "Assessment Methods", href: "/super-admin/assessment-methods", icon: "x", children: [{ key: "s", label: "Scoring Rules", href: "/super-admin/scoring", icon: "x" }] },
  ] },
] }] as never;

describe("the sidebar filter", () => {
  it("matches labels case-insensitively, including children, with their location", () => {
    expect(sidebarMatches(ws, "SCORING").map(m => [m.e.label, m.where])).toEqual([["Scoring Rules", "Competency Frameworks › Studio Toolkit › Assessment Methods"]]);
    expect(sidebarMatches(ws, "publication").map(m => m.e.href)).toEqual(["/super-admin/competencies/publication"]);
  });
  it("a group or workspace name lists what is in it; nothing for an empty query or no match", () => {
    expect(sidebarMatches(ws, "toolkit").map(m => m.e.label)).toEqual(["Assessment Methods", "Scoring Rules"]);
    expect(sidebarMatches(ws, "  ")).toEqual([]);
    expect(sidebarMatches(ws, "zzz")).toEqual([]);
  });
});
