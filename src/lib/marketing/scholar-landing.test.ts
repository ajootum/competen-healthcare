import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { EXPERIENCES, SCHOLAR, SCHOLAR_JOIN, scholarGetStarted } from "./individual-family";

// SCHOLAR-WEB-REDESIGN-01 -- the public Competen Scholar landing page's content and its one gated CTA.
const page = readFileSync("src/components/marketing/ScholarLanding.tsx", "utf8");
const copy = JSON.stringify(SCHOLAR);

describe("Scholar Get Started follows the registration gates", () => {
  it("never offers the registration journey while it is closed", () => {
    expect(scholarGetStarted(false, "hero")).toBe("#start");
    const start = scholarGetStarted(false, "start");
    expect(start.startsWith(`mailto:${SCHOLAR.contact.email}?subject=`)).toBe(true);
    expect(decodeURIComponent(start)).toContain(SCHOLAR.landing.subjects.invitation);
    expect([scholarGetStarted(false, "hero"), start]).not.toContain(SCHOLAR_JOIN);
  });
  it("goes to the existing join route once it is open", () => {
    expect(scholarGetStarted(true, "hero")).toBe("/individual/join");
    expect(scholarGetStarted(true, "start")).toBe("/individual/join");
  });
  it("the page reads the gate from the server, per request", () => {
    const route = readFileSync("src/app/scholar/page.tsx", "utf8");
    expect(route).toMatch(/export const dynamic = "force-dynamic";/);
    expect(route).toMatch(/selfRegistrationEnabled\(createAdminClientOrNull\(\)\)/);
    expect(page).not.toMatch(/\/individual\/join|\/signup/);
  });
});

describe("Scholar landing copy is the owner's brief", () => {
  it("carries the approved headline, nav and section headings", () => {
    expect(SCHOLAR.headline).toEqual(["Your notes.", "Your knowledge.", "Your clinical confidence."]);
    expect(SCHOLAR.nav?.map(n => n.label)).toEqual(["Overview", "Benefits", "Your Journey", "Get Started"]);
    expect(SCHOLAR.landing.benefits.title).toBe("From your notes to real understanding");
    expect(SCHOLAR.landing.journey.title).toBe("Build your skills for the future");
    expect(SCHOLAR.landing.audiences.title).toBe("For healthcare students at every stage");
    expect(SCHOLAR.landing.start.title).toBe("Start your learning journey");
    for (const n of SCHOLAR.nav ?? []) if (n.href !== "#overview") expect(page).toContain(`id="${n.href.slice(1)}"`);
  });
  it("shows no product demonstration and no unverified claim", () => {
    expect("steps" in EXPERIENCES.scholar).toBe(false);
    for (const leak of [".pdf", ".docx", "p. 7", "cards due", "Case", "Upload", "dashboard", "engine", "thousands"]) {
      expect(copy).not.toContain(leak);
    }
  });
  it("keeps audiences as configuration: the page names no profession", () => {
    expect(SCHOLAR.landing.audiences.items.length).toBeGreaterThanOrEqual(4);
    expect(page).not.toMatch(/nurs|medical|allied/i);
  });
  it("records the content classes where the content lives", () => {
    const src = readFileSync("src/lib/marketing/individual-family.ts", "utf8");
    for (const c of ["PUBLIC", "CONTROLLED", "CONFIDENTIAL"]) expect(src).toContain(`//   ${c}`);
  });
});

describe("Scholar photographs", () => {
  const photos = [
    { src: SCHOLAR.image, alt: SCHOLAR.imageAlt },
    ...(SCHOLAR.landing.journey.image ? [SCHOLAR.landing.journey.image] : []),
  ];
  it("both owner-approved photos are in use, each with real alt text", () => {
    expect(photos.map(p => p.src)).toEqual(["/images/scholar/hero-students.webp", "/images/scholar/journey-student-laptop.webp"]);
    for (const p of photos) expect(p.alt.length).toBeGreaterThan(30);
  });
  it("every variant ScholarPhoto builds a srcset from exists", () => {
    expect(page).toMatch(/SCHOLAR_PHOTO_WIDTHS = \[640, 1024\]/);
    expect(page).toMatch(/MASTER_WIDTH = 1672/);
    for (const { src } of photos) {
      const base = src.replace(/\.webp$/, "");
      for (const f of [src, `${base}-1672.avif`, ...[640, 1024].flatMap(w => [`${base}-${w}.avif`, `${base}-${w}.webp`])]) {
        expect(existsSync(`public${f}`), f).toBe(true);
      }
    }
    expect(existsSync("public/images/og/scholar.jpg")).toBe(true);
  });
  it("only the hero loads eagerly", () => {
    expect((page.match(/<ScholarPhoto[^>]*\beager\b/g) ?? []).length).toBe(1);
  });
});
